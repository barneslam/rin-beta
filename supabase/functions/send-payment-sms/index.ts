import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { APP_BASE_URL } from "../_shared/config.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePhone } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { jobId } = await req.json();
    if (!jobId) {
      return jsonResp({ success: false, error: "jobId is required" }, 400);
    }

    console.log(`[PAYMENT-SMS] Starting — jobId=${jobId}`);

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, estimated_price, user_id, job_status, customer_phone")
      .eq("job_id", jobId)
      .single();
    if (jobErr || !job) {
      return jsonResp({ success: false, error: "Job not found" }, 404);
    }

    // Validate estimated_price
    const price = Number(job.estimated_price);
    if (!price || price <= 0) {
      return jsonResp({
        success: false,
        error: "Cannot send payment SMS: estimated_price is missing or invalid",
      }, 400);
    }

    // Resolve phone: prefer job.customer_phone, fallback to users table
    let rawPhone = job.customer_phone || "";
    if (!rawPhone && job.user_id) {
      const { data: user } = await supabase
        .from("users")
        .select("phone")
        .eq("user_id", job.user_id)
        .single();
      rawPhone = user?.phone ?? "";
    }

    // ------------------------------------------------------------------
    // Phone validation — hard block before any SMS attempt
    // ------------------------------------------------------------------
    const phoneCheck = validatePhone(rawPhone);
    console.log(
      `[PAYMENT-SMS] Phone check — raw="${rawPhone}" e164="${phoneCheck.e164}" valid=${phoneCheck.valid} reason=${phoneCheck.reason ?? "ok"}`
    );

    if (!phoneCheck.valid) {
      const exMsg = `Customer phone "${rawPhone}" is invalid (${phoneCheck.reason}) — payment SMS blocked`;
      console.error(`[PAYMENT-SMS] EXCEPTION: ${exMsg} — jobId=${jobId}`);

      await Promise.all([
        supabase.from("jobs").update({
          exception_code: "invalid_customer_phone",
          exception_message: exMsg,
        }).eq("job_id", jobId),
        supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "payment_sms_blocked",
          event_category: "exception",
          message: exMsg,
          new_value: {
            exception_code: "invalid_customer_phone",
            raw_phone: rawPhone,
            reason: phoneCheck.reason,
          },
        }),
      ]);

      return jsonResp({
        success: false,
        error: exMsg,
        exception_code: "invalid_customer_phone",
      }, 400);
    }

    // ------------------------------------------------------------------
    // Credentials check
    // ------------------------------------------------------------------
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return jsonResp({ success: false, error: "SMS credentials not configured" }, 500);
    }

    // ------------------------------------------------------------------
    // Send SMS
    // ------------------------------------------------------------------
    const payLink = `${APP_BASE_URL}/pay/${job.job_id}`;
    const body = `WayLift: Your driver is confirmed. Estimated charge: $${price.toFixed(2)}. Please authorize payment: ${payLink}`;

    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const smsResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phoneCheck.e164, From: TWILIO_PHONE_NUMBER, Body: body }),
      }
    );

    if (!smsResp.ok) {
      const errBody = await smsResp.text();
      const exMsg = `Payment SMS to ${phoneCheck.e164} failed — Twilio [${smsResp.status}]: ${errBody.slice(0, 200)}`;
      console.error(`[PAYMENT-SMS] EXCEPTION: ${exMsg} — jobId=${jobId}`);

      // Set exception state — do NOT change job_status (driver is still assigned)
      await Promise.all([
        supabase.from("jobs").update({
          exception_code: "payment_sms_failed",
          exception_message: `Dispatcher must resend payment link manually. Twilio error [${smsResp.status}].`,
        }).eq("job_id", jobId),
        supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "payment_sms_failed",
          event_category: "exception",
          message: exMsg,
          new_value: {
            exception_code: "payment_sms_failed",
            to: phoneCheck.e164,
            twilio_status: smsResp.status,
          },
        }),
      ]);

      return jsonResp({
        success: false,
        error: exMsg,
        exception_code: "payment_sms_failed",
      }, 502);
    }

    const smsData = await smsResp.json();
    console.log(`[PAYMENT-SMS] Sent — jobId=${jobId} to=${phoneCheck.e164} SID=${smsData.sid}`);

    // Clear any previous phone/SMS exception now that it succeeded
    await supabase.from("jobs")
      .update({ exception_code: null, exception_message: null })
      .eq("job_id", jobId)
      .in("exception_code", ["payment_sms_failed", "invalid_customer_phone"]);

    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "payment_sms_sent",
      event_category: "payment",
      message: `Payment SMS sent to ${phoneCheck.e164} ($${price.toFixed(2)}) — SID: ${smsData.sid}`,
    });

    return jsonResp({ success: true, sid: smsData.sid });
  } catch (error: unknown) {
    console.error("[PAYMENT-SMS] Unhandled error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResp({ success: false, error: msg }, 500);
  }
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
