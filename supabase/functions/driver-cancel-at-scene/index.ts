/**
 * driver-cancel-at-scene
 *
 * Called when a driver cancels after being dispatched (equipment failure,
 * safety concern, etc.). The driver has NOT completed the job, so:
 *   - No Stripe capture (payment intent stays authorized for reassignment)
 *   - No driver payout
 *   - Job moves to driver_cancelled_at_scene
 *   - Driver is unassigned
 *   - Customer notified of delay
 *
 * Input:  { jobId, driverId, driverName, reason? }
 * Output: { success: boolean }
 *
 * Called by:
 *   1. twilio-webhook (driver replies CANCEL)
 *   2. JobTracking UI (dispatcher clicks "Driver Unable to Complete")
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
    const twilioReady = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { jobId, driverId, driverName, reason } = await req.json();
    if (!jobId || !driverId) {
      return jsonResp({ success: false, error: "jobId and driverId are required" }, 400);
    }

    const cancelReason = reason || "Driver was unable to complete the service";
    const name = driverName ?? "Driver";

    console.log(`[CANCEL-AT-SCENE] Starting — jobId=${jobId} driverId=${driverId} reason="${cancelReason}"`);

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id, user_id")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return jsonResp({ success: false, error: "Job not found" }, 404);
    }

    if (!["driver_enroute", "driver_arrived", "service_in_progress"].includes(job.job_status)) {
      return jsonResp({
        success: false,
        error: `Job cannot be cancelled from status: ${job.job_status}`,
        code: "wrong_status",
      }, 409);
    }

    if (job.assigned_driver_id !== driverId) {
      return jsonResp({ success: false, error: "Driver is not assigned to this job" }, 403);
    }

    // 1. Transition job — unassign driver, no Stripe capture
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({
        job_status: "driver_cancelled_at_scene",
        assigned_driver_id: null,
        assigned_truck_id: null,
        exception_code: "driver_cancelled_at_scene",
        exception_message: cancelReason,
      })
      .eq("job_id", jobId);

    if (updateErr) {
      return jsonResp({ success: false, error: `DB update failed: ${updateErr.message}` }, 500);
    }

    // 2. Log events
    await Promise.all([
      supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "driver_cancelled_at_scene",
        event_category: "lifecycle",
        actor_type: "driver",
        message: `${name} cancelled at scene — reason: ${cancelReason}. No compensation. Job reset for re-dispatch.`,
        new_value: {
          job_status: "driver_cancelled_at_scene",
          previously_assigned: driverId,
          reason: cancelReason,
          no_compensation: true,
        },
      }),
      supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: `Driver cancelled at scene: ${name}`,
        event_type: "driver_cancelled",
        event_source: "driver_sms",
        old_value: { job_status: job.job_status, assigned_driver_id: driverId },
        new_value: { job_status: "driver_cancelled_at_scene", assigned_driver_id: null, no_compensation: true },
      }),
    ]);

    console.log(`[CANCEL-AT-SCENE] Job ${jobId} → driver_cancelled_at_scene, driver unassigned, no capture`);

    // 3. Notify customer via SMS (graceful skip if Twilio not configured)
    if (!twilioReady) {
      console.warn("[CANCEL-AT-SCENE] Twilio not configured — skipping customer SMS");
    } else if (job.user_id) {
      const { data: customer } = await supabase
        .from("users")
        .select("phone")
        .eq("user_id", job.user_id)
        .single();

      if (customer?.phone) {
        const phoneCheck = validatePhone(customer.phone);
        if (phoneCheck.valid) {
          const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
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
                Body:
                  `WayLift: We're sorry — your driver encountered an issue and was unable to complete the service.\n\n` +
                  `A replacement driver is being arranged. Please stay with your vehicle.\n\n` +
                  `You will not be charged for this interruption.`,
              }),
            }
          );
          const smsData = await resp.json();
          if (resp.ok) {
            console.log(`[CANCEL-AT-SCENE] Customer notified — to=${phoneCheck.e164} sid=${smsData.sid}`);
            await supabase.from("job_events").insert({
              job_id: jobId,
              event_type: "customer_notified_of_cancellation",
              event_category: "communication",
              message: `Customer notified of driver cancellation — SID: ${smsData.sid}`,
            });
          } else {
            console.error(`[CANCEL-AT-SCENE] Customer SMS failed — status=${resp.status}`);
          }
        } else {
          console.warn(`[CANCEL-AT-SCENE] Customer phone invalid (${phoneCheck.reason}) — skipping SMS`);
        }
      }
    }

    return jsonResp({ success: true, new_status: "driver_cancelled_at_scene" });

  } catch (error: unknown) {
    console.error("[CANCEL-AT-SCENE] Unhandled error:", error);
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
