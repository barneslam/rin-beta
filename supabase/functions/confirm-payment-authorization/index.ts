import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

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
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });

    const { jobId } = await req.json();
    if (!jobId) {
      return new Response(JSON.stringify({ error: "Missing jobId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, stripe_payment_intent_id, job_status, estimated_price")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!job.stripe_payment_intent_id) {
      return new Response(JSON.stringify({ error: "No payment intent found for this job" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Price integrity gate — block authorization if pricing is missing
    if (!job.estimated_price || job.estimated_price <= 0) {
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "payment_blocked_missing_price",
        event_category: "payment",
        message: "Payment authorization blocked: estimated_price is missing or zero. Dispatcher must set pricing before payment can proceed.",
      });

      return new Response(JSON.stringify({
        success: false,
        error: "Cannot authorize payment: estimated_price is missing or invalid. Dispatcher must set pricing before payment can proceed.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check PaymentIntent status
    const paymentIntent = await stripe.paymentIntents.retrieve(job.stripe_payment_intent_id);

    if (paymentIntent.status === "requires_capture") {
      const oldStatus = job.job_status;

      // 1. Log payment_authorized as an auditable event (kept for audit trail)
      await supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: "Payment authorization succeeded",
        event_type: "status_changed",
        event_source: "stripe",
        old_value: { job_status: oldStatus },
        new_value: { job_status: "payment_authorized", authorization_status: "authorized" },
      });

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "payment_authorized",
        event_category: "payment",
        message: "Customer payment authorization successful",
        new_value: { job_status: "payment_authorized" },
      });

      // 2. Auto-advance to driver_enroute (operational status)
      await supabase
        .from("jobs")
        .update({
          job_status: "driver_enroute",
          authorization_status: "authorized",
        })
        .eq("job_id", jobId);

      // 3. Log the auto-advancement
      await supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: `Status: payment_authorized → driver_enroute (auto-advanced)`,
        event_type: "status_changed",
        event_source: "stripe",
        old_value: { job_status: "payment_authorized" },
        new_value: { job_status: "driver_enroute" },
      });

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "status_changed",
        event_category: "lifecycle",
        message: "Payment authorized — driver en route",
        new_value: { job_status: "driver_enroute" },
      });

      // 4. Customer update event
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "customer_update",
        event_category: "customer_update",
        message: "Payment authorized! Your driver is now on the way.",
      });

      return new Response(JSON.stringify({ success: true, status: "authorized", advanced_to: "driver_enroute" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization failed
    await supabase
      .from("jobs")
      .update({
        job_status: "payment_failed",
        authorization_status: "failed",
      })
      .eq("job_id", jobId);

    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "payment_failed",
      event_category: "payment",
      message: `Payment authorization failed (status: ${paymentIntent.status})`,
    });

    return new Response(JSON.stringify({
      success: false,
      status: "failed",
      stripe_status: paymentIntent.status,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in confirm-payment-authorization:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
