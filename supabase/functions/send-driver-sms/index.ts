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
    if (!TWILIO_ACCOUNT_SID) throw new Error("TWILIO_ACCOUNT_SID is not configured");

    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!TWILIO_AUTH_TOKEN) throw new Error("TWILIO_AUTH_TOKEN is not configured");

    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { offerId, jobId, driverId } = await req.json();
    if (!offerId || !jobId || !driverId) {
      return new Response(JSON.stringify({ error: "Missing offerId, jobId, or driverId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch offer — include status and sms_sent_at for idempotency guards
    const { data: offer, error: offerErr } = await supabase
      .from("dispatch_offers")
      .select("token, offer_status, sms_sent_at")
      .eq("offer_id", offerId)
      .single();
    if (offerErr || !offer) {
      return new Response(JSON.stringify({
        success: false, error_code: "offer_not_found",
        error: "Offer not found", context: { offerId },
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (offer.offer_status !== "pending") {
      return new Response(JSON.stringify({
        success: false, error_code: "offer_not_pending",
        error: `Offer is not pending (status: ${offer.offer_status})`,
        context: { offerId, jobId, offer_status: offer.offer_status },
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (offer.sms_sent_at) {
      return new Response(JSON.stringify({
        success: false, error_code: "duplicate_sms",
        error: "SMS already sent for this offer",
        context: { offerId, jobId, sms_sent_at: offer.sms_sent_at },
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch job — include job_status for state guard
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_status, pickup_location, incident_type_id, vehicle_year, vehicle_make, vehicle_model, estimated_price")
      .eq("job_id", jobId)
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({
        success: false, error_code: "job_not_found",
        error: "Job not found", context: { jobId, offerId },
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // State guard: allow sending from any active dispatch state.
    // driver_offer_sent is the normal state for 2nd+ offers in a sequence.
    const VALID_SEND_STATES = [
      "ready_for_dispatch",
      "driver_offer_sent",
      "dispatch_recommendation_ready",
      "no_driver_candidates",
    ];
    if (!VALID_SEND_STATES.includes(job.job_status)) {
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "driver_sms_blocked",
        event_category: "exception",
        message: `Driver SMS blocked — invalid job state: ${job.job_status} (valid: ${VALID_SEND_STATES.join("|")}) offer_id=${offerId}`,
      });
      return new Response(JSON.stringify({
        success: false, error_code: "invalid_job_state",
        error: `SMS blocked — job status '${job.job_status}' is not a dispatchable state`,
        context: { jobId, offerId, current_status: job.job_status, valid_states: VALID_SEND_STATES },
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch driver
    const { data: driver, error: driverErr } = await supabase
      .from("drivers")
      .select("phone, driver_name")
      .eq("driver_id", driverId)
      .single();
    if (driverErr || !driver) {
      return new Response(JSON.stringify({
        success: false, error_code: "driver_not_found",
        error: "Driver not found", context: { driverId, jobId, offerId },
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!driver.phone) {
      return new Response(JSON.stringify({
        success: false, error_code: "driver_no_phone",
        error: "Driver has no phone number", context: { driverId, jobId, offerId },
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const driverPhoneCheck = validatePhone(driver.phone);
    console.log(`[DRIVER-SMS] Phone check — raw="${driver.phone}" e164="${driverPhoneCheck.e164}" valid=${driverPhoneCheck.valid} reason=${driverPhoneCheck.reason ?? "ok"}`);
    if (!driverPhoneCheck.valid) {
      throw new Error(
        `Driver phone "${driver.phone}" is invalid (${driverPhoneCheck.reason}) — SMS blocked. ` +
        `Update driver record with a valid E.164 number (e.g. +14165550100).`
      );
    }
    const driverE164 = driverPhoneCheck.e164;

    // Fetch incident type name
    let incidentName = "Roadside assistance";
    if (job.incident_type_id) {
      const { data: incType } = await supabase
        .from("incident_types")
        .select("incident_name")
        .eq("incident_type_id", job.incident_type_id)
        .single();
      if (incType) incidentName = incType.incident_name;
    }

    // Build vehicle summary
    const vehicleParts = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean);
    const vehicleSummary = vehicleParts.length > 0 ? vehicleParts.join(" ") : "Not specified";

    // Build payout
    const payout = job.estimated_price ? `$${Number(job.estimated_price).toFixed(2)}` : "TBD";

    // Build secure link
    const offerLink = `https://rin-beta.lovable.app/driver/offer/${offerId}?token=${offer.token}`;

    const smsBody = `RIN DISPATCH
Pickup: ${job.pickup_location || "See app"}
Issue: ${incidentName}
Vehicle: ${vehicleSummary}
Payout: ${payout}

Review offer:
${offerLink}

Reply YES to accept, NO to decline.`;

    // Log attempt before calling Twilio
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "driver_sms_attempt",
      event_category: "communication",
      message: `Attempting offer SMS to ${driver.driver_name} (${driverE164}) — offer_id=${offerId}`,
    });

    // Send SMS via Twilio direct
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: driverE164,
          From: TWILIO_PHONE_NUMBER,
          Body: smsBody,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      // Track SMS delivery failure on the offer and driver
      const now = new Date().toISOString();
      await Promise.all([
        supabase.from("dispatch_offers").update({
          sms_sent_at: now,
          sms_delivery_status: "failed",
        }).eq("offer_id", offerId),
        supabase.from("drivers").update({
          last_sms_sent_at: now,
          sms_delivery_status: "failed",
        }).eq("driver_id", driverId),
        supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "sms_delivery_failed",
          event_category: "communication",
          message: `Driver SMS to ${driver.driver_name} (${driver.phone}) failed: ${JSON.stringify(data)}`,
        }),
      ]);
      throw new Error(`Twilio API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    // Track successful SMS send on offer and driver, log SID in job_events
    const now = new Date().toISOString();
    await Promise.all([
      supabase.from("dispatch_offers").update({
        sms_sent_at: now,
        sms_delivery_status: "sent",
      }).eq("offer_id", offerId),
      supabase.from("drivers").update({
        last_sms_sent_at: now,
        sms_delivery_status: "sent",
      }).eq("driver_id", driverId),
      supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "driver_sms_sent",
        event_category: "communication",
        message: `Offer SMS sent to ${driver.driver_name} (${driver.phone}) — Twilio SID: ${data.sid}`,
      }),
      supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "offer_sent",
        event_category: "dispatch",
        message: `Offer SMS confirmed sent — driver_id=${driverId} offer_id=${offerId} job_id=${jobId} SID: ${data.sid}`,
      }),
    ]);

    // Advance job status to driver_offer_sent — from any transitional dispatch state.
    // If already driver_offer_sent (2nd+ offer), no-op (no redundant event written).
    const { data: currentJob } = await supabase
      .from("jobs")
      .select("job_status")
      .eq("job_id", jobId)
      .single();

    const TRANSITION_TO_OFFER_SENT = ["ready_for_dispatch", "dispatch_recommendation_ready", "no_driver_candidates"];
    if (currentJob && TRANSITION_TO_OFFER_SENT.includes(currentJob.job_status)) {
      await supabase.from("jobs").update({ job_status: "driver_offer_sent" }).eq("job_id", jobId);
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "job_status_updated",
        event_category: "dispatch",
        message: `Status: ${currentJob.job_status} → driver_offer_sent (offer_id=${offerId})`,
      });
      console.log(`[DRIVER-SMS] Status: ${currentJob.job_status} → driver_offer_sent job=${jobId} offer=${offerId}`);
    } else if (currentJob?.job_status === "driver_offer_sent") {
      console.log(`[DRIVER-SMS] Status already driver_offer_sent — no transition needed job=${jobId}`);
    } else {
      console.log(`[DRIVER-SMS] Status NOT updated — current=${currentJob?.job_status} job=${jobId}`);
    }

    console.log(`[DRIVER-SMS] Sent — driver=${driver.driver_name} to=${driverE164} job=${jobId} offer=${offerId} SID=${data.sid}`);

    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending driver SMS:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({
      success: false,
      error_code: "internal_error",
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
