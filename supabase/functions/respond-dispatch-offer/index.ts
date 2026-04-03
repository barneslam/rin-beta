/**
 * respond-dispatch-offer — Batch 8, Dispatch Offers Engine v1
 *
 * Unified YES/NO entry point for the automated dispatch engine.
 * Accept delegates to accept-driver-offer (existing, handles all state + SMS).
 * Decline resolves the offer then triggers create-next-dispatch-offer for continuity.
 *
 * Input:  { offer_id: string, response: 'accept' | 'decline', source?: string }
 * Output: { success, outcome, offer_id, job_id, next? }
 *
 * Outcomes:
 *   driver_assigned      — driver accepted; job assigned
 *   offer_declined       — driver declined; next offer issued
 *   no_driver_candidates — driver declined; all candidates exhausted
 *   already_responded    — offer already resolved (idempotent)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { offer_id, response, source = "system" } = body;

    if (!offer_id || !response) {
      return jsonResp({ success: false, error_code: "missing_params", error: "offer_id and response are required" }, 400);
    }
    if (response !== "accept" && response !== "decline") {
      return jsonResp({ success: false, error_code: "invalid_response", error: "response must be 'accept' or 'decline'" }, 400);
    }

    console.log(`[RESPOND-OFFER] offer_id=${offer_id} response=${response} source=${source}`);

    // ── Fetch offer ──────────────────────────────────────────────────────────
    const { data: offer, error: offerErr } = await supabase
      .from("dispatch_offers")
      .select("offer_id, job_id, driver_id, offer_status, expires_at")
      .eq("offer_id", offer_id)
      .maybeSingle();

    if (offerErr || !offer) {
      return jsonResp({ success: false, error_code: "offer_not_found", error: "Offer not found", context: { offer_id } }, 404);
    }

    // Idempotency: already resolved
    if (offer.offer_status !== "pending") {
      return jsonResp({
        success: true,
        outcome: "already_responded",
        offer_id,
        offer_status: offer.offer_status,
        message: `Offer already resolved (status: ${offer.offer_status})`,
      });
    }

    // ── ACCEPT ───────────────────────────────────────────────────────────────
    if (response === "accept") {
      const acceptResp = await fetch(`${SUPABASE_URL}/functions/v1/accept-driver-offer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ offerId: offer_id, source }),
      });
      const acceptBody = await acceptResp.json() as Record<string, unknown>;

      if (!acceptResp.ok || !acceptBody.success) {
        return jsonResp({
          success: false,
          error_code: (acceptBody.error_code as string) ?? "accept_failed",
          error: (acceptBody.error as string) ?? "Accept failed",
          context: { offer_id },
        }, acceptResp.status || 500);
      }

      return jsonResp({
        success:   true,
        outcome:   "driver_assigned",
        offer_id,
        driver_id: offer.driver_id,
        job_id:    offer.job_id,
        accept:    acceptBody,
      });
    }

    // ── DECLINE ──────────────────────────────────────────────────────────────

    // 1. Fetch driver name for audit
    const { data: driver } = await supabase
      .from("drivers")
      .select("driver_name")
      .eq("driver_id", offer.driver_id)
      .single();

    // 2. Resolve offer as declined
    const resolveResp = await fetch(`${SUPABASE_URL}/functions/v1/resolve-dispatch-offer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        offerId:    offer_id,
        jobId:      offer.job_id,
        driverId:   offer.driver_id,
        driverName: driver?.driver_name ?? null,
        resolution: "declined",
      }),
    });
    const resolveBody = await resolveResp.json() as Record<string, unknown>;

    if (!resolveResp.ok || !resolveBody.success) {
      console.error(`[RESPOND-OFFER] Resolve failed — ${resolveBody.error}`);
      return jsonResp({
        success: false,
        error_code: "resolve_failed",
        error: (resolveBody.error as string) ?? "Failed to resolve offer",
        context: { offer_id },
      }, 500);
    }

    // 3. Trigger next candidate
    const nextResp = await fetch(`${SUPABASE_URL}/functions/v1/create-next-dispatch-offer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job_id: offer.job_id }),
    });
    const nextBody = await nextResp.json() as Record<string, unknown>;
    const nextOutcome = nextBody.outcome as string;

    return jsonResp({
      success:            true,
      outcome:            nextOutcome === "no_driver_candidates" ? "no_driver_candidates" : "offer_declined",
      offer_id,
      declined_driver_id: offer.driver_id,
      job_id:             offer.job_id,
      next:               nextBody,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[RESPOND-OFFER] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});
