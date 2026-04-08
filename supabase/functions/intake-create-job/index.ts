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

    const body = await req.json();

    // Accept both camelCase and snake_case field names
    const rawPhone = body.phone;
    const name = body.name || body.customer_name;
    const vehicleMake = body.vehicleMake || body.vehicle_make;
    const vehicleModel = body.vehicleModel || body.vehicle_model;
    const vehicleYear = body.vehicleYear || body.vehicle_year;
    const vehicleCondition = body.vehicleCondition || body.vehicle_condition;
    const canVehicleRoll = body.canVehicleRoll ?? body.can_vehicle_roll;
    let incidentTypeId = body.incidentTypeId || body.incident_type_id;
    const incidentType = body.incidentType || body.incident_type; // name-based lookup
    const pickupLocation = body.pickupLocation || body.pickup_location;
    const gpsLat = body.gpsLat ?? body.gps_lat;
    const gpsLong = body.gpsLong ?? body.gps_long;
    const locationType = body.locationType || body.location_type;
    const requiredTruckTypeId = body.requiredTruckTypeId || body.required_truck_type_id;
    const requiredEquipment = body.requiredEquipment || body.required_equipment;

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
      // Reject if the normalized form is not E.164-shaped — prevents garbage rows in users table
      const looksLikeE164 = /^\+\d{7,15}$/.test(phone);
      if (!looksLikeE164) {
        console.error(`[INTAKE-JOB] Step 1 FAILED — phone invalid raw="${rawPhone}" normalized="${phone}" reason=${phoneCheck.reason} status=failed`);
        return jsonResp({ success: false, error: `Invalid phone number: ${phoneCheck.reason}`, code: "invalid_phone" }, 400);
      }
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
    // Step 1c: Resolve incident type name → UUID if needed
    // -------------------------------------------------------------------------
    if (!incidentTypeId && incidentType) {
      const { data: resolved } = await supabase
        .from("incident_types")
        .select("incident_type_id")
        .ilike("incident_name", incidentType)
        .limit(1)
        .maybeSingle();
      if (resolved) {
        incidentTypeId = resolved.incident_type_id;
        console.log(`[INTAKE-JOB] Step 1c — resolved incident_type "${incidentType}" → ${incidentTypeId}`);
      } else {
        console.warn(`[INTAKE-JOB] Step 1c — incident_type "${incidentType}" not found in incident_types table`);
      }
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
        vehicle_condition: vehicleCondition || null,
        can_vehicle_roll: canVehicleRoll ?? null,
        required_truck_type_id: requiredTruckTypeId || null,
        required_equipment: requiredEquipment || [],
        location_type: locationType || "roadside",
        customer_phone: phone || null,
        job_status: "pending_customer_confirmation",
      })
      .select("job_id, vehicle_make, vehicle_model, vehicle_year, pickup_location")
      .single();

    if (jobErr || !job) {
      console.error(`[INTAKE-JOB] Step 2 FAILED — phone="${phone}" user_id="${userId}" insert_error="${jobErr?.message}" status=failed`);
      return jsonResp({ success: false, error: `Job insert failed: ${jobErr?.message}`, code: "job_insert_failed" }, 500);
    }

    const jobId = job.job_id;

    console.log(`[INTAKE-JOB] Step 2 — job=created phone="${phone}" user_id="${userId}" job_id="${jobId}" status=ok`);

    // CHECKPOINT_JOB_CREATED
    console.log(`[CHECKPOINT_JOB_CREATED] job_id=${jobId} vehicle_make=${job.vehicle_make ?? "null"} vehicle_model=${job.vehicle_model ?? "null"} vehicle_year=${job.vehicle_year ?? "null"} pickup_location=${job.pickup_location ?? "null"} incident_type_id=${incidentTypeId ?? "null"}`);

    // Audit trail in job_events
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "intake_created",
      event_category: "lifecycle",
      message: `Job created via dispatcher intake — phone=${phone} user_id=${userId}`,
      new_value: { phone, user_id: userId, job_id: jobId, job_status: "pending_customer_confirmation" },
    });

    // -------------------------------------------------------------------------
    // Step 3: Send customer summary SMS (non-fatal — job is already created)
    // -------------------------------------------------------------------------
    let smsSid: string | undefined;
    let smsStatus = "skipped";

    try {
      const smsPayload = { jobId, phone };

      // Checkpoint: about to call send-customer-confirmation
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "confirmation_sms_triggered",
        event_category: "communication",
        message: "Calling send-customer-confirmation",
      });
      console.log(`[CHECKPOINT_SMS_TRIGGERED] calling send-customer-confirmation payload=${JSON.stringify(smsPayload)}`);

      const smsResp = await fetch(`${SUPABASE_URL}/functions/v1/send-customer-confirmation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(smsPayload),
      });

      const smsBody = await smsResp.json().catch(() => ({}));
      if (smsResp.ok && smsBody.success) {
        smsSid = smsBody.sid;
        smsStatus = "sent";
        await supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "confirmation_sms_trigger_success",
          event_category: "communication",
          message: `send-customer-confirmation returned ${smsResp.status} — sid=${smsBody.sid ?? "unknown"}`,
        });
      } else {
        smsStatus = "failed";
        await supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "confirmation_sms_trigger_failed",
          event_category: "communication",
          message: `send-customer-confirmation returned ${smsResp.status} — error=${smsBody.error ?? "unknown"}`,
        });
        console.error(`[INTAKE-JOB] Step 3 — SMS failed job_id="${jobId}" status=${smsResp.status} error="${smsBody.error ?? "unknown"}"`);
      }
    } catch (smsErr) {
      smsStatus = "error";
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "confirmation_sms_trigger_failed",
        event_category: "communication",
        message: `send-customer-confirmation threw: ${smsErr}`,
      });
      console.error(`[INTAKE-JOB] Step 3 — SMS threw job_id="${jobId}" error="${smsErr}"`);
    }

    console.log(`[INTAKE-JOB] Complete — phone="${phone}" user_id="${userId}" job_id="${jobId}" sms=${smsStatus}${smsSid ? ` sid=${smsSid}` : ""} status=ok`);

    return jsonResp({ success: true, user_id: userId, job_id: jobId, phone, sms_status: smsStatus });
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
