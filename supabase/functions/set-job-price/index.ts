/**
 * set-job-price — dispatcher sets estimated price, sends price approval SMS to customer.
 *
 * Request body: { jobId, price }
 * Response:     { success, sid }
 */
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
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return jsonResp({ success: false, error: "SMS credentials not configured" }, 500);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { jobId, price } = await req.json();
    if (!jobId || price == null) {
      return jsonResp({ success: false, error: "jobId and price are required" }, 400);
    }

    const parsedPrice = Number(price);
    if (!parsedPrice || parsedPrice <= 0) {
      return jsonResp({ success: false, error: "price must be a positive number" }, 400);
    }

    console.log(`[SET-PRICE] Starting — jobId=${jobId} price=${parsedPrice}`);

    // Fetch job + user phone
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, user_id")
      .eq("job_id", jobId)
      .single();
    if (jobErr || !job) {
      return jsonResp({ success: false, error: "Job not found" }, 404);
    }

    if (job.job_status !== "pending_pricing") {
      return jsonResp({
        success: false,
        error: `Job is not awaiting pricing (status: ${job.job_status})`,
        code: "wrong_status",
      }, 409);
    }

    const { data: user } = await supabase
      .from("users")
      .select("phone")
      .eq("user_id", job.user_id)
      .single();

    const rawPhone = user?.phone ?? "";
    const phoneCheck = validatePhone(rawPhone);
    console.log(`[SET-PRICE] Phone check — raw="${rawPhone}" e164="${phoneCheck.e164}" valid=${phoneCheck.valid}`);

    if (!phoneCheck.valid) {
      return jsonResp({
        success: false,
        error: `Customer phone invalid (${phoneCheck.reason}) — cannot send price approval SMS`,
        code: "invalid_phone",
      }, 400);
    }

    // Update job: set price + transition status
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({
        estimated_price: parsedPrice,
        job_status: "pending_customer_price_approval",
      })
      .eq("job_id", jobId);

    if (updateErr) {
      return jsonResp({ success: false, error: `DB update failed: ${updateErr.message}` }, 500);
    }

    // Log event
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "price_set",
      event_category: "pricing",
      message: `Dispatcher set estimated price: $${parsedPrice.toFixed(2)}`,
      new_value: { estimated_price: parsedPrice },
    });

    // Send price approval SMS to customer
    const payLink = `${APP_BASE_URL}/pay/${jobId}`;
    const smsBody =
      `RIN: Your estimated cost is $${parsedPrice.toFixed(2)}.\n\n` +
      `Reply APPROVE to authorize this amount, or visit:\n${payLink}\n\n` +
      `Reply CANCEL to cancel your request.`;

    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const smsResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phoneCheck.e164,
          From: TWILIO_PHONE_NUMBER,
          Body: smsBody,
        }),
      }
    );

    const smsData = await smsResp.json();
    if (!smsResp.ok) {
      console.error(`[SET-PRICE] SMS failed — jobId=${jobId} status=${smsResp.status}`);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "price_sms_failed",
        event_category: "exception",
        message: `Price approval SMS to ${phoneCheck.e164} failed: ${JSON.stringify(smsData)}`,
      });
      // Don't block — price is already set, dispatcher can retry SMS manually
      return jsonResp({ success: true, sms_status: "failed", sms_error: smsData });
    }

    console.log(`[SET-PRICE] SMS sent — jobId=${jobId} to=${phoneCheck.e164} SID=${smsData.sid}`);
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "price_sms_sent",
      event_category: "pricing",
      message: `Price approval SMS sent to ${phoneCheck.e164} ($${parsedPrice.toFixed(2)}) — SID: ${smsData.sid}`,
    });

    return jsonResp({ success: true, sms_status: "sent", sid: smsData.sid });
  } catch (error: unknown) {
    console.error("[SET-PRICE] Unhandled error:", error);
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
