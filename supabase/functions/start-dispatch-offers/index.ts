/**
 * start-dispatch-offers — Batch 8, Dispatch Offers Engine v1
 *
 * Reads the ranked candidate list from the latest match_candidates_generated
 * decision_log and initiates a sequential offer sequence for the job.
 * Expires any stale pending offers before starting.
 *
 * Input:  { job_id: string }
 * Output: { success, outcome, job_id, offer_id?, candidate_count, decision_id }
 *
 * Outcomes:
 *   offer_sent              — first offer created and SMS sent
 *   offer_send_failed       — offer created but Twilio failed
 *   manual_dispatch_required — no match log found (run match-drivers-for-job first)
 *   no_driver_candidates    — match log has empty candidate list
 *   job_not_matchable       — job status not in MATCHABLE_STATUSES
 *   already_assigned        — job already has a driver
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MATCHABLE_STATUSES = [
  "ready_for_dispatch",
  "no_driver_candidates",
  "dispatch_recommendation_ready",
] as const;

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
    const body = await req.json();
    const { job_id } = body;

    if (!job_id) {
      return jsonResp({ success: false, error_code: "missing_params", error: "job_id is required" }, 400);
    }

    console.log(`[START-DISPATCH] job_id=${job_id}`);

    // ── 1. Fetch and validate job ────────────────────────────────────────────
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id")
      .eq("job_id", job_id)
      .maybeSingle();

    if (jobErr || !job) {
      return jsonResp({ success: false, error_code: "job_not_found", error: "Job not found", context: { job_id } }, 404);
    }

    if (job.assigned_driver_id) {
      return jsonResp({ success: true, outcome: "already_assigned", job_id, message: "Job already has a driver assigned" });
    }

    if (!(MATCHABLE_STATUSES as readonly string[]).includes(job.job_status)) {
      return jsonResp({
        success: false,
        error_code: "job_not_matchable",
        outcome: "job_not_matchable",
        job_id,
        job_status: job.job_status,
        error: `Job status '${job.job_status}' is not eligible for dispatch sequencing`,
      });
    }

    // ── 2. Fetch latest match_candidates_generated decision log ──────────────
    const { data: decisionLog, error: dlErr } = await supabase
      .from("decision_logs")
      .select("decision_id, factors")
      .eq("job_id", job_id)
      .eq("decision_outcome", "match_candidates_generated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dlErr || !decisionLog) {
      console.warn(`[START-DISPATCH] No match log found — job_id=${job_id}`);
      await supabase.from("job_events").insert({
        job_id,
        event_type: "dispatch_manual_required",
        event_category: "dispatch",
        message: "No match_candidates_generated log — run match-drivers-for-job first",
      });
      return jsonResp({
        success: true,
        outcome: "manual_dispatch_required",
        job_id,
        message: "No match log found — run match-drivers-for-job first",
      });
    }

    const factors = decisionLog.factors as Record<string, unknown>;
    const ranked_candidates = (factors?.ranked_candidates ?? []) as Array<Record<string, unknown>>;

    if (ranked_candidates.length === 0) {
      return jsonResp({ success: true, outcome: "no_driver_candidates", job_id, decision_id: decisionLog.decision_id });
    }

    console.log(`[START-DISPATCH] ${ranked_candidates.length} candidates from decision_id=${decisionLog.decision_id}`);

    // ── 3. Expire any stale pending offers ───────────────────────────────────
    const { data: pendingOffers } = await supabase
      .from("dispatch_offers")
      .select("offer_id")
      .eq("job_id", job_id)
      .eq("offer_status", "pending");

    if (pendingOffers && pendingOffers.length > 0) {
      await supabase
        .from("dispatch_offers")
        .update({ offer_status: "expired" })
        .eq("job_id", job_id)
        .eq("offer_status", "pending");
      console.log(`[START-DISPATCH] Expired ${pendingOffers.length} stale pending offer(s)`);
    }

    // ── 4. Write dispatch_sequence_started event ─────────────────────────────
    await supabase.from("job_events").insert({
      job_id,
      event_type: "dispatch_sequence_started",
      event_category: "dispatch",
      message: `Dispatch sequence started — ${ranked_candidates.length} candidates from decision_id=${decisionLog.decision_id}`,
      new_value: { decision_id: decisionLog.decision_id, candidate_count: ranked_candidates.length },
    });

    // ── 5. Delegate to create-next-dispatch-offer ────────────────────────────
    const nextResp = await fetch(`${SUPABASE_URL}/functions/v1/create-next-dispatch-offer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job_id }),
    });

    const nextBody = await nextResp.json() as Record<string, unknown>;
    console.log(`[START-DISPATCH] create-next outcome=${nextBody.outcome}`);

    return jsonResp({
      success: true,
      outcome: nextBody.outcome ?? "offer_sent",
      job_id,
      candidate_count: ranked_candidates.length,
      decision_id: decisionLog.decision_id,
      ...nextBody,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[START-DISPATCH] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});
