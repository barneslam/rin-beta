/**
 * send-driver-offer — Batch 8, Dispatch Offers Engine v1
 *
 * Sends an offer SMS to a driver for a given offer_id.
 * Unlike send-driver-sms, does NOT require job_status = ready_for_dispatch.
 * Works for any job in a dispatch-related state. Updates job_status →
 * driver_offer_sent if transitioning from a matchable state.
 *
 * Input:  { offer_id: string }
 * Output: { success, outcome, offer_id, driver_id?, driver_name?, sid? }
 *
 * Outcomes:
 *   offer_sent     — SMS delivered
 *   duplicate_send — SMS already sent for this offer (idempotent)
 *   sms_failed     — Twilio rejected the request
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePhone } from "../_shared/phone.ts";

// Job statuses that should transition to driver_offer_sent when an SMS is sent
const TRANSITION_TO_OFFER_SENT = [
  "ready_for_dispatch",
  "dispatch_recommendation_ready",
  "no_driver_candidates",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TWILIO_ACCOUNT_SID        = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const TWILIO_AUTH_TOKEN         = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const TWILIO_PHONE_NUMBER       = Deno.env.get("TWILIO_PHONE_NUMBER")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { offer_id } = await req.json();
    if (!offer_id) return jsonResp({ success: false, error_code: "missing_params", error: "offer_id is required" }, 400);

    console.log(`[SEND-OFFER] offer_id=${offer_id}`);

    // ── 1. Fetch offer ───────────────────────────────────────────────────────
    const { data: offer, error: offerErr } = await supabase
      .from("dispatch_offers")
      .select("offer_id, job_id, driver_id, truck_id, offer_status, sms_sent_at, expires_at, token")
      .eq("offer_id", offer_id)
      .maybeSingle();

    if (offerErr || !offer) {
      return jsonResp({ success: false, error_code: "offer_not_found", error: "Offer not found", context: { offer_id } }, 404);
    }

    // Idempotency: already sent
    if (offer.sms_sent_at) {
      return jsonResp({
        success: true,
        outcome: "duplicate_send",
        offer_id,
        sms_sent_at: offer.sms_sent_at,
        message: "SMS already sent for this offer",
      });
    }

    if (offer.offer_status !== "pending") {
      return jsonResp({
        success: false,
        error_code: "offer_not_pending",
        error: `Offer is not pending (status: ${offer.offer_status})`,
        context: { offer_id, offer_status: offer.offer_status },
      }, 409);
    }

    // ── 2. Fetch job ─────────────────────────────────────────────────────────
    const { data: job } = await supabase
      .from("jobs")
      .select("job_id, job_status, pickup_location, incident_type_id, vehicle_year, vehicle_make, vehicle_model, estimated_price")
      .eq("job_id", offer.job_id)
      .single();

    if (!job) {
      return jsonResp({ success: false, error_code: "job_not_found", error: "Job not found", context: { job_id: offer.job_id } }, 404);
    }

    // ── 3. Fetch driver ──────────────────────────────────────────────────────
    const { data: driver } = await supabase
      .from("drivers")
      .select("driver_id, driver_name, phone")
      .eq("driver_id", offer.driver_id)
      .single();

    if (!driver?.phone) {
      return jsonResp({
        success: false,
        error_code: "driver_no_phone",
        error: "Driver has no phone number",
        context: { driver_id: offer.driver_id },
      }, 422);
    }

    const phoneCheck = validatePhone(driver.phone);
    if (!phoneCheck.valid) {
      await supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "driver_sms_blocked",
        event_category: "exception",
        message: `Driver phone invalid — driver=${driver.driver_name} reason=${phoneCheck.reason}`,
        new_value: { offer_id, driver_id: offer.driver_id, reason: phoneCheck.reason },
      });
      return jsonResp({
        success: false,
        error_code: "invalid_driver_phone",
        error: `Driver phone invalid: ${phoneCheck.reason}`,
        context: { driver_id: offer.driver_id, phone: driver.phone },
      }, 422);
    }

    // ── 4. Fetch incident type name ──────────────────────────────────────────
    let incidentName = "Roadside assistance";
    if (job.incident_type_id) {
      const { data: incType } = await supabase
        .from("incident_types")
        .select("incident_name")
        .eq("incident_type_id", job.incident_type_id)
        .single();
      if (incType?.incident_name) incidentName = incType.incident_name;
    }

    // ── 5. Build SMS body ────────────────────────────────────────────────────
    const vehicle  = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "Not specified";
    const payout   = job.estimated_price ? `$${Number(job.estimated_price).toFixed(2)}` : "TBD";
    const offerLink = `https://rin-beta.lovable.app/driver/offer/${offer_id}?token=${offer.token ?? ""}`;

    const smsBody =
      `RIN DISPATCH\n` +
      `Pickup: ${job.pickup_location || "See app"}\n` +
      `Issue: ${incidentName}\n` +
      `Vehicle: ${vehicle}\n` +
      `Payout: ${payout}\n\n` +
      `Review offer:\n${offerLink}\n\n` +
      `Reply YES to accept, NO to decline.`;

    // ── 6. Log attempt ───────────────────────────────────────────────────────
    await supabase.from("job_events").insert({
      job_id: offer.job_id,
      event_type: "driver_sms_attempt",
      event_category: "communication",
      message: `Offer SMS attempt — driver=${driver.driver_name} (${phoneCheck.e164}) offer_id=${offer_id}`,
    });

    // ── 7. Send via Twilio ───────────────────────────────────────────────────
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const smsResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: phoneCheck.e164, From: TWILIO_PHONE_NUMBER, Body: smsBody }),
      }
    );

    const smsData = await smsResp.json() as Record<string, unknown>;
    const now = new Date().toISOString();

    if (!smsResp.ok) {
      console.error(`[SEND-OFFER] Twilio failed [${smsResp.status}] — ${JSON.stringify(smsData).slice(0, 200)}`);
      await Promise.all([
        supabase.from("dispatch_offers").update({ sms_sent_at: now, sms_delivery_status: "failed" }).eq("offer_id", offer_id),
        supabase.from("job_events").insert({
          job_id: offer.job_id,
          event_type: "sms_delivery_failed",
          event_category: "communication",
          message: `Offer SMS failed — driver=${driver.driver_name} [${smsResp.status}]: ${JSON.stringify(smsData).slice(0, 200)}`,
          new_value: { offer_id, driver_id: offer.driver_id, http_status: smsResp.status },
        }),
      ]);
      return jsonResp({
        success: false,
        outcome: "sms_failed",
        error_code: "twilio_error",
        error: `Twilio error [${smsResp.status}]`,
        context: { offer_id, twilio_code: smsData.code },
      }, 502);
    }

    // ── 8. Record success ────────────────────────────────────────────────────
    const sid = smsData.sid as string;
    console.log(`[SEND-OFFER] SMS sent — driver=${driver.driver_name} to=${phoneCheck.e164} SID=${sid}`);

    await Promise.all([
      supabase.from("dispatch_offers").update({
        sms_sent_at: now,
        sms_delivery_status: "sent",
      }).eq("offer_id", offer_id),
      supabase.from("drivers").update({
        last_sms_sent_at: now,
        sms_delivery_status: "sent",
      }).eq("driver_id", offer.driver_id),
      supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "driver_sms_sent",
        event_category: "communication",
        message: `Offer SMS sent — driver=${driver.driver_name} (${driver.phone}) SID=${sid}`,
      }),
      supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "offer_sent",
        event_category: "dispatch",
        message: `Offer dispatched to ${driver.driver_name} — offer_id=${offer_id} SID=${sid}`,
        new_value: { offer_id, driver_id: offer.driver_id, driver_name: driver.driver_name, sid },
      }),
    ]);

    // Advance job_status → driver_offer_sent if in a matchable state
    if (TRANSITION_TO_OFFER_SENT.includes(job.job_status)) {
      await supabase.from("jobs").update({ job_status: "driver_offer_sent" }).eq("job_id", offer.job_id);
      await supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "job_status_updated",
        event_category: "dispatch",
        message: `Status: ${job.job_status} → driver_offer_sent (offer_id=${offer_id})`,
      });
      console.log(`[SEND-OFFER] Status: ${job.job_status} → driver_offer_sent`);
    }

    return jsonResp({
      success:     true,
      outcome:     "offer_sent",
      offer_id,
      driver_id:   offer.driver_id,
      driver_name: driver.driver_name,
      sid,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[SEND-OFFER] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});
