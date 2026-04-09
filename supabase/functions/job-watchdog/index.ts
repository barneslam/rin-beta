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
      jobs_auto_cancelled: 0,
      exception_breakdown: {} as Record<string, number>,
    };

    // Load business rules for timeouts
    const { data: maxAttemptsRule } = await supabase.rpc("get_rule", { p_key: "dispatch.max_attempts" });
    const { data: confirmTimeoutRule } = await supabase.rpc("get_rule", { p_key: "workflow.customer_confirmation_timeout" });
    const { data: priceTimeoutRule } = await supabase.rpc("get_rule", { p_key: "workflow.price_approval_timeout" });
    const { data: paymentTimeoutRule } = await supabase.rpc("get_rule", { p_key: "workflow.payment_timeout" });

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
    //    → re-queue for retry (up to MAX_DISPATCH_RETRIES), then reassignment_required
    //    Customer is notified via SMS at each stage.
    // ------------------------------------------------------------------
    const MAX_DISPATCH_RETRIES = (maxAttemptsRule?.value as number) ?? 3;

    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    const twilioReady = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);

    async function sendCustomerSms(phone: string, message: string): Promise<void> {
      if (!twilioReady) return;
      const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: phone, From: TWILIO_PHONE_NUMBER!, Body: message }),
        }
      ).catch((e) => console.error(`[WATCHDOG] Customer SMS failed: ${e}`));
    }

    const { data: dispatchJobs, error: dispatchScanErr } = await supabase
      .from("jobs")
      .select("job_id, user_id, created_at")
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
          // All offers expired/declined — count prior retry events for this job
          const { count: retryCount } = await supabase
            .from("job_events")
            .select("event_id", { count: "exact", head: true })
            .eq("job_id", job.job_id)
            .eq("event_type", "no_driver_response");

          const attemptsUsed = retryCount ?? 0;
          const isMaxRetries = attemptsUsed >= MAX_DISPATCH_RETRIES;

          console.log(`[WATCHDOG] Job ${job.job_id} — no pending offers, retry_count=${attemptsUsed} max=${MAX_DISPATCH_RETRIES} escalate=${isMaxRetries}`);

          // Fetch customer phone for SMS
          let customerPhone: string | null = null;
          if (job.user_id) {
            const { data: user } = await supabase
              .from("users")
              .select("phone")
              .eq("user_id", job.user_id)
              .single();
            customerPhone = user?.phone ?? null;
          }

          if (isMaxRetries) {
            // Max retries reached — escalate to dispatcher
            const { error: jobUpdateErr } = await supabase
              .from("jobs")
              .update({
                job_status: "reassignment_required",
                exception_code: "no_driver_available",
                exception_message: `No driver found after ${attemptsUsed} attempts. Manual reassignment required.`,
              })
              .eq("job_id", job.job_id)
              .eq("job_status", "driver_offer_sent");

            if (jobUpdateErr) {
              console.error(`[WATCHDOG] Failed to escalate job ${job.job_id}: ${jobUpdateErr.message}`);
              continue;
            }

            if (customerPhone) {
              await sendCustomerSms(
                customerPhone,
                `RIN: We're having difficulty finding an available driver near you right now. Our dispatcher will contact you shortly to arrange assistance.`
              );
            }

            await Promise.all([
              supabase.from("audit_logs").insert({
                job_id: job.job_id,
                action_type: `No driver after ${attemptsUsed} attempts — escalated to reassignment_required`,
                event_type: "reassignment_requested",
                event_source: "job_watchdog",
                old_value: { job_status: "driver_offer_sent" },
                new_value: { job_status: "reassignment_required", exception_code: "no_driver_available" },
              }),
              supabase.from("job_events").insert({
                job_id: job.job_id,
                event_type: "no_driver_available",
                event_category: "exception",
                message: `Watchdog: no driver found after ${attemptsUsed} retries — escalated to dispatcher`,
                new_value: { exception_code: "no_driver_available", retry_count: attemptsUsed },
              }),
            ]);

            summary.jobs_moved_to_reassignment++;
            console.log(`[WATCHDOG] Job ${job.job_id} escalated after ${attemptsUsed} retries`);

          } else {
            // Retries remaining — re-queue for another dispatch wave
            const nextAttempt = attemptsUsed + 1;

            const { error: jobUpdateErr } = await supabase
              .from("jobs")
              .update({
                job_status: "ready_for_dispatch",
                exception_code: null,
                exception_message: null,
              })
              .eq("job_id", job.job_id)
              .eq("job_status", "driver_offer_sent");

            if (jobUpdateErr) {
              console.error(`[WATCHDOG] Failed to re-queue job ${job.job_id}: ${jobUpdateErr.message}`);
              continue;
            }

            if (customerPhone) {
              await sendCustomerSms(
                customerPhone,
                `RIN: We're still searching for an available driver near you (attempt ${nextAttempt} of ${MAX_DISPATCH_RETRIES}). We'll keep trying and notify you as soon as a driver is confirmed.`
              );
            }

            await supabase.from("job_events").insert({
              job_id: job.job_id,
              event_type: "no_driver_response",
              event_category: "dispatch",
              message: `Watchdog: no driver accepted — re-queued for dispatch (attempt ${nextAttempt} of ${MAX_DISPATCH_RETRIES})`,
              new_value: { job_status: "ready_for_dispatch", retry_attempt: nextAttempt },
            });

            console.log(`[WATCHDOG] Job ${job.job_id} re-queued — attempt ${nextAttempt} of ${MAX_DISPATCH_RETRIES}`);
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. Enforce workflow timeouts from business_rules
    // ------------------------------------------------------------------
    const timeoutChecks = [
      {
        status: "pending_customer_confirmation",
        timeoutSeconds: (confirmTimeoutRule?.value as number) ?? 300,
        action: "cancel",
        reason: "Customer did not confirm within timeout",
      },
      {
        status: "pending_customer_price_approval",
        timeoutSeconds: (priceTimeoutRule?.value as number) ?? 180,
        action: "cancel",
        reason: "Customer did not approve price within timeout",
      },
      {
        status: "payment_authorization_required",
        timeoutSeconds: (paymentTimeoutRule?.value as number) ?? 420,
        action: "cancel",
        reason: "Payment not completed within timeout",
      },
    ];

    for (const check of timeoutChecks) {
      const cutoff = new Date(Date.now() - check.timeoutSeconds * 1000).toISOString();
      const { data: timedOutJobs } = await supabase
        .from("jobs")
        .select("job_id, user_id, updated_at")
        .eq("job_status", check.status)
        .lt("updated_at", cutoff);

      if (timedOutJobs && timedOutJobs.length > 0) {
        for (const timedOut of timedOutJobs) {
          console.log(`[WATCHDOG] Timeout: job ${timedOut.job_id} in ${check.status} for >${check.timeoutSeconds}s — action: ${check.action}`);

          if (check.action === "cancel") {
            await supabase.from("jobs").update({
              job_status: "cancelled_by_customer",
              cancelled_reason: check.reason,
              cancelled_by: "system_watchdog",
            }).eq("job_id", timedOut.job_id);

            await supabase.from("job_events").insert({
              job_id: timedOut.job_id,
              event_type: "auto_cancelled",
              event_category: "lifecycle",
              message: `Watchdog: ${check.reason} (timeout: ${check.timeoutSeconds}s)`,
              new_value: { auto_action: check.action, timeout_seconds: check.timeoutSeconds },
            });

            // Notify customer if possible
            if (timedOut.user_id) {
              const { data: user } = await supabase.from("users").select("phone").eq("user_id", timedOut.user_id).single();
              if (user?.phone) {
                await sendCustomerSms(user.phone, `RIN: Your roadside request has been cancelled due to inactivity. Please submit a new request if you still need assistance.`);
              }
            }

            summary.jobs_auto_cancelled++;
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 4. Count jobs currently in exception states (observability only)
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
