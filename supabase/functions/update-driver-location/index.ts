import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ACTIVE_STATUSES = ["driver_enroute", "driver_arrived", "service_in_progress"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { jobId, driverId, lat, lng } = await req.json();

    if (!jobId || !driverId || lat == null || lng == null) {
      return new Response(JSON.stringify({ error: "Missing jobId, driverId, lat, or lng" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate job is active and driver matches
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ACTIVE_STATUSES.includes(job.job_status)) {
      return new Response(JSON.stringify({ error: "Job is not in an active status" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (job.assigned_driver_id !== driverId) {
      return new Response(JSON.stringify({ error: "Driver does not match job assignment" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert location update
    const { error: insertErr } = await supabase
      .from("driver_location_updates")
      .insert({
        job_id: jobId,
        driver_id: driverId,
        lat,
        lng,
      });

    if (insertErr) {
      return new Response(JSON.stringify({ error: "Failed to insert location", details: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in update-driver-location:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
