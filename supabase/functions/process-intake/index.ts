import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Shared server-side intake pipeline.
 * Accepts an IntakePayload-like body and runs:
 *   geocode → create user → classify incident → create job → dispatch → send confirmation SMS
 *
 * This is the server-side equivalent of useAutoDispatchPipeline + processIntakePayload.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const payload = await req.json();

    // 1. Geocode if needed
    let locationLat = payload.location_lat ?? null;
    let locationLng = payload.location_lng ?? null;
    let geocodeSuccess = false;

    if (payload.location_text && locationLat == null) {
      try {
        const geo = await geocodeLocation(payload.location_text);
        if (geo.lat != null && geo.lng != null) {
          locationLat = geo.lat;
          locationLng = geo.lng;
          geocodeSuccess = true;
        }
      } catch (e) {
        console.warn("Geocoding failed, continuing without coordinates:", e);
      }
    }

    // 1b. Location completeness check — block vague locations
    const locationText = (payload.location_text || "").trim();
    const locComplete = isLocationCompleteServer(locationText, locationLat, locationLng);
    if (locationText && !locComplete.complete) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "location_incomplete",
          reason: locComplete.reason,
          prompt: "Please provide the nearest street address, intersection, highway exit, or landmark with city name.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Parse vehicle info (best-effort)
    const vehicleParsed = parseVehicleInfo(payload.vehicle_info || "");
    const vehicleMake = payload.vehicle_make || vehicleParsed.make || "";
    const vehicleModel = payload.vehicle_model || vehicleParsed.model || "";
    const vehicleYear = payload.vehicle_year || vehicleParsed.year || null;

    // 3. Infer tow_required
    let towRequired = payload.tow_required ?? null;
    if (towRequired == null && payload.drivable != null) {
      if (payload.drivable === false) {
        towRequired = true;
      } else {
        const towKeywords = ["accident", "collision", "totaled", "tow"];
        const desc = (payload.incident_description || "").toLowerCase();
        towRequired = towKeywords.some((k: string) => desc.includes(k));
      }
    }

    // 4. Create user record
    const { data: user, error: userErr } = await supabase
      .from("users")
      .insert({
        name: payload.caller_name || "Voice Customer",
        phone: payload.caller_phone || null,
        vehicle_make: vehicleMake || null,
        vehicle_model: vehicleModel || null,
        vehicle_year: vehicleYear,
      })
      .select("user_id")
      .single();
    if (userErr) throw new Error(`User creation failed: ${userErr.message}`);

    // 5. Match incident type
    const { data: incidentTypes } = await supabase.from("incident_types").select("*");
    const incidentTypeId = matchIncidentTypeId(
      payload.incident_description || payload.incident_type || "",
      incidentTypes ?? []
    );

    // 6. Create job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        pickup_location: payload.location_text || null,
        gps_lat: locationLat,
        gps_long: locationLng,
        vehicle_make: vehicleMake || null,
        vehicle_model: vehicleModel || null,
        vehicle_year: vehicleYear,
        can_vehicle_roll: payload.drivable ?? null,
        incident_type_id: incidentTypeId,
        language: payload.language || "en",
        user_id: user.user_id,
        job_status: "intake_completed",
        location_type: payload.location_type || null,
      })
      .select("job_id")
      .single();
    if (jobErr) throw new Error(`Job creation failed: ${jobErr.message}`);

    const jobId = job.job_id;

    // 7. Classify incident → get required truck type
    let requiredTruckTypeId: string | null = null;
    let requiredEquipment: string[] = [];
    if (incidentTypeId) {
      const incident = (incidentTypes ?? []).find(
        (t: any) => t.incident_type_id === incidentTypeId
      );
      if (incident) {
        requiredTruckTypeId = incident.default_truck_type_id;
        requiredEquipment = (incident.requires_special_equipment as string[]) || [];
      }
    }

    // 8. Update job → ready_for_dispatch
    await supabase
      .from("jobs")
      .update({
        required_truck_type_id: requiredTruckTypeId,
        required_equipment: requiredEquipment,
        job_status: "ready_for_dispatch",
      })
      .eq("job_id", jobId);

    // Audit
    await Promise.all([
      supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: "Voice intake completed — classified and ready for dispatch",
        event_type: "status_changed",
        event_source: "voice_intake",
      }),
      supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "status_changed",
        event_category: "dispatch",
        message: "Job classified and ready for dispatch (voice intake)",
      }),
    ]);

    // 9. Run dispatch: find drivers, rank, create offer, send driver SMS
    const dispatchResult = await runServerDispatch(supabase, jobId, requiredTruckTypeId, incidentTypes ?? []);

    // 10. Send confirmation + tracking SMS to customer (NOT payment)
    if (payload.caller_phone) {
      try {
        await sendCustomerSms(
          payload.caller_phone,
          `RIN: Help is on the way! Track your driver here: https://rin-beta.lovable.app/track/${jobId}`
        );
      } catch (e) {
        console.error("Customer SMS failed:", e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, job_id: jobId, dispatch: dispatchResult }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Process intake error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function geocodeLocation(
  locationText: string
): Promise<{ lat: number | null; lng: number | null }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationText)}&limit=1`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "RIN-Dispatch/1.0" },
  });
  if (!resp.ok) return { lat: null, lng: null };
  const results = await resp.json();
  if (results.length === 0) return { lat: null, lng: null };
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

function parseVehicleInfo(text: string): { year: number | null; make: string; model: string } {
  if (!text) return { year: null, make: "", model: "" };
  const parts = text.trim().split(/\s+/);
  let year: number | null = null;
  let rest = parts;

  // Check if first token is a 4-digit year
  if (parts.length > 0 && /^\d{4}$/.test(parts[0])) {
    const y = parseInt(parts[0], 10);
    if (y >= 1900 && y <= 2030) {
      year = y;
      rest = parts.slice(1);
    }
  }

  const make = rest[0] || "";
  const model = rest.slice(1).join(" ") || "";
  return { year, make, model };
}

function matchIncidentTypeId(
  description: string,
  incidentTypes: Array<{ incident_type_id: string; incident_name: string; description: string | null }>
): string | null {
  if (!incidentTypes?.length || !description) return null;
  const lower = description.toLowerCase();

  const match = incidentTypes.find(
    (t) =>
      t.incident_name.toLowerCase().includes(lower) ||
      lower.includes(t.incident_name.toLowerCase()) ||
      (t.description &&
        (t.description.toLowerCase().includes(lower) ||
          lower.includes(t.description.toLowerCase())))
  );

  return match?.incident_type_id ?? incidentTypes[0]?.incident_type_id ?? null;
}

function isLocationCompleteServer(
  text: string,
  lat: number | null,
  lng: number | null
): { complete: boolean; reason: string } {
  if (lat != null && lng != null) return { complete: true, reason: "has_coordinates" };
  const trimmed = text.trim();
  if (!trimmed) return { complete: false, reason: "empty" };

  const VAGUE = [
    /^(downtown|uptown|midtown)$/i,
    /^(parking\s*(lot|garage)|garage|underground\s*garage)$/i,
    /^(near|by|close\s*to|off)\s+(the\s+)?(highway|freeway|road|interstate|mall|airport|bridge)$/i,
    /^(side\s+of\s+(the\s+)?road)$/i,
    /^(highway|freeway|interstate|road|street)$/i,
    /^(my\s+house|my\s+place|home|work|office|school)$/i,
    /^(a\s+)?(mall|store|gas\s*station|rest\s*stop|rest\s*area)$/i,
    /^(somewhere|around|in\s+the\s+area)$/i,
  ];
  for (const p of VAGUE) { if (p.test(trimmed)) return { complete: false, reason: "vague_pattern" }; }
  if (/\d/.test(trimmed)) return { complete: true, reason: "has_digits" };
  if (/\b(and|&)\b|\//.test(trimmed)) return { complete: true, reason: "intersection_pattern" };
  if (trimmed.split(/\s+/).length >= 3) return { complete: true, reason: "multi_word" };
  return { complete: false, reason: "too_short_no_specifics" };
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runServerDispatch(
  supabase: any,
  jobId: string,
  requiredTruckTypeId: string | null,
  incidentTypes: any[]
) {
  // Fetch job, drivers, trucks
  const [jobRes, driversRes, trucksRes] = await Promise.all([
    supabase.from("jobs").select("*").eq("job_id", jobId).single(),
    supabase.from("drivers").select("*").eq("availability_status", "available"),
    supabase.from("trucks").select("*").eq("status", "available"),
  ]);

  const job = jobRes.data;
  const drivers = driversRes.data ?? [];
  const trucks = trucksRes.data ?? [];

  if (!job) return { escalated: true, reason: "Job not found after creation" };

  // Filter trucks by type
  const eligibleTrucks = requiredTruckTypeId
    ? trucks.filter((t: any) => t.truck_type_id === requiredTruckTypeId)
    : trucks;

  const eligibleDriverIds = new Set(eligibleTrucks.map((t: any) => t.driver_id));

  // Get excluded drivers (active assignments, pending offers on other jobs)
  const [pendingRes, activeRes] = await Promise.all([
    supabase.from("dispatch_offers").select("driver_id, job_id").eq("offer_status", "pending"),
    supabase.from("jobs").select("assigned_driver_id").not("assigned_driver_id", "is", null)
      .in("job_status", ["driver_assigned", "driver_enroute", "driver_arrived", "vehicle_loaded", "service_in_progress"]),
  ]);

  const excludeIds = new Set<string>();
  (pendingRes.data ?? []).forEach((o: any) => {
    if (o.job_id !== jobId) excludeIds.add(o.driver_id);
  });
  (activeRes.data ?? []).forEach((j: any) => {
    if (j.assigned_driver_id) excludeIds.add(j.assigned_driver_id);
  });

  // Filter eligible drivers
  const eligible = drivers.filter((d: any) => {
    if (excludeIds.has(d.driver_id)) return false;
    if (!eligibleDriverIds.has(d.driver_id)) return false;
    if ((d.reliability_score ?? 0) < 60) return false;

    if (job.gps_lat != null && job.gps_long != null && d.gps_lat != null && d.gps_long != null) {
      const dist = haversineDistanceKm(
        Number(d.gps_lat), Number(d.gps_long),
        Number(job.gps_lat), Number(job.gps_long)
      );
      return dist <= Number(d.service_radius_km ?? 0);
    }
    return true;
  });

  if (eligible.length === 0) {
    await supabase.from("jobs").update({ job_status: "reassignment_required" }).eq("job_id", jobId);
    await supabase.from("audit_logs").insert({
      job_id: jobId,
      action_type: "No eligible drivers found — escalated",
      event_type: "reassignment_requested",
      event_source: "voice_intake",
    });
    return { escalated: true, reason: "No eligible drivers" };
  }

  // Rank by simple distance (server-side simplified ranking)
  const ranked = eligible
    .map((d: any) => {
      const truck = eligibleTrucks.find((t: any) => t.driver_id === d.driver_id);
      let dist = 999;
      if (job.gps_lat != null && job.gps_long != null && d.gps_lat != null && d.gps_long != null) {
        dist = haversineDistanceKm(Number(d.gps_lat), Number(d.gps_long), Number(job.gps_lat), Number(job.gps_long));
      }
      const reliability = Number(d.reliability_score ?? 0) / 100;
      const score = (1 - Math.min(dist / 50, 1)) * 0.55 + reliability * 0.25 + (truck ? 0.20 : 0);
      return { driver: d, truck, dist, score };
    })
    .filter((r: any) => r.truck)
    .sort((a: any, b: any) => b.score - a.score);

  if (ranked.length === 0) {
    await supabase.from("jobs").update({ job_status: "reassignment_required" }).eq("job_id", jobId);
    return { escalated: true, reason: "No drivers with matching trucks" };
  }

  const pick = ranked[0];
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  // Create offer
  const { data: offer, error: offerErr } = await supabase
    .from("dispatch_offers")
    .insert({
      job_id: jobId,
      driver_id: pick.driver.driver_id,
      truck_id: pick.truck.truck_id,
      offer_status: "pending",
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (offerErr) throw new Error(`Offer creation failed: ${offerErr.message}`);

  // Update job status
  await supabase
    .from("jobs")
    .update({
      job_status: "driver_offer_sent",
      dispatch_attempt_count: 1,
      reserved_driver_id: pick.driver.driver_id,
      reservation_expires_at: expiresAt,
    })
    .eq("job_id", jobId);

  // Audit
  await Promise.all([
    supabase.from("audit_logs").insert({
      job_id: jobId,
      action_type: `Offer sent to ${pick.driver.driver_name} (voice dispatch)`,
      event_type: "offer_sent",
      event_source: "voice_intake",
    }),
    supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "offer_sent",
      event_category: "dispatch",
      message: `Offer sent to ${pick.driver.driver_name}`,
    }),
  ]);

  // Send driver SMS (fire and forget — call the existing send-driver-sms function)
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    await fetch(`${SUPABASE_URL}/functions/v1/send-driver-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        offerId: offer.offer_id,
        jobId,
        driverId: pick.driver.driver_id,
      }),
    });
  } catch (e) {
    console.error("Driver SMS invoke failed:", e);
  }

  return { escalated: false, driverName: pick.driver.driver_name, offerId: offer.offer_id };
}

async function sendCustomerSms(to: string, body: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY not configured");
  const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER not configured");

  const resp = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio SMS error [${resp.status}]: ${err}`);
  }
}
