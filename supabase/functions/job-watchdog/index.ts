/**
 * job-watchdog — scheduled sweep for stuck / stale jobs.
 *
 * Designed to be invoked by a Supabase cron schedule (pg_cron or external).
 * Also callable manually from the dispatcher UI for immediate checks.
 *
 * What it does:
 *   1. Expire stale dispatch_offers (pending but past expires_at)
 *   2. Detect jobs in driver_offer_sent with ALL offers now expired/declined
 *      → move to reassignment_required + set exception_code=no_driver_response
 *   3. Detect jobs with exception_code set — count/surface (no auto-action)
 *   4. Return a structured summary for operator review
 *
 * Note: payment_authorization_required timeouts are handled by check-payment-timeout.
 * This function deliberately does NOT duplicate that logic.
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

    const now = new Date().toISOString();
    console.log(`[WATCHDOG] Starting scan — ${now}`);

    const summary = {
      offers_expired: 0,
      jobs_moved_to_reassignment: 0,
      jobs_with_exceptions: 0,
      exception_breakdown: {} as Record<string, number>,
    };

    // ------------------------------------------------------------------
    // 1. Expire stale pending dispatch_offers
    // ------------------------------------------------------------------
    const { data: staleOffers, error: offerScanErr } = await supabase
      .from("dispatch_offers")
      .select("offer_id, job_id, driver_id, expires_at")
      .eq("offer_status", "pending")
      .lt("expires_at", now);

    if (offerScanErr) {
      console.error(`[WATCHDOG] Error scanning stale offers: ${offerScanErr.message}`);
    } else if (staleOffers && staleOffers.length > 0) {
      console.log(`[WATCHDOG] Found ${staleOffers.length} expired pending offers`);

      // Batch update all expired offers
      const expiredOfferIds = staleOffers.map((o: any) => o.offer_id);
      const { error: expireErr } = await supabase
        .from("dispatch_offers")
        .update({ offer_status: "expired" })
        .in("offer_id", expiredOfferIds);

      if (expireErr) {
        console.error(`[WATCHDOG] Error expiring offers: ${expireErr.message}`);
      } else {
        summary.offers_expired = expiredOfferIds.length;
        console.log(`[WATCHDOG] Expired ${expiredOfferIds.length} offers`);

        // Log one event per unique job affected
        const affectedJobIds = [...new Set(staleOffers.map((o: any) => o.job_id as string))];
        for (const jobId of affectedJobIds) {
          const count = staleOffers.filter((o: any) => o.job_id === jobId).length;
          await supabase.from("job_events").insert({
            job_id: jobId,
            event_type: "offer_expired_by_watchdog",
            event_category: "dispatch",
            message: `Watchdog expired ${count} stale pending offer(s) for this job`,
            new_value: { expired_count: count },
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // 2. Find jobs in driver_offer_sent with no remaining valid offers
    //    → move to reassignment_required
    // ------------------------------------------------------------------
    const { data: dispatchJobs, error: dispatchScanErr } = await supabase
      .from("jobs")
      .select("job_id, created_at")
      .eq("job_status", "driver_offer_sent");

    if (dispatchScanErr) {
      console.error(`[WATCHDOG] Error scanning dispatch jobs: ${dispatchScanErr.message}`);
    } else if (dispatchJobs && dispatchJobs.length > 0) {
      for (const job of dispatchJobs) {
        // Check if any pending offers remain
        const { data: pendingOffers } = await supabase
          .from("dispatch_offers")
          .select("offer_id")
          .eq("job_id", job.job_id)
          .eq("offer_status", "pending");

        if (!pendingOffers || pendingOffers.length === 0) {
          // All offers are expired/declined — no driver responded
          console.log(`[WATCHDOG] Job ${job.job_id} has no pending offers — moving to reassignment_required`);

          const { error: jobUpdateErr } = await supabase
            .from("jobs")
            .update({
              job_status: "reassignment_required",
              exception_code: "no_driver_response",
              exception_message: "All dispatch offers expired or declined with no driver response. Manual reassignment required.",
            })
            .eq("job_id", job.job_id)
            .eq("job_status", "driver_offer_sent"); // guard against concurrent updates

          if (jobUpdateErr) {
            console.error(`[WATCHDOG] Failed to update job ${job.job_id}: ${jobUpdateErr.message}`);
            continue;
          }

          await Promise.all([
            supabase.from("audit_logs").insert({
              job_id: job.job_id,
              action_type: "No driver response — moved to reassignment_required by watchdog",
              event_type: "reassignment_requested",
              event_source: "job_watchdog",
              old_value: { job_status: "driver_offer_sent" },
              new_value: { job_status: "reassignment_required", exception_code: "no_driver_response" },
            }),
            supabase.from("job_events").insert({
              job_id: job.job_id,
              event_type: "no_driver_response",
              event_category: "exception",
              message: "Watchdog: all offers expired/declined with no driver acceptance — job needs manual reassignment",
              new_value: { exception_code: "no_driver_response" },
            }),
          ]);

          summary.jobs_moved_to_reassignment++;
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. Count jobs currently in exception states (observability only)
    // ------------------------------------------------------------------
    const { data: exceptionJobs, error: exScanErr } = await supabase
      .from("jobs")
      .select("job_id, exception_code, job_status")
      .not("exception_code", "is", null);

    if (!exScanErr && exceptionJobs) {
      summary.jobs_with_exceptions = exceptionJobs.length;
      for (const j of exceptionJobs) {
        const code = j.exception_code as string;
        summary.exception_breakdown[code] = (summary.exception_breakdown[code] ?? 0) + 1;
      }
    }

    console.log(`[WATCHDOG] Complete — ${JSON.stringify(summary)}`);

    return new Response(JSON.stringify({ success: true, ...summary, scanned_at: now }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[WATCHDOG] Unhandled error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
