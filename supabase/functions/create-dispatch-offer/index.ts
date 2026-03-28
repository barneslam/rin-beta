/**
 * create-dispatch-offer — server-side offer creation with full audit trail.
 *
 * Called by the dispatcher UI instead of writing dispatch_offers directly.
 * Running server-side ensures:
 *   - Insert is confirmed before the UI renders "Offer Sent"
 *   - Full structured logs for every offer created
 *   - Single source of truth — no client/server project mismatch possible
 *
 * Request body:
 *   { jobId, driverId, truckId, expiresAt }
 *
 * Response:
 *   { success: true, offer: { offer_id, job_id, driver_id, offer_status, expires_at, ... } }
 *   { success: false, error: "...", code: "..." }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { jobId, driverId, truckId, expiresAt } = await req.json();

    console.log(`[CREATE-OFFER] Received — jobId=${jobId} driverId=${driverId} truckId=${truckId} expiresAt=${expiresAt}`);

    // ------------------------------------------------------------------
    // Validate required fields
    // ------------------------------------------------------------------
    if (!jobId || !driverId) {
      return jsonResp({ success: false, error: "jobId and driverId are required", code: "missing_params" }, 400);
    }

    // ------------------------------------------------------------------
    // Confirm the job exists and is in a dispatchable state
    // ------------------------------------------------------------------
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id, user_id, incident_type_id, can_vehicle_roll, gps_lat, gps_long, pickup_location")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      console.error(`[CREATE-OFFER] Job not found — jobId=${jobId} err=${jobErr?.message}`);
      return jsonResp({ success: false, error: "Job not found", code: "job_not_found" }, 404);
    }

    console.log(`[CREATE-OFFER] Job found — job_status=${job.job_status}`);

    // Guard: waiting for customer confirmation
    if (job.job_status === "pending_customer_confirmation") {
      console.warn(`[CREATE-OFFER] Job awaiting customer confirmation — job_id=${jobId} status=${job.job_status}`);
      return jsonResp({
        success: false,
        error: "Job is awaiting customer confirmation — dispatch is blocked until the customer confirms",
        code: "pending_customer_confirmation",
      }, 409);
    }

    // Guard: validation — required dispatch fields must be present
    const missingFields: string[] = [];
    if (!job.incident_type_id) missingFields.push("incident_type_id");
    if (job.can_vehicle_roll == null) missingFields.push("can_vehicle_roll");
    if (!job.gps_lat && !job.gps_long && !job.pickup_location) missingFields.push("location");
    if (missingFields.length > 0) {
      console.warn(`[CREATE-OFFER] Validation failed — job_id=${jobId} missing=${missingFields.join(",")}`);
      return jsonResp({
        success: false,
        error: `Job is not ready for dispatch — missing required fields: ${missingFields.join(", ")}`,
        code: "validation_failed",
        missingFields,
      }, 422);
    }

    // Guard: already assigned
    if (job.assigned_driver_id) {
      console.warn(`[CREATE-OFFER] Job already has driver assigned — assigned_driver_id=${job.assigned_driver_id}`);
      return jsonResp({
        success: false,
        error: "Job already has a driver assigned",
        code: "already_assigned",
      }, 409);
    }

    // ------------------------------------------------------------------
    // Guard: abort if a pending offer already exists for this job
    // ------------------------------------------------------------------
    const { data: existingPending } = await supabase
      .from("dispatch_offers")
      .select("offer_id, driver_id, expires_at")
      .eq("job_id", jobId)
      .eq("offer_status", "pending")
      .maybeSingle();

    if (existingPending) {
      const isExpired = existingPending.expires_at && new Date(existingPending.expires_at).getTime() < Date.now();
      if (!isExpired) {
        console.warn(`[CREATE-OFFER] Duplicate — active pending offer already exists — offer_id=${existingPending.offer_id}`);
        // Return the existing offer rather than creating a duplicate
        const { data: fullOffer } = await supabase
          .from("dispatch_offers")
          .select("*")
          .eq("offer_id", existingPending.offer_id)
          .single();
        return jsonResp({ success: true, offer: fullOffer, duplicate: true }, 200);
      }
      // Expired pending offer — expire it cleanly and proceed
      await supabase
        .from("dispatch_offers")
        .update({ offer_status: "expired" })
        .eq("offer_id", existingPending.offer_id);
      console.log(`[CREATE-OFFER] Expired stale pending offer — offer_id=${existingPending.offer_id}`);
    }

    // ------------------------------------------------------------------
    // Insert the offer
    // ------------------------------------------------------------------
    const offerPayload = {
      job_id: jobId,
      driver_id: driverId,
      truck_id: truckId ?? null,
      offer_status: "pending" as const,
      expires_at: expiresAt ?? new Date(Date.now() + 150 * 1000).toISOString(),
    };

    const { data: offer, error: insertErr } = await supabase
      .from("dispatch_offers")
      .insert(offerPayload)
      .select()
      .single();

    if (insertErr || !offer) {
      console.error(`[CREATE-OFFER] Insert FAILED — jobId=${jobId} driverId=${driverId} err=${insertErr?.message} code=${insertErr?.code}`);
      return jsonResp({
        success: false,
        error: `DB insert failed: ${insertErr?.message ?? "unknown"}`,
        code: insertErr?.code ?? "insert_failed",
      }, 500);
    }

    console.log(`[CREATE-OFFER] Insert OK — offer_id=${offer.offer_id} job_id=${offer.job_id} user_id=${job.user_id} driver_id=${offer.driver_id} offer_status=${offer.offer_status} expires_at=${offer.expires_at}`);

    // ------------------------------------------------------------------
    // Write job_event for audit trail
    // ------------------------------------------------------------------
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "offer_created",
      event_category: "dispatch",
      message: `Offer created for driver ${driverId} — offer_id=${offer.offer_id}`,
      new_value: {
        offer_id: offer.offer_id,
        driver_id: driverId,
        truck_id: truckId,
        expires_at: offer.expires_at,
      },
    });

    return jsonResp({ success: true, offer });
  } catch (error: unknown) {
    console.error("[CREATE-OFFER] Unhandled error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResp({ success: false, error: msg, code: "unhandled" }, 500);
  }
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
