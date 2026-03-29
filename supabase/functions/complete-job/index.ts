/**
 * complete-job — two-phase job completion.
 *
 * Phase 1 (driver sends DONE):
 *   body: { jobId, driverId }
 *   → Sets job to pending_completion_approval
 *   → SMS customer: "Reply CONFIRM to authorize charge of $X"
 *   → SMS driver: awaiting customer confirmation
 *   → Returns { success: true, awaiting_confirmation: true }
 *
 * Phase 2 (customer replies CONFIRM):
 *   body: { jobId, confirmed: true }
 *   → Captures Stripe payment (skipped for bypass test jobs)
 *   → Sets job to job_completed
 *   → Sends receipt SMS to both parties
 *   → Returns { success: true, charged_amount }
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

    const twilioReady = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { jobId, driverId, confirmed } = await req.json();
    if (!jobId) {
      return jsonResp({ success: false, error: "jobId is required" }, 400);
    }

    console.log(`[COMPLETE-JOB] Starting — jobId=${jobId} driverId=${driverId ?? "n/a"} confirmed=${!!confirmed}`);

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, stripe_payment_intent_id, estimated_price, user_id, assigned_driver_id")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return jsonResp({ success: false, error: "Job not found" }, 404);
    }

    const twilioAuth = twilioReady ? btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) : null;

    async function sendSms(to: string, body: string, label: string): Promise<void> {
      if (!twilioReady || !twilioAuth) {
        console.warn(`[COMPLETE-JOB] Twilio not configured — skipping ${label} SMS`);
        return;
      }
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
          message: `${label} SMS sent to ${phoneCheck.e164} — SID: ${smsData.sid}`,
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

    // -----------------------------------------------------------------------
    // PHASE 1 — Driver sends DONE
    // -----------------------------------------------------------------------
    if (!confirmed) {
      if (!driverId) {
        return jsonResp({ success: false, error: "driverId is required for phase 1" }, 400);
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

      if (!job.estimated_price || job.estimated_price <= 0) {
        return jsonResp({ success: false, error: "No valid price set for this job" }, 400);
      }

      // Set job to awaiting customer confirmation
      const { error: updateErr } = await supabase
        .from("jobs")
        .update({
          job_status: "pending_completion_approval",
        })
        .eq("job_id", jobId);

      if (updateErr) {
        return jsonResp({ success: false, error: `DB update failed: ${updateErr.message}` }, 500);
      }

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "status_changed",
        event_category: "lifecycle",
        message: "Driver marked job complete — awaiting customer confirmation",
        new_value: { job_status: "pending_completion_approval" },
      });

      const priceStr = `$${Number(job.estimated_price).toFixed(2)}`;

      // Fetch customer and driver phones
      const [{ data: customer }, { data: driver }] = await Promise.all([
        supabase.from("users").select("phone, name").eq("user_id", job.user_id).single(),
        supabase.from("drivers").select("phone, driver_name").eq("driver_id", driverId).single(),
      ]);

      // SMS customer asking for confirmation
      if (customer?.phone) {
        await sendSms(
          customer.phone,
          `RIN: Your roadside service is complete.\n\nAmount to be charged: ${priceStr}\n\nReply CONFIRM to authorize the charge, or reply DISPUTE if you have a concern.`,
          "Customer confirmation request"
        );
      }

      // SMS driver — awaiting customer
      if (driver?.phone) {
        await sendSms(
          driver.phone,
          `RIN: Job marked complete. The customer has been asked to confirm the charge of ${priceStr}. You will be notified once confirmed.`,
          "Driver"
        );
      }

      console.log(`[COMPLETE-JOB] Phase 1 complete — jobId=${jobId} awaiting customer confirmation`);
      return jsonResp({ success: true, awaiting_confirmation: true });
    }

    // -----------------------------------------------------------------------
    // PHASE 2 — Customer confirms charge
    // -----------------------------------------------------------------------
    if (job.job_status !== "pending_completion_approval") {
      return jsonResp({
        success: false,
        error: `Job is not awaiting completion confirmation (status: ${job.job_status})`,
        code: "wrong_status",
      }, 409);
    }

    // Transition to job_completed
    const { error: completeErr } = await supabase
      .from("jobs")
      .update({
        job_status: "job_completed",
        completed_at: new Date().toISOString(),
      })
      .eq("job_id", jobId);

    if (completeErr) {
      return jsonResp({ success: false, error: `DB update failed: ${completeErr.message}` }, 500);
    }

    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "status_changed",
      event_category: "lifecycle",
      message: "Customer confirmed charge — job completed",
      new_value: { job_status: "job_completed" },
    });

    // Capture Stripe payment (skip for bypass test jobs)
    let capturedAmount = Number(job.estimated_price);
    const isBypass = job.stripe_payment_intent_id?.startsWith("bypass_test");

    if (!isBypass && job.stripe_payment_intent_id && STRIPE_SECRET_KEY) {
      const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
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
      }
    } else if (isBypass) {
      console.log(`[COMPLETE-JOB] Bypass test job — skipping Stripe capture`);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "payment_captured",
        event_category: "payment",
        message: `Payment capture bypassed (TEST) — amount: $${capturedAmount.toFixed(2)}`,
        new_value: { amount: capturedAmount, stripe_status: "bypass" },
      });
    }

    // Fetch customer and driver for receipt SMS
    const effectiveDriverId = driverId || job.assigned_driver_id;
    const [{ data: customer }, { data: driver }] = await Promise.all([
      supabase.from("users").select("phone, name").eq("user_id", job.user_id).single(),
      effectiveDriverId
        ? supabase.from("drivers").select("phone, driver_name").eq("driver_id", effectiveDriverId).single()
        : Promise.resolve({ data: null }),
    ]);

    const priceStr = `$${capturedAmount.toFixed(2)}`;

    if (customer?.phone) {
      await sendSms(
        customer.phone,
        `RIN: Payment of ${priceStr} confirmed. Thank you for using RIN!`,
        "Customer receipt"
      );
    }

    if (driver?.phone) {
      await sendSms(
        driver.phone,
        `RIN: Customer confirmed. Payment of ${priceStr} is being processed. Thank you!`,
        "Driver receipt"
      );
    }

    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "customer_update",
      event_category: "customer_update",
      message: `Your service is complete. Amount charged: ${priceStr}. Thank you for using RIN!`,
    });

    console.log(`[COMPLETE-JOB] Phase 2 complete — jobId=${jobId} charged=${priceStr}`);
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
