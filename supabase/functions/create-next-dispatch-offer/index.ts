/**
 * create-next-dispatch-offer — Batch 8, Dispatch Offers Engine v1
 *
 * Picks the next untried driver from the ranked candidate list stored in the
 * latest match_candidates_generated decision_log and creates a dispatch offer.
 * Called by start-dispatch-offers (to begin) and respond-dispatch-offer (on decline/expire).
 *
 * Input:  { job_id: string }
 * Output: { success, outcome, job_id, offer_id?, driver_id?, driver_name?, rank? }
 *
 * Outcomes:
 *   offer_sent              — offer created and SMS delivered
 *   offer_send_failed       — offer created but Twilio failed (offer still exists)
 *   no_driver_candidates    — all ranked candidates exhausted; job → no_driver_candidates
 *   manual_dispatch_required — no match log found
 *   already_assigned        — job already has a driver
 *   pending_offer_exists    — race guard: a pending offer already exists
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OFFER_TTL_SECONDS = 300; // 5 minutes

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
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { job_id } = await req.json();
    if (!job_id) return jsonResp({ success: false, error_code: "missing_params", error: "job_id is required" }, 400);

    console.log(`[NEXT-OFFER] job_id=${job_id}`);

    // ── 1. Fetch job ─────────────────────────────────────────────────────────
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id, dispatch_attempt_count")
      .eq("job_id", job_id)
      .maybeSingle();

    if (jobErr || !job) {
      return jsonResp({ success: false, error_code: "job_not_found", error: "Job not found", context: { job_id } }, 404);
    }

    if (job.assigned_driver_id) {
      return jsonResp({ success: true, outcome: "already_assigned", job_id });
    }

    // ── 2. Fetch latest match_candidates_generated decision log ──────────────
    const { data: decisionLog } = await supabase
      .from("decision_logs")
      .select("decision_id, factors")
      .eq("job_id", job_id)
      .eq("decision_outcome", "match_candidates_generated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!decisionLog) {
      return jsonResp({ success: true, outcome: "manual_dispatch_required", job_id, error: "No match log found" });
    }

    const ranked_candidates = (
      (decisionLog.factors as Record<string, unknown>)?.ranked_candidates ?? []
    ) as Array<Record<string, unknown>>;

    // ── 3. Fetch all driver_ids already tried for this job ───────────────────
    const { data: triedOffers } = await supabase
      .from("dispatch_offers")
      .select("driver_id")
      .eq("job_id", job_id);

    const triedDriverIds = new Set<string>(
      (triedOffers ?? []).map((o: { driver_id: string }) => o.driver_id)
    );

    console.log(`[NEXT-OFFER] Tried ${triedDriverIds.size} / ${ranked_candidates.length} candidates`);

    const nextCandidate = ranked_candidates.find(
      (c) => !triedDriverIds.has(c.driver_id as string)
    );

    // ── 4. Pool exhausted ────────────────────────────────────────────────────
    if (!nextCandidate) {
      console.log(`[NEXT-OFFER] All candidates exhausted — job_id=${job_id}`);

      await supabase.from("jobs").update({
        job_status: "no_driver_candidates",
        dispatch_attempt_count: (job.dispatch_attempt_count ?? 0) + 1,
      }).eq("job_id", job_id);

      await supabase.from("job_events").insert({
        job_id,
        event_type: "no_candidates_remaining",
        event_category: "dispatch",
        message: `All ${ranked_candidates.length} candidates exhausted — no drivers available`,
        new_value: { tried_count: triedDriverIds.size, total_candidates: ranked_candidates.length },
      });

      await supabase.from("decision_logs").insert({
        job_id,
        decision_type:    "dispatch",
        decision_outcome: "no_eligible_drivers",
        decided_by:       "system",
        confidence:       0,
        factors: {
          reason:           "all_candidates_exhausted",
          tried_count:      triedDriverIds.size,
          total_candidates: ranked_candidates.length,
          source_decision_id: decisionLog.decision_id,
        },
      });

      return jsonResp({
        success:         true,
        outcome:         "no_driver_candidates",
        job_id,
        tried_count:     triedDriverIds.size,
        total_candidates: ranked_candidates.length,
      });
    }

    const driverId   = nextCandidate.driver_id   as string;
    const truckId    = (nextCandidate.truck_id    as string | null) ?? null;
    const driverName = nextCandidate.driver_name  as string;
    const rank       = nextCandidate.rank         as number;
    const score      = nextCandidate.score        as number;

    // ── 5. Guard: no active pending offer already for this job ───────────────
    const { data: existingPending } = await supabase
      .from("dispatch_offers")
      .select("offer_id")
      .eq("job_id", job_id)
      .eq("offer_status", "pending")
      .maybeSingle();

    if (existingPending) {
      console.warn(`[NEXT-OFFER] Pending offer already exists — offer_id=${existingPending.offer_id}`);
      return jsonResp({
        success: false,
        error_code: "pending_offer_exists",
        error: "A pending offer already exists for this job",
        context: { job_id, existing_offer_id: existingPending.offer_id },
      }, 409);
    }

    // ── 6. Insert dispatch_offer ─────────────────────────────────────────────
    const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();

    const { data: offer, error: insertErr } = await supabase
      .from("dispatch_offers")
      .insert({
        job_id,
        driver_id:    driverId,
        truck_id:     truckId,
        offer_status: "pending",
        expires_at:   expiresAt,
      })
      .select("offer_id, driver_id, truck_id, expires_at, token")
      .single();

    if (insertErr || !offer) {
      console.error(`[NEXT-OFFER] Insert failed — ${insertErr?.message}`);
      return jsonResp({
        success: false,
        error_code: "offer_insert_failed",
        error: insertErr?.message ?? "Failed to create offer",
      }, 500);
    }

    console.log(`[NEXT-OFFER] Offer created — offer_id=${offer.offer_id} driver=${driverName} rank=${rank}`);

    await supabase.from("job_events").insert({
      job_id,
      event_type: "offer_created",
      event_category: "dispatch",
      message: `Offer created for ${driverName} (rank ${rank}, score ${score}) — offer_id=${offer.offer_id}`,
      new_value: {
        offer_id: offer.offer_id, driver_id: driverId,
        driver_name: driverName, rank, score, expires_at: expiresAt,
      },
    });

    // ── 7. Call send-driver-offer ────────────────────────────────────────────
    const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/send-driver-offer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ offer_id: offer.offer_id }),
    });

    const sendBody = await sendResp.json() as Record<string, unknown>;
    const smsFailed = !sendResp.ok || !sendBody.success;

    return jsonResp({
      success:     true,
      outcome:     smsFailed ? "offer_send_failed" : "offer_sent",
      job_id,
      offer_id:    offer.offer_id,
      driver_id:   driverId,
      driver_name: driverName,
      rank,
      score,
      expires_at:  expiresAt,
      sms:         sendBody,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[NEXT-OFFER] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});
