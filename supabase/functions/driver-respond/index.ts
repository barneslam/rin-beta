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

    const { offerId, token, action } = await req.json();

    if (!offerId || !token || !action) {
      return new Response(JSON.stringify({ error: "Missing offerId, token, or action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch offer and validate token
    const { data: offer, error: offerErr } = await supabase
      .from("dispatch_offers")
      .select("*")
      .eq("offer_id", offerId)
      .eq("token", token)
      .single();

    if (offerErr || !offer) {
      return new Response(JSON.stringify({ error: "Invalid offer or token" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: "view" — return offer details for the public page
    if (action === "view") {
      const { data: job } = await supabase
        .from("jobs")
        .select("pickup_location, incident_type_id, vehicle_year, vehicle_make, vehicle_model, estimated_price, job_status")
        .eq("job_id", offer.job_id)
        .single();

      let incidentName = "Roadside assistance";
      if (job?.incident_type_id) {
        const { data: incType } = await supabase
          .from("incident_types")
          .select("incident_name")
          .eq("incident_type_id", job.incident_type_id)
          .single();
        if (incType) incidentName = incType.incident_name;
      }

      return new Response(JSON.stringify({
        success: true,
        offer: {
          offer_id: offer.offer_id,
          offer_status: offer.offer_status,
          expires_at: offer.expires_at,
          created_at: offer.created_at,
        },
        job: {
          pickup_location: job?.pickup_location,
          incident_name: incidentName,
          vehicle_summary: [job?.vehicle_year, job?.vehicle_make, job?.vehicle_model].filter(Boolean).join(" ") || "Not specified",
          estimated_price: job?.estimated_price,
          job_status: job?.job_status,
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check offer is still pending
    if (offer.offer_status !== "pending") {
      return new Response(JSON.stringify({ error: "Offer is no longer pending", status: offer.offer_status }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiry
    if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
      // Mark as expired
      await supabase.from("dispatch_offers").update({ offer_status: "expired" }).eq("offer_id", offerId);
      return new Response(JSON.stringify({ error: "Offer has expired", status: "expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch driver name for audit
    const { data: driver } = await supabase
      .from("drivers")
      .select("driver_name")
      .eq("driver_id", offer.driver_id)
      .single();
    const driverName = driver?.driver_name || "Unknown";

    if (action === "accept") {
      // Accept this offer
      await supabase.from("dispatch_offers").update({ offer_status: "accepted" }).eq("offer_id", offerId);

      // Expire all other pending offers for this job
      await supabase
        .from("dispatch_offers")
        .update({ offer_status: "expired" })
        .eq("job_id", offer.job_id)
        .neq("offer_id", offerId)
        .eq("offer_status", "pending");

      // Get current job status for audit
      const { data: currentJob } = await supabase
        .from("jobs")
        .select("job_status")
        .eq("job_id", offer.job_id)
        .single();

      // Assign driver to job — gate on payment authorization before active service
      await supabase.from("jobs").update({
        assigned_driver_id: offer.driver_id,
        assigned_truck_id: offer.truck_id,
        job_status: "payment_authorization_required",
      }).eq("job_id", offer.job_id);

      // Audit log
      await supabase.from("audit_logs").insert({
        job_id: offer.job_id,
        action_type: `Driver ${driverName} accepted offer via SMS/link`,
        event_type: "driver_assigned",
        event_source: "driver_sms",
        old_value: { job_status: currentJob?.job_status },
        new_value: { job_status: "payment_authorization_required", assigned_driver_id: offer.driver_id },
      });

      // Job event
      await supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "driver_accepted",
        event_category: "dispatch",
        message: `Driver ${driverName} accepted job offer`,
        new_value: { job_status: "driver_assigned", assigned_driver_id: offer.driver_id },
      });

      return new Response(JSON.stringify({ success: true, action: "accepted" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "decline") {
      // Decline this offer
      await supabase.from("dispatch_offers").update({ offer_status: "declined" }).eq("offer_id", offerId);

      // Audit log
      await supabase.from("audit_logs").insert({
        job_id: offer.job_id,
        action_type: `Driver ${driverName} declined offer via SMS/link`,
        event_type: "offer_responded",
        event_source: "driver_sms",
      });

      // Job event
      await supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "offer_declined",
        event_category: "dispatch",
        message: `Driver ${driverName} declined job offer`,
      });

      // Auto-advance: trigger the send-driver-sms pipeline for the next driver
      // We need to invoke the auto-advance logic server-side
      // For MVP, we update the job to signal the dispatcher that the offer was declined
      // The existing client-side auto-dispatch will pick up from the dispatcher's offer page
      // A more sophisticated approach would replicate the full ranking logic here

      return new Response(JSON.stringify({ success: true, action: "declined" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use: view, accept, decline" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in driver-respond:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
