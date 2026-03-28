/**
 * resolve-dispatch-offer — server-side offer resolution (decline or expire).
 *
 * Replaces client-side useDeclineDispatchOffer / useExpireDispatchOffer mutations.
 * Running server-side ensures DB writes complete even if the browser tab closes
 * mid-expiry (e.g. dispatcher navigates away while countdown hits zero).
 *
 * Request body:
 *   { offerId, jobId, driverId, resolution: "declined" | "expired", driverName? }
 *
 * Actions performed:
 *   - Updates dispatch_offers.offer_status to declined/expired
 *   - For expired: sets sms_delivery_status = "no_response", increments driver no_response_count
 *   - For expired: marks driver sms_delivery_status = "unreachable" after 3 misses
 *   - Clears job reservation (reserved_driver_id, reservation_expires_at)
 *   - Inserts job_event audit record
 *
 * Response:
 *   { success: true, resolution, noResponseCount? }
 *   { success: false, error, code }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NO_RESPONSE_THRESHOLD = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { offerId, jobId, driverId, resolution, driverName } = await req.json();

    if (!offerId || !jobId || !driverId || !resolution) {
      return jsonResp({ success: false, error: "offerId, jobId, driverId, and resolution are required", code: "missing_params" }, 400);
    }

    if (resolution !== "declined" && resolution !== "expired") {
      return jsonResp({ success: false, error: "resolution must be 'declined' or 'expired'", code: "invalid_resolution" }, 400);
    }

    console.log(`[RESOLVE-OFFER] ${resolution} — offerId=${offerId} jobId=${jobId} driverId=${driverId}`);

    // -------------------------------------------------------------------------
    // 1. Update offer status
    // -------------------------------------------------------------------------
    const offerUpdate: Record<string, unknown> = { offer_status: resolution };
    if (resolution === "expired") {
      offerUpdate.sms_delivery_status = "no_response";
    }

    const { error: offerErr } = await supabase
      .from("dispatch_offers")
      .update(offerUpdate)
      .eq("offer_id", offerId);

    if (offerErr) {
      console.error(`[RESOLVE-OFFER] Offer update FAILED — offerId=${offerId} err=${offerErr.message}`);
      return jsonResp({ success: false, error: `Offer update failed: ${offerErr.message}`, code: "offer_update_failed" }, 500);
    }

    // -------------------------------------------------------------------------
    // 2. For expiry: increment driver no_response_count, escalate if threshold hit
    // -------------------------------------------------------------------------
    let noResponseCount: number | undefined;
    if (resolution === "expired") {
      const { data: driverData } = await supabase
        .from("drivers")
        .select("no_response_count")
        .eq("driver_id", driverId)
        .single();

      const currentCount = (driverData?.no_response_count as number) ?? 0;
      noResponseCount = currentCount + 1;

      await supabase
        .from("drivers")
        .update({
          no_response_count: noResponseCount,
          ...(noResponseCount >= NO_RESPONSE_THRESHOLD ? { sms_delivery_status: "unreachable" } : {}),
        })
        .eq("driver_id", driverId);

      console.log(`[RESOLVE-OFFER] Driver no_response_count=${noResponseCount}${noResponseCount >= NO_RESPONSE_THRESHOLD ? " — marked unreachable" : ""}`);
    }

    // -------------------------------------------------------------------------
    // 3. Clear job reservation
    // -------------------------------------------------------------------------
    const { error: jobErr } = await supabase
      .from("jobs")
      .update({ reserved_driver_id: null, reservation_expires_at: null })
      .eq("job_id", jobId);

    if (jobErr) {
      console.warn(`[RESOLVE-OFFER] Job reservation clear non-fatal — jobId=${jobId} err=${jobErr.message}`);
    }

    // -------------------------------------------------------------------------
    // 4. Audit event
    // -------------------------------------------------------------------------
    const label = driverName || driverId.slice(0, 8);
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: resolution === "declined" ? "offer_declined" : "offer_expired",
      event_category: "dispatch",
      message: resolution === "declined"
        ? `Driver ${label} declined job offer`
        : `Driver ${label} offer expired (no response #${noResponseCount})`,
      new_value: {
        offer_id: offerId,
        driver_id: driverId,
        resolution,
        ...(noResponseCount != null ? { no_response_count: noResponseCount } : {}),
      },
    });

    console.log(`[RESOLVE-OFFER] Complete — offerId=${offerId} jobId=${jobId} resolution=${resolution}`);

    return jsonResp({ success: true, resolution, ...(noResponseCount != null ? { noResponseCount } : {}) });
  } catch (error: unknown) {
    console.error("[RESOLVE-OFFER] Unhandled error:", error);
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
