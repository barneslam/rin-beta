/**
 * send-amendment-sms — notify customer of a revised price after job amendment.
 *
 * Called by the dispatcher UI immediately after the job is set to
 * customer_reapproval_pending. Sends an SMS asking the customer to reply
 * YES to approve or NO to decline the revised quote.
 *
 * Request body: { jobId, oldPrice, newPrice, reason }
 * Response:     { success, sid? }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { jobId, oldPrice, newPrice, reason } = await req.json();
    if (!jobId || newPrice == null) {
      return jsonResp({ success: false, error: "jobId and newPrice are required" }, 400);
    }

    console.log(`[AMENDMENT-SMS] Starting — jobId=${jobId} oldPrice=${oldPrice} newPrice=${newPrice}`);

    // Fetch job + user phone
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, user_id, vehicle_make, vehicle_model, vehicle_year")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return jsonResp({ success: false, error: "Job not found" }, 404);
    }

    if (!job.user_id) {
      // Dispatcher-created test job — no customer to notify
      console.log(`[AMENDMENT-SMS] No user_id on job — skipping SMS (dispatcher test job)`);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "amendment_sms_skipped",
        event_category: "communication",
        message: "No customer account linked — SMS skipped",
      });
      return jsonResp({ success: true, skipped: true });
    }

    const { data: user } = await supabase
      .from("users")
      .select("phone")
      .eq("user_id", job.user_id)
      .single();

    if (!user?.phone) {
      console.log(`[AMENDMENT-SMS] No phone on user — skipping SMS`);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "amendment_sms_skipped",
        event_category: "communication",
        message: "Customer has no phone number on file — SMS skipped",
      });
      return jsonResp({ success: true, skipped: true });
    }

    const phoneCheck = validatePhone(user.phone);
    if (!phoneCheck.valid) {
      console.warn(`[AMENDMENT-SMS] Invalid phone (${phoneCheck.reason}) — skipping SMS`);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "amendment_sms_skipped",
        event_category: "communication",
        message: `Invalid customer phone (${phoneCheck.reason}) — SMS skipped`,
      });
      return jsonResp({ success: true, skipped: true });
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      console.error(`[AMENDMENT-SMS] Twilio credentials not configured`);
      return jsonResp({ success: false, error: "SMS credentials not configured" }, 500);
    }

    const vehicleSummary = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
      .filter(Boolean)
      .join(" ") || "your vehicle";

    const oldPriceStr = oldPrice != null ? `$${Number(oldPrice).toFixed(2)}` : "the original quote";
    const newPriceStr = `$${Number(newPrice).toFixed(2)}`;

    const smsBody =
      `WayLift: Your driver has revised the service charge.\n\n` +
      `Vehicle: ${vehicleSummary}\n` +
      `Original quote: ${oldPriceStr}\n` +
      `Revised quote: ${newPriceStr}\n` +
      (reason ? `Reason: ${reason}\n` : "") +
      `\nPlease reply YES to approve the revised charge, or NO to decline (job will be cancelled).`;

    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "amendment_sms_attempt",
      event_category: "communication",
      message: JSON.stringify({ to: phoneCheck.e164, oldPrice, newPrice, reason }),
    });

    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phoneCheck.e164,
          From: TWILIO_PHONE_NUMBER,
          Body: smsBody,
        }),
      }
    );

    const data = await response.json();

    if (response.ok) {
      console.log(`[AMENDMENT-SMS] Sent — to=${phoneCheck.e164} sid=${data.sid}`);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "amendment_sms_sent",
        event_category: "communication",
        message: `Amendment SMS sent to ${phoneCheck.e164} — SID: ${data.sid}`,
      });
      return jsonResp({ success: true, sid: data.sid });
    } else {
      console.error(`[AMENDMENT-SMS] Twilio error — status=${response.status}`);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "amendment_sms_failed",
        event_category: "communication",
        message: `Twilio error [${response.status}]: ${JSON.stringify(data)}`,
      });
      return jsonResp({ success: false, error: `Twilio error [${response.status}]` }, 500);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[AMENDMENT-SMS] Unhandled error:", msg);
    return jsonResp({ success: false, error: msg }, 500);
  }
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
