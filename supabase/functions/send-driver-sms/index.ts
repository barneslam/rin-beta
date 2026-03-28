import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePhone } from "../_shared/phone.ts";

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
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    if (!TWILIO_ACCOUNT_SID) throw new Error("TWILIO_ACCOUNT_SID is not configured");

    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!TWILIO_AUTH_TOKEN) throw new Error("TWILIO_AUTH_TOKEN is not configured");

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

    const driverPhoneCheck = validatePhone(driver.phone);
    console.log(`[DRIVER-SMS] Phone check — raw="${driver.phone}" e164="${driverPhoneCheck.e164}" valid=${driverPhoneCheck.valid} reason=${driverPhoneCheck.reason ?? "ok"}`);
    if (!driverPhoneCheck.valid) {
      throw new Error(
        `Driver phone "${driver.phone}" is invalid (${driverPhoneCheck.reason}) — SMS blocked. ` +
        `Update driver record with a valid E.164 number (e.g. +14165550100).`
      );
    }
    const driverE164 = driverPhoneCheck.e164;

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

    // Build secure link
    const offerLink = `https://rin-beta.lovable.app/driver/offer/${offerId}?token=${offer.token}`;

    const smsBody = `RIN DISPATCH
Pickup: ${job.pickup_location || "See app"}
Issue: ${incidentName}
Vehicle: ${vehicleSummary}
Payout: ${payout}

Review offer:
${offerLink}

Reply YES to accept, NO to decline.`;

    // Send SMS via Twilio direct
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: driverE164,
          From: TWILIO_PHONE_NUMBER,
          Body: smsBody,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      // Track SMS delivery failure on the offer and driver
      const now = new Date().toISOString();
      await Promise.all([
        supabase.from("dispatch_offers").update({
          sms_sent_at: now,
          sms_delivery_status: "failed",
        }).eq("offer_id", offerId),
        supabase.from("drivers").update({
          last_sms_sent_at: now,
          sms_delivery_status: "failed",
        }).eq("driver_id", driverId),
        supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "sms_delivery_failed",
          event_category: "communication",
          message: `Driver SMS to ${driver.driver_name} (${driver.phone}) failed: ${JSON.stringify(data)}`,
        }),
      ]);
      throw new Error(`Twilio API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    // Track successful SMS send on offer and driver, log SID in job_events
    const now = new Date().toISOString();
    await Promise.all([
      supabase.from("dispatch_offers").update({
        sms_sent_at: now,
        sms_delivery_status: "sent",
      }).eq("offer_id", offerId),
      supabase.from("drivers").update({
        last_sms_sent_at: now,
        sms_delivery_status: "sent",
      }).eq("driver_id", driverId),
      supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "driver_sms_sent",
        event_category: "communication",
        message: `Offer SMS sent to ${driver.driver_name} (${driver.phone}) — Twilio SID: ${data.sid}`,
      }),
    ]);

    console.log(`[DRIVER-SMS] Sent — driver=${driver.driver_name} to=${driverE164} job=${jobId} offer=${offerId} SID=${data.sid}`);

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
