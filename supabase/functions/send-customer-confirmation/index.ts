import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { APP_BASE_URL } from "../_shared/config.ts";
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
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      throw new Error("SMS credentials not configured");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { phone: reqPhone, jobId } = await req.json();

    if (!jobId) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "missing_params",
        error: "Missing jobId",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CHECKPOINT 1: function received payload — insert before any other work
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "confirmation_sms_function_started",
      event_category: "communication",
      message: JSON.stringify({ jobId, phone }),
    });
    console.log(`[CUSTOMER-SMS] confirmation_sms_function_started — jobId=${jobId} phone=${phone}`);

    // STAGE 1: Fetch job row
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, vehicle_make, vehicle_model, vehicle_year, pickup_location, incident_type_id, can_vehicle_roll, customer_phone, user_id")
      .eq("job_id", jobId)
      .single();

    if (jobErr || !job) {
      console.error(`[CUSTOMER-SMS] job fetch FAILED — jobId=${jobId} error=${jobErr?.message ?? "not found"}`);
      throw new Error(`Job not found: ${jobErr?.message ?? "unknown"}`);
    }

    // CHECKPOINT 2: job fetched
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "confirmation_sms_job_fetched",
      event_category: "communication",
      message: JSON.stringify({
        vehicle_make: job.vehicle_make,
        vehicle_model: job.vehicle_model,
        vehicle_year: job.vehicle_year,
        pickup_location: job.pickup_location,
        incident_type_id: job.incident_type_id,
      }),
    });
    console.log(`[CUSTOMER-SMS] confirmation_sms_job_fetched — vehicle_make=${job.vehicle_make ?? "null"} vehicle_model=${job.vehicle_model ?? "null"} vehicle_year=${job.vehicle_year ?? "null"} pickup_location=${job.pickup_location ?? "null"} incident_type_id=${job.incident_type_id ?? "null"}`);

    // Resolve phone: prefer job.customer_phone, then request param, then users table fallback
    let phone = job.customer_phone || reqPhone || null;
    if (!phone && job.user_id) {
      const { data: user } = await supabase.from("users").select("phone").eq("user_id", job.user_id).single();
      phone = user?.phone || null;
    }
    if (!phone) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "missing_phone",
        error: "No customer phone available on job or user record",
        context: { jobId },
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Phone validation — normalize and block invalid numbers before reaching Twilio
    const phoneCheck = validatePhone(phone);
    if (!phoneCheck.valid) {
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "confirmation_sms_phone_invalid",
        event_category: "exception",
        message: `Phone "${phone}" is invalid (${phoneCheck.reason}) — confirmation SMS blocked`,
      });
      console.error(`[CUSTOMER-SMS] phone invalid — raw="${phone}" reason=${phoneCheck.reason}`);
      return new Response(JSON.stringify({
        success: false,
        error_code: "invalid_phone",
        error: `Phone "${phone}" is invalid (${phoneCheck.reason})`,
        context: { jobId },
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // STAGE 2: Fetch incident type name
    let incidentName = "Not provided";
    if (job.incident_type_id) {
      const { data: incidentType, error: incidentErr } = await supabase
        .from("incident_types")
        .select("incident_name")
        .eq("incident_type_id", job.incident_type_id)
        .single();
      if (incidentType?.incident_name) {
        incidentName = incidentType.incident_name;
      } else {
        console.warn(`[CUSTOMER-SMS] incident_type fetch failed — id=${job.incident_type_id} error=${incidentErr?.message ?? "not found"}`);
      }
    }

    const vehicleSummary = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
      .filter(Boolean)
      .join(" ") || "Vehicle not specified";

    const pickupLocation = job.pickup_location || "Not provided";

    const confirmLink = `${APP_BASE_URL}/confirm/${jobId}`;
    const rollStatus = job.can_vehicle_roll === true ? "Yes" : job.can_vehicle_roll === false ? "No" : "Not answered";

    const smsBody =
      `RIN: We received your roadside request.\n\n` +
      `Vehicle: ${vehicleSummary}\n` +
      `Location: ${pickupLocation}\n` +
      `Issue: ${incidentName}\n` +
      `Can vehicle roll? ${rollStatus}\n\n` +
      `Please confirm your details (or correct them) using this link:\n${confirmLink}\n\n` +
      `Or reply YES to confirm as-is, or CANCEL to cancel.`;

    // CHECKPOINT 3: about to call Twilio
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "confirmation_sms_twilio_attempt",
      event_category: "communication",
      message: JSON.stringify({ to: phone, vehicle: vehicleSummary, location: pickupLocation, issue: incidentName }),
    });
    console.log(`[CUSTOMER-SMS] confirmation_sms_twilio_attempt — to=${phone} vehicle="${vehicleSummary}" location="${pickupLocation}" issue="${incidentName}"`);

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
          To: phoneCheck.e164,
          From: TWILIO_PHONE_NUMBER,
          Body: smsBody,
        }),
      }
    );

    const data = await response.json();

    if (response.ok) {
      // CHECKPOINT 4a: sent
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "confirmation_sms_sent",
        event_category: "communication",
        message: `Confirmation SMS sent to ${phone} — SID: ${data.sid}`,
      });
      console.log(`[CUSTOMER-SMS] confirmation_sms_sent — to=${phone} sid=${data.sid}`);
    } else {
      // CHECKPOINT 4b: failed
      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "confirmation_sms_failed",
        event_category: "communication",
        message: `Twilio error [${response.status}]: ${JSON.stringify(data)}`,
      });
      console.error(`[CUSTOMER-SMS] confirmation_sms_failed — to=${phone} status=${response.status}`);
      throw new Error(`Twilio API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({
      success: false,
      error_code: "internal_error",
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
