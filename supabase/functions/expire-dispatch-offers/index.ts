/**
 * expire-dispatch-offers — Batch 8, Dispatch Offers Engine v1
 *
 * Watchdog: finds all pending dispatch_offers whose expires_at is in the past,
 * resolves each as expired (increments driver no_response_count), then triggers
 * create-next-dispatch-offer to continue the sequence for each affected job.
 *
 * Called by: pg_cron schedule, job-watchdog, or manually with service role key.
 * Input:  {} (no body required)
 * Output: { success, expired_count, jobs_advanced, errors[] }
 *
 * Idempotent: safe to call multiple times; already-expired offers are skipped.
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
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log("[EXPIRE-OFFERS] Watchdog triggered");

    // ── 1. Find all expired pending offers ───────────────────────────────────
    const { data: expiredOffers, error: fetchErr } = await supabase
      .from("dispatch_offers")
      .select("offer_id, job_id, driver_id")
      .eq("offer_status", "pending")
      .lt("expires_at", new Date().toISOString());

    if (fetchErr) {
      return jsonResp({ success: false, error_code: "db_error", error: fetchErr.message }, 500);
    }

    if (!expiredOffers || expiredOffers.length === 0) {
      console.log("[EXPIRE-OFFERS] No expired pending offers");
      return jsonResp({ success: true, expired_count: 0, jobs_advanced: 0, errors: [] });
    }

    console.log(`[EXPIRE-OFFERS] Found ${expiredOffers.length} expired offer(s)`);

    const errors: string[] = [];
    let expiredCount = 0;
    let jobsAdvanced = 0;

    for (const expiredOffer of expiredOffers as Array<{ offer_id: string; job_id: string; driver_id: string }>) {
      try {
        // 2a. Resolve as expired (increments driver no_response_count)
        const resolveResp = await fetch(`${SUPABASE_URL}/functions/v1/resolve-dispatch-offer`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            offerId:    expiredOffer.offer_id,
            jobId:      expiredOffer.job_id,
            driverId:   expiredOffer.driver_id,
            resolution: "expired",
          }),
        });
        const resolveBody = await resolveResp.json() as Record<string, unknown>;

        if (!resolveResp.ok || !resolveBody.success) {
          errors.push(`Resolve failed for offer ${expiredOffer.offer_id}: ${resolveBody.error}`);
          continue;
        }

        expiredCount++;
        console.log(`[EXPIRE-OFFERS] Offer ${expiredOffer.offer_id} expired (no_response_count=${resolveBody.noResponseCount})`);

        // 2b. Trigger next candidate for this job
        const nextResp = await fetch(`${SUPABASE_URL}/functions/v1/create-next-dispatch-offer`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ job_id: expiredOffer.job_id }),
        });
        const nextBody = await nextResp.json() as Record<string, unknown>;
        const nextOutcome = nextBody.outcome as string;

        console.log(`[EXPIRE-OFFERS] job=${expiredOffer.job_id} next outcome=${nextOutcome}`);

        if (nextOutcome === "offer_sent" || nextOutcome === "no_driver_candidates") {
          jobsAdvanced++;
        }

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`offer ${expiredOffer.offer_id}: ${msg}`);
      }
    }

    console.log(`[EXPIRE-OFFERS] Done — expired=${expiredCount} advanced=${jobsAdvanced} errors=${errors.length}`);

    return jsonResp({
      success:       true,
      expired_count: expiredCount,
      jobs_advanced: jobsAdvanced,
      errors,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[EXPIRE-OFFERS] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});
