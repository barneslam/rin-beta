/**
 * complete-job — triggered by driver SMS "DONE".
 * Captures Stripe payment, transitions job to job_completed,
 * sends confirmation SMS to both customer and driver.
 *
 * Request body: { jobId, driverId }
 * Response:     { success, charged_amount }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
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
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!STRIPE_SECRET_KEY) {
      return jsonResp({ success: false, error: "STRIPE_SECRET_KEY is not configured" }, 500);
    }
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return jsonResp({ success: false, error: "SMS credentials not configured" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });

    const { jobId, driverId } = await req.json();
    if (!jobId || !driverId) {
      return jsonResp({ success: false, error: "jobId and driverId are required" }, 400);
    }

    console.log(`[COMPLETE-JOB] Starting — jobId=${jobId} driverId=${driverId}`);

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, stripe_payment_intent_id, estimated_price, user_id, assigned_driver_id")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return jsonResp({ success: false, error: "Job not found" }, 404);
    }

    if (!["service_in_progress", "driver_arrived"].includes(job.job_status)) {
      return jsonResp({
        success: false,
        error: `Job cannot be completed from status: ${job.job_status}`,
        code: "wrong_status",
      }, 409);
    }

    if (job.assigned_driver_id !== driverId) {
      return jsonResp({ success: false, error: "Driver is not assigned to this job" }, 403);
    }

    if (!job.stripe_payment_intent_id) {
      return jsonResp({ success: false, error: "No payment intent found for this job" }, 400);
    }

    if (!job.estimated_price || job.estimated_price <= 0) {
      return jsonResp({ success: false, error: "No valid price set for this job" }, 400);
    }

    // 1. Transition job to job_completed
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({
        job_status: "job_completed",
        completed_at: new Date().toISOString(),
      })
      .eq("job_id", jobId);

    if (updateErr) {
      return jsonResp({ success: false, error: `DB update failed: ${updateErr.message}` }, 500);
    }

    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "status_changed",
      event_category: "lifecycle",
      message: "Driver marked job complete via SMS",
      new_value: { job_status: "job_completed" },
    });

    console.log(`[COMPLETE-JOB] Job transitioned to job_completed — jobId=${jobId}`);

    // 2. Capture Stripe payment
    let capturedAmount = job.estimated_price;
    try {
      const paymentIntent = await stripe.paymentIntents.capture(job.stripe_payment_intent_id);
      capturedAmount = paymentIntent.amount_received / 100;

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "payment_captured",
        event_category: "payment",
        message: `Payment captured: $${capturedAmount.toFixed(2)}`,
        new_value: { amount: paymentIntent.amount_received, stripe_status: paymentIntent.status },
      });

      await supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: "Payment captured via Stripe",
        event_type: "status_changed",
        event_source: "stripe",
        new_value: { payment_status: "captured", amount: paymentIntent.amount_received },
      });

      console.log(`[COMPLETE-JOB] Payment captured — jobId=${jobId} amount=$${capturedAmount.toFixed(2)}`);
    } catch (captureErr: unknown) {
      const errMsg = captureErr instanceof Error ? captureErr.message : "Capture failed";
      console.error(`[COMPLETE-JOB] Stripe capture failed — jobId=${jobId} error=${errMsg}`);

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "payment_capture_failed",
        event_category: "payment",
        message: `Stripe capture failed: ${errMsg}`,
      });
      // Continue — job is marked complete; dispatch can retry capture manually
    }

    // 3. Fetch customer and driver phone numbers
    const [{ data: customer }, { data: driver }] = await Promise.all([
      supabase.from("users").select("phone, name").eq("user_id", job.user_id).single(),
      supabase.from("drivers").select("phone, driver_name").eq("driver_id", driverId).single(),
    ]);

    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    async function sendSms(to: string, body: string, label: string): Promise<void> {
      const phoneCheck = validatePhone(to);
      if (!phoneCheck.valid) {
        console.warn(`[COMPLETE-JOB] ${label} phone invalid (${phoneCheck.reason}) — skipping SMS`);
        await supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "completion_sms_skipped",
          event_category: "communication",
          message: `${label} SMS skipped — phone invalid: ${phoneCheck.reason}`,
        });
        return;
      }

      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${twilioAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: phoneCheck.e164,
            From: TWILIO_PHONE_NUMBER!,
            Body: body,
          }),
        }
      );

      const smsData = await resp.json();
      if (resp.ok) {
        console.log(`[COMPLETE-JOB] ${label} SMS sent — to=${phoneCheck.e164} sid=${smsData.sid}`);
        await supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "completion_sms_sent",
          event_category: "communication",
          message: `${label} completion SMS sent to ${phoneCheck.e164} — SID: ${smsData.sid}`,
        });
      } else {
        console.error(`[COMPLETE-JOB] ${label} SMS failed — to=${phoneCheck.e164} status=${resp.status}`);
        await supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "completion_sms_failed",
          event_category: "communication",
          message: `${label} SMS to ${phoneCheck.e164} failed: ${JSON.stringify(smsData)}`,
        });
      }
    }

    // 4. Send customer confirmation SMS
    if (customer?.phone) {
      const customerMsg =
        `RIN: Your roadside service is complete.\n\n` +
        `Amount charged: $${capturedAmount.toFixed(2)}\n\n` +
        `Thank you for using RIN!`;
      await sendSms(customer.phone, customerMsg, "Customer");
    }

    // 5. Send driver confirmation SMS
    if (driver?.phone) {
      const driverMsg =
        `RIN: Job complete. Payment of $${capturedAmount.toFixed(2)} is being processed.\n\n` +
        `Thank you!`;
      await sendSms(driver.phone, driverMsg, "Driver");
    }

    // 6. Customer-facing event for timeline
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "customer_update",
      event_category: "customer_update",
      message: `Your service is complete. Amount charged: $${capturedAmount.toFixed(2)}. Thank you for using RIN!`,
    });

    console.log(`[COMPLETE-JOB] Done — jobId=${jobId} charged=$${capturedAmount.toFixed(2)}`);

    return jsonResp({ success: true, charged_amount: capturedAmount });
  } catch (error: unknown) {
    console.error("[COMPLETE-JOB] Unhandled error:", error);
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
