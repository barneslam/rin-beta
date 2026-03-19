import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

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

    const { jobId } = await req.json();
    if (!jobId) {
      return new Response(
        JSON.stringify({ success: false, error: "jobId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch job with user
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, estimated_price, user_id, job_status")
      .eq("job_id", jobId)
      .single();
    if (jobErr || !job) {
      return new Response(
        JSON.stringify({ success: false, error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate estimated_price
    const price = Number(job.estimated_price);
    if (!price || price <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Cannot send payment SMS: estimated_price is missing or invalid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get customer phone
    if (!job.user_id) {
      return new Response(
        JSON.stringify({ success: false, error: "No user linked to this job" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: user } = await supabase
      .from("users")
      .select("phone")
      .eq("user_id", job.user_id)
      .single();

    if (!user?.phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Customer has no phone number on file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send SMS with price included
    const payLink = `https://rin-beta.lovable.app/pay/${job.job_id}`;
    const body = `RIN: Your driver is confirmed. Estimated charge: $${price.toFixed(2)}. Please authorize payment: ${payLink}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!LOVABLE_API_KEY || !TWILIO_API_KEY || !TWILIO_PHONE_NUMBER) {
      return new Response(
        JSON.stringify({ success: false, error: "SMS credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const smsResp = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: user.phone, From: TWILIO_PHONE_NUMBER, Body: body }),
    });

    if (!smsResp.ok) {
      const err = await smsResp.text();
      throw new Error(`Twilio error [${smsResp.status}]: ${err}`);
    }

    // Log event
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "payment_sms_sent",
      event_category: "payment",
      message: `Payment SMS sent to customer ($${price.toFixed(2)})`,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("send-payment-sms error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
