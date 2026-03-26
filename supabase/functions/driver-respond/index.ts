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
      return jsonResp({ error: "Missing offerId, token, or action" }, 400);
    }

    // Fetch offer and validate token
    const { data: offer, error: offerErr } = await supabase
      .from("dispatch_offers")
      .select("*")
      .eq("offer_id", offerId)
      .eq("token", token)
      .single();

    if (offerErr || !offer) {
      return jsonResp({ error: "Invalid offer or token" }, 403);
    }

    // -----------------------------------------------------------------------
    // VIEW — return offer details for the public page
    // -----------------------------------------------------------------------
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

      return jsonResp({
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
      });
    }

    // -----------------------------------------------------------------------
    // ACCEPT — delegate to shared accept-driver-offer function
    // -----------------------------------------------------------------------
    if (action === "accept") {
      const acceptResp = await fetch(`${SUPABASE_URL}/functions/v1/accept-driver-offer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ offerId, source: "web_link" }),
      });

      const acceptData = await acceptResp.json();

      if (acceptData.success) {
        return jsonResp({ success: true, action: "accepted" });
      }

      return jsonResp(
        { error: acceptData.error || "Acceptance failed", status: acceptData.status },
        acceptResp.status
      );
    }

    // -----------------------------------------------------------------------
    // DECLINE — keep inline (simple, no shared logic needed)
    // -----------------------------------------------------------------------
    if (action === "decline") {
      // Check offer is still pending
      if (offer.offer_status !== "pending") {
        return jsonResp({ error: "Offer is no longer pending", status: offer.offer_status }, 409);
      }

      // Check expiry
      if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
        await supabase.from("dispatch_offers").update({ offer_status: "expired" }).eq("offer_id", offerId);
        return jsonResp({ error: "Offer has expired", status: "expired" }, 410);
      }

      const { data: driver } = await supabase
        .from("drivers")
        .select("driver_name")
        .eq("driver_id", offer.driver_id)
        .single();
      const driverName = driver?.driver_name || "Unknown";

      await supabase.from("dispatch_offers").update({ offer_status: "declined" }).eq("offer_id", offerId);

      await Promise.all([
        supabase.from("audit_logs").insert({
          job_id: offer.job_id,
          action_type: `Driver ${driverName} declined offer via web link`,
          event_type: "offer_responded",
          event_source: "driver_sms",
        }),
        supabase.from("job_events").insert({
          job_id: offer.job_id,
          event_type: "offer_declined",
          event_category: "dispatch",
          actor_type: "driver",
          message: `Driver ${driverName} declined job offer via web link`,
        }),
      ]);

      return jsonResp({ success: true, action: "declined" });
    }

    return jsonResp({ error: "Invalid action. Use: view, accept, decline" }, 400);
  } catch (error: unknown) {
    console.error("Error in driver-respond:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return jsonResp({ success: false, error: errorMessage }, 500);
  }
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
