import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Must match PAYMENT_EXPIRY_MINUTES in src/lib/paymentConstants.ts
const EXPIRY_MINUTES = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find stale jobs
    const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { data: staleJobs, error } = await supabase
      .from("jobs")
      .select("job_id, updated_at, assigned_driver_id")
      .eq("job_status", "payment_authorization_required")
      .lt("updated_at", cutoff);

    if (error) throw error;

    if (!staleJobs || staleJobs.length === 0) {
      return new Response(JSON.stringify({ expired: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let expiredCount = 0;

    for (const job of staleJobs) {
      await supabase
        .from("jobs")
        .update({
          job_status: "payment_failed",
          authorization_status: "expired",
          customer_update_message: "Payment authorization expired — no payment received within time limit.",
        })
        .eq("job_id", job.job_id);

      await supabase.from("audit_logs").insert({
        job_id: job.job_id,
        action_type: `Payment authorization timed out after ${EXPIRY_MINUTES} minutes`,
        event_type: "status_changed",
        event_source: "payment_timeout",
        old_value: { job_status: "payment_authorization_required" },
        new_value: { job_status: "payment_failed", authorization_status: "expired" },
      });

      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "payment_timeout",
        event_category: "payment",
        message: `Payment authorization expired after ${EXPIRY_MINUTES} minutes — job marked as payment_failed`,
      });

      expiredCount++;
    }

    return new Response(JSON.stringify({ expired: expiredCount, jobs: staleJobs.map((j) => j.job_id) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in check-payment-timeout:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
