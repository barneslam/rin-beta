/**
 * driver-adjust-amount — driver updates estimated price on scene.
 * Updates estimated_price on the job and notifies the customer via SMS.
 *
 * Triggered by driver SMS: "ADJUST 150.00"
 * Request body: { jobId, driverId, newAmount }
 * Response:     { success, new_amount }
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return jsonResp({ success: false, error: "SMS credentials not configured" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { jobId, driverId, newAmount } = await req.json();
    if (!jobId || !driverId || newAmount == null) {
      return jsonResp({ success: false, error: "jobId, driverId, and newAmount are required" }, 400);
    }

    const parsedAmount = Number(newAmount);
    if (!parsedAmount || parsedAmount <= 0) {
      return jsonResp({ success: false, error: "newAmount must be a positive number" }, 400);
    }

    console.log(`[ADJUST-AMOUNT] Starting — jobId=${jobId} driverId=${driverId} newAmount=${parsedAmount}`);

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id, user_id, estimated_price")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return jsonResp({ success: false, error: "Job not found" }, 404);
    }

    if (!["driver_enroute", "driver_arrived", "service_in_progress"].includes(job.job_status)) {
      return jsonResp({
        success: false,
        error: `Cannot adjust amount for job in status: ${job.job_status}`,
        code: "wrong_status",
      }, 409);
    }

    if (job.assigned_driver_id !== driverId) {
      return jsonResp({ success: false, error: "Driver is not assigned to this job" }, 403);
    }

    const oldAmount = job.estimated_price;

    // Update price AND pause job — require customer approval before work continues
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({
        estimated_price: parsedAmount,
        job_status: "customer_reapproval_pending",
        amendment_reason: `Driver adjusted price on scene: $${oldAmount?.toFixed(2) ?? "0"} → $${parsedAmount.toFixed(2)}`,
      })
      .eq("job_id", jobId);

    if (updateErr) {
      return jsonResp({ success: false, error: `DB update failed: ${updateErr.message}` }, 500);
    }

    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "amount_adjusted",
      event_category: "pricing",
      message: `Driver adjusted amount on scene: $${oldAmount?.toFixed(2) ?? "?"} → $${parsedAmount.toFixed(2)} — job paused, awaiting customer approval`,
      old_value: { estimated_price: oldAmount, job_status: job.job_status },
      new_value: { estimated_price: parsedAmount, job_status: "customer_reapproval_pending" },
    });

    console.log(`[ADJUST-AMOUNT] Price updated + job paused — jobId=${jobId} old=$${oldAmount} new=$${parsedAmount} status=customer_reapproval_pending`);

    // Send customer approval request via send-amendment-sms
    try {
      const amendResp = await fetch(`${SUPABASE_URL}/functions/v1/send-amendment-sms`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId,
          oldPrice: oldAmount || 0,
          newPrice: parsedAmount,
          reason: "Driver adjusted price on scene",
        }),
      });
      const amendResult = await amendResp.json().catch(() => ({}));
      console.log(`[ADJUST-AMOUNT] Amendment SMS result — status=${amendResp.status} sid=${amendResult.sid ?? "unknown"}`);

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "amendment_sms_sent",
        event_category: "communication",
        message: `Customer approval SMS sent for revised amount $${parsedAmount.toFixed(2)} — SID: ${amendResult.sid ?? "unknown"}`,
      });
    } catch (smsErr) {
      console.error(`[ADJUST-AMOUNT] Amendment SMS failed:`, smsErr);
    }

    // Notify driver that work is paused until customer approves
    const { data: driver } = await supabase
      .from("drivers")
      .select("phone")
      .eq("driver_id", driverId)
      .single();

    if (driver?.phone) {
      const phoneCheck = validatePhone(driver.phone);
      if (phoneCheck.valid) {
        const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
        await fetch(
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
              Body:
                `WayLift: Your revised quote of $${parsedAmount.toFixed(2)} has been sent to the customer for approval.\n\n` +
                `Please wait for confirmation before proceeding with service. You will be notified when the customer responds.`,
            }),
          }
        );
        console.log(`[ADJUST-AMOUNT] Driver notified — waiting for customer approval`);
      }
    }

    return jsonResp({ success: true, new_amount: parsedAmount, awaiting_approval: true });
  } catch (error: unknown) {
    console.error("[ADJUST-AMOUNT] Unhandled error:", error);
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
