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
    const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY");

    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!STRIPE_PUBLISHABLE_KEY) {
      return new Response(JSON.stringify({ error: "STRIPE_PUBLISHABLE_KEY is not configured" }), {
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
      .select("job_id, estimated_price, stripe_payment_intent_id, job_status")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Price integrity gate — block if pricing is missing (even for existing intents)
    const price = job.estimated_price;
    if (!price || price <= 0) {
      return new Response(JSON.stringify({
        success: false,
        error: "Cannot create payment: estimated_price is missing or invalid. Dispatcher must set pricing first.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If a PaymentIntent already exists, retrieve it and return client_secret
    if (job.stripe_payment_intent_id) {
      const existingIntent = await stripe.paymentIntents.retrieve(job.stripe_payment_intent_id);
      return new Response(JSON.stringify({
        success: true,
        clientSecret: existingIntent.client_secret,
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        amount: existingIntent.amount,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate amount
    const price = job.estimated_price;
    if (!price || price <= 0) {
      return new Response(JSON.stringify({ error: "No valid estimated price on this job" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create PaymentIntent with manual capture (authorization hold only)
    const amountInCents = Math.round(price * 100);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      capture_method: "manual",
      metadata: { job_id: jobId },
    });

    // Save payment intent ID on job
    await supabase
      .from("jobs")
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq("job_id", jobId);

    return new Response(JSON.stringify({
      success: true,
      clientSecret: paymentIntent.client_secret,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      amount: amountInCents,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in create-payment-intent:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
