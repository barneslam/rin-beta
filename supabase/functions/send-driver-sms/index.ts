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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY is not configured");

    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { offerId, jobId, driverId } = await req.json();
    if (!offerId || !jobId || !driverId) {
      return new Response(JSON.stringify({ error: "Missing offerId, jobId, or driverId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch offer (for token)
    const { data: offer, error: offerErr } = await supabase
      .from("dispatch_offers")
      .select("token")
      .eq("offer_id", offerId)
      .single();
    if (offerErr || !offer) throw new Error("Offer not found");

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("pickup_location, incident_type_id, vehicle_year, vehicle_make, vehicle_model, estimated_price")
      .eq("job_id", jobId)
      .single();
    if (jobErr || !job) throw new Error("Job not found");

    // Fetch driver
    const { data: driver, error: driverErr } = await supabase
      .from("drivers")
      .select("phone, driver_name")
      .eq("driver_id", driverId)
      .single();
    if (driverErr || !driver) throw new Error("Driver not found");
    if (!driver.phone) throw new Error("Driver has no phone number");
    if (!/^\+[1-9]\d{6,14}$/.test(driver.phone)) {
      throw new Error(`Driver phone "${driver.phone}" is not a valid E.164 number (must start with + and country code, e.g. +15551234567)`);
    }

    // Fetch incident type name
    let incidentName = "Roadside assistance";
    if (job.incident_type_id) {
      const { data: incType } = await supabase
        .from("incident_types")
        .select("incident_name")
        .eq("incident_type_id", job.incident_type_id)
        .single();
      if (incType) incidentName = incType.incident_name;
    }

    // Build vehicle summary
    const vehicleParts = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean);
    const vehicleSummary = vehicleParts.length > 0 ? vehicleParts.join(" ") : "Not specified";

    // Build payout
    const payout = job.estimated_price ? `$${Number(job.estimated_price).toFixed(2)}` : "TBD";

    // Build secure link — use the published site URL or preview URL
    const siteUrl = Deno.env.get("SITE_URL") || `${SUPABASE_URL.replace(".supabase.co", "").replace("https://", "https://id-preview--")}.lovable.app`;
    // Fallback: use a known published URL if available
    const offerLink = `https://rin-beta.lovable.app/driver/offer/${offerId}?token=${offer.token}`;

    const smsBody = `RIN DISPATCH
Pickup: ${job.pickup_location || "See app"}
Issue: ${incidentName}
Vehicle: ${vehicleSummary}
Payout: ${payout}

Review offer:
${offerLink}

Reply YES to accept, NO to decline.`;

    // Send SMS via Twilio gateway
    const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: driver.phone,
        From: TWILIO_PHONE_NUMBER,
        Body: smsBody,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Twilio API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    console.log(`SMS sent to ${driver.driver_name} (${driver.phone}), SID: ${data.sid}`);

    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending driver SMS:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
