/**
 * driver-cancel-at-scene — triggered when an assigned driver sends CANCEL SMS.
 * Transitions job to driver_cancelled_at_scene, unassigns the driver,
 * notifies customer, and resets job for re-dispatch.
 *
 * Request body: { jobId, driverId, driverName }
 * Response:     { success }
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

    const { jobId, driverId, driverName } = await req.json();
    if (!jobId || !driverId) {
      return jsonResp({ success: false, error: "jobId and driverId are required" }, 400);
    }

    console.log(`[CANCEL-AT-SCENE] Starting — jobId=${jobId} driverId=${driverId}`);

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id, user_id, dispatch_attempt_count")
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

    const name = driverName ?? "Driver";

    // 1. Transition job — unassign driver, reset for re-dispatch
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({
        job_status: "driver_cancelled_at_scene",
        assigned_driver_id: null,
        driver_assigned_at: null,
      })
      .eq("job_id", jobId);

    if (updateErr) {
      return jsonResp({ success: false, error: `DB update failed: ${updateErr.message}` }, 500);
    }

    // 2. Log events
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "driver_cancelled_at_scene",
      event_category: "lifecycle",
      message: `${name} cancelled at scene. Job reset for re-dispatch.`,
      new_value: { job_status: "driver_cancelled_at_scene", previously_assigned: driverId },
    });

    await supabase.from("audit_logs").insert({
      job_id: jobId,
      action_type: `Driver cancelled at scene: ${name}`,
      event_type: "status_changed",
      event_source: "driver_sms",
      old_value: { job_status: job.job_status, assigned_driver_id: driverId },
      new_value: { job_status: "driver_cancelled_at_scene", assigned_driver_id: null },
    });

    // 3. Notify customer via SMS
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
              From: TWILIO_PHONE_NUMBER,
              Body:
                `RIN: We're sorry — your driver encountered an issue and could not complete the job.\n\n` +
                `We are finding you a replacement driver now. Please stay with your vehicle.`,
            }),
          }
        );

        const smsData = await resp.json();
        if (resp.ok) {
          console.log(`[CANCEL-AT-SCENE] Customer notified — to=${phoneCheck.e164} sid=${smsData.sid}`);
          await supabase.from("job_events").insert({
            job_id: jobId,
            event_type: "customer_update",
            event_category: "customer_update",
            message: "We're sorry — your driver encountered an issue and could not complete the job. We are finding a replacement driver now.",
          });
        } else {
          console.error(`[CANCEL-AT-SCENE] Customer SMS failed — status=${resp.status}`);
          await supabase.from("job_events").insert({
            job_id: jobId,
            event_type: "cancel_at_scene_sms_failed",
            event_category: "communication",
            message: `Customer notification SMS failed: ${JSON.stringify(smsData)}`,
          });
        }
      } else {
        console.warn(`[CANCEL-AT-SCENE] Customer phone invalid (${phoneCheck.reason}) — skipping SMS`);
      }
    }

    console.log(`[CANCEL-AT-SCENE] Done — jobId=${jobId} reset to driver_cancelled_at_scene`);

    return jsonResp({ success: true });
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
