/**
 * intake-create-job — server-side steps 1 and 2 of the dispatch pipeline.
 *
 * Step 1: Normalize phone to E.164 → find-or-create user in public.users
 * Step 2: Insert job into public.jobs with job_status = "intake_completed"
 *
 * Returns { success, user_id, job_id, phone } on success.
 * Returns { success: false, error, code } on any failure — UI must not advance.
 *
 * Every attempt writes a single structured log line:
 *   [INTAKE-JOB] phone="..." user_id="..." job_id="..." status=ok|failed
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone, validatePhone } from "../_shared/phone.ts";

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

    const {
      phone: rawPhone,
      name,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      incidentTypeId,
      pickupLocation,
      gpsLat,
      gpsLong,
      locationType,
      requiredTruckTypeId,
      requiredEquipment,
    } = await req.json();

    // -------------------------------------------------------------------------
    // Step 1a: Validate + normalize phone
    // -------------------------------------------------------------------------
    if (!rawPhone) {
      console.error(`[INTAKE-JOB] Step 1 FAILED — phone=missing status=failed`);
      return jsonResp({ success: false, error: "phone is required", code: "missing_phone" }, 400);
    }

    const phoneCheck = validatePhone(rawPhone);
    const phone = phoneCheck.valid ? phoneCheck.e164 : (normalizePhone(rawPhone) || rawPhone);

    if (!phoneCheck.valid) {
      console.warn(`[INTAKE-JOB] Step 1 — phone invalid (${phoneCheck.reason}) raw="${rawPhone}" stored_as="${phone}" — continuing`);
    } else {
      console.log(`[INTAKE-JOB] Step 1 — phone normalized raw="${rawPhone}" e164="${phone}"`);
    }

    // -------------------------------------------------------------------------
    // Step 1b: Find or create user
    // -------------------------------------------------------------------------
    const { data: existingUser, error: lookupErr } = await supabase
      .from("users")
      .select("user_id, name, vehicle_make, vehicle_model, vehicle_year")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error(`[INTAKE-JOB] Step 1 FAILED — phone="${phone}" lookup_error="${lookupErr.message}" status=failed`);
      return jsonResp({ success: false, error: `User lookup failed: ${lookupErr.message}`, code: "user_lookup_failed" }, 500);
    }

    let userId: string;

    if (existingUser) {
      userId = existingUser.user_id;

      // Update blank/generic fields only — never overwrite existing data
      const updates: Record<string, unknown> = {};
      if ((!existingUser.name || existingUser.name === "Customer") && name && name !== "Customer") {
        updates.name = name;
      }
      if (!existingUser.vehicle_make && vehicleMake) updates.vehicle_make = vehicleMake;
      if (!existingUser.vehicle_model && vehicleModel) updates.vehicle_model = vehicleModel;
      if (!existingUser.vehicle_year && vehicleYear) updates.vehicle_year = vehicleYear;

      if (Object.keys(updates).length > 0) {
        const { error: updateErr } = await supabase
          .from("users")
          .update(updates)
          .eq("user_id", userId);
        if (updateErr) {
          console.warn(`[INTAKE-JOB] Step 1 — user update non-fatal error user_id="${userId}" error="${updateErr.message}"`);
        }
      }

      console.log(`[INTAKE-JOB] Step 1 — user=found phone="${phone}" user_id="${userId}" status=ok`);
    } else {
      const { data: newUser, error: userErr } = await supabase
        .from("users")
        .insert({
          name: name || "Customer",
          phone,
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          vehicle_year: vehicleYear || null,
        })
        .select("user_id")
        .single();

      if (userErr || !newUser) {
        console.error(`[INTAKE-JOB] Step 1 FAILED — phone="${phone}" insert_error="${userErr?.message}" status=failed`);
        return jsonResp({ success: false, error: `User insert failed: ${userErr?.message}`, code: "user_insert_failed" }, 500);
      }

      userId = newUser.user_id;
      console.log(`[INTAKE-JOB] Step 1 — user=created phone="${phone}" user_id="${userId}" status=ok`);
    }

    // -------------------------------------------------------------------------
    // Step 2: Insert job — only runs after user is confirmed in DB
    // -------------------------------------------------------------------------
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        incident_type_id: incidentTypeId || null,
        pickup_location: pickupLocation || null,
        gps_lat: gpsLat ?? null,
        gps_long: gpsLong ?? null,
        vehicle_make: vehicleMake || null,
        vehicle_model: vehicleModel || null,
        vehicle_year: vehicleYear || null,
        required_truck_type_id: requiredTruckTypeId || null,
        required_equipment: requiredEquipment || [],
        location_type: locationType || "roadside",
        job_status: "intake_completed",
      })
      .select("job_id")
      .single();

    if (jobErr || !job) {
      console.error(`[INTAKE-JOB] Step 2 FAILED — phone="${phone}" user_id="${userId}" insert_error="${jobErr?.message}" status=failed`);
      return jsonResp({ success: false, error: `Job insert failed: ${jobErr?.message}`, code: "job_insert_failed" }, 500);
    }

    const jobId = job.job_id;

    console.log(`[INTAKE-JOB] Step 2 — job=created phone="${phone}" user_id="${userId}" job_id="${jobId}" status=ok`);

    // Audit trail in job_events
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "intake_created",
      event_category: "lifecycle",
      message: `Job created via dispatcher intake — phone=${phone} user_id=${userId}`,
      new_value: { phone, user_id: userId, job_id: jobId, job_status: "intake_completed" },
    });

    console.log(`[INTAKE-JOB] Complete — phone="${phone}" user_id="${userId}" job_id="${jobId}" status=ok`);

    return jsonResp({ success: true, user_id: userId, job_id: jobId, phone });
  } catch (error: unknown) {
    console.error("[INTAKE-JOB] Unhandled error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResp({ success: false, error: msg, code: "unhandled" }, 500);
  }
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
