/**
 * finalize-intake-to-job — Batch 4, AI Voice
 *
 * Evaluates whether a job_payload_candidates record has sufficient data to create a job.
 * If ready:     calls intake-create-job, marks candidate finalized, updates session.
 * If not ready: logs insufficient_data and returns structured response (no error).
 * Idempotent:   returns existing job_id if candidate already finalized.
 *
 * Readiness criteria (ALL required):
 *   - pickup_location_candidate IS NOT NULL
 *   - incident_type_id_candidate IS NOT NULL
 *   - session.channel_identifier IS NOT NULL  (phone for customer confirmation)
 *
 * DB reads:  intake_sessions, job_payload_candidates
 * DB writes: job_payload_candidates (is_finalized, finalized_at, job_id)
 *            intake_sessions (job_id, session_status, completed_at)
 *            system_events
 * External:  POST intake-create-job  (creates job + user, fires confirmation SMS)
 *
 * Must NOT write directly to jobs table — all job creation delegated to intake-create-job.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logSystemEvent } from "../_shared/logSystemEvent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { session_id, candidate_id } = body;

    // ── Param validation ─────────────────────────────────────────────────────
    if (!session_id || !candidate_id) {
      return jsonResp({
        success: false, error_code: "missing_params",
        error: "session_id and candidate_id are required",
      }, 400);
    }

    console.log(`[FINALIZE] session_id=${session_id} candidate_id=${candidate_id}`);

    // ── Read session ─────────────────────────────────────────────────────────
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("session_id, channel_identifier, session_status, job_id")
      .eq("session_id", session_id)
      .maybeSingle();

    if (sessionErr || !session) {
      return jsonResp({
        success: false, error_code: "session_not_found",
        error: sessionErr?.message ?? "Session not found",
        context: { session_id },
      }, 404);
    }

    // ── Read candidate ───────────────────────────────────────────────────────
    const { data: candidate, error: candidateErr } = await supabase
      .from("job_payload_candidates")
      .select([
        "candidate_id", "is_finalized", "finalized_at", "job_id",
        "pickup_location_candidate", "raw_location_text",
        "incident_type_id_candidate",
        "vehicle_make_candidate", "vehicle_model_candidate", "vehicle_year_candidate",
        "can_vehicle_roll_candidate",
        "gps_lat_candidate", "gps_lng_candidate", "location_type_candidate",
      ].join(", "))
      .eq("candidate_id", candidate_id)
      .maybeSingle();

    if (candidateErr || !candidate) {
      return jsonResp({
        success: false, error_code: "candidate_not_found",
        error: candidateErr?.message ?? "Candidate not found",
        context: { candidate_id },
      }, 404);
    }

    // ── IDEMPOTENCY: already finalized ───────────────────────────────────────
    if (candidate.is_finalized || candidate.job_id) {
      const existingJobId = candidate.job_id ?? session.job_id;
      console.log(`[FINALIZE] Idempotent — already finalized job_id=${existingJobId}`);

      await logSystemEvent(supabase, {
        session_id,
        job_id: existingJobId,
        event_type: "job_skipped",
        event_category: "handoff",
        message: `Finalization skipped — candidate already finalized job_id=${existingJobId}`,
        payload: { candidate_id, job_id: existingJobId, finalized_at: candidate.finalized_at },
      });

      return jsonResp({
        success: true,
        job_id: existingJobId,
        candidate_id,
        skipped: true,
        reason: "already_finalized",
      }, 200);
    }

    // ── READINESS CHECK ──────────────────────────────────────────────────────
    const missing: string[] = [];
    if (!candidate.pickup_location_candidate) missing.push("pickup_location_candidate");
    if (!candidate.incident_type_id_candidate) missing.push("incident_type_id_candidate");
    if (!session.channel_identifier)           missing.push("session.channel_identifier (phone)");

    if (missing.length > 0) {
      console.warn(`[FINALIZE] Insufficient data — missing: ${missing.join(", ")}`);

      await logSystemEvent(supabase, {
        session_id,
        event_type: "insufficient_data",
        event_category: "validation",
        message: `Cannot finalize — required fields missing: ${missing.join(", ")}`,
        payload: {
          candidate_id,
          missing_fields: missing,
          pickup_location_candidate: candidate.pickup_location_candidate,
          incident_type_id_candidate: candidate.incident_type_id_candidate,
          has_phone: !!session.channel_identifier,
        },
      });

      return jsonResp({
        success: false,
        error_code: "insufficient_data",
        error: `Required fields missing: ${missing.join(", ")}`,
        missing_fields: missing,
        context: { session_id, candidate_id },
      }, 422);
    }

    console.log(`[FINALIZE] Readiness check passed — calling intake-create-job`);

    // ── Call intake-create-job ───────────────────────────────────────────────
    const intakePayload = {
      phone:              session.channel_identifier,
      pickupLocation:     candidate.pickup_location_candidate,
      incidentTypeId:     candidate.incident_type_id_candidate,
      vehicleMake:        candidate.vehicle_make_candidate    ?? undefined,
      vehicleModel:       candidate.vehicle_model_candidate   ?? undefined,
      vehicleYear:        candidate.vehicle_year_candidate    ?? undefined,
      canVehicleRoll:     candidate.can_vehicle_roll_candidate ?? undefined,
      gpsLat:             candidate.gps_lat_candidate         ?? undefined,
      gpsLong:            candidate.gps_lng_candidate         ?? undefined,
      locationType:       candidate.location_type_candidate   ?? "roadside",
      requiredEquipment:  [],
    };

    console.log(`[FINALIZE] intake-create-job payload — phone=${session.channel_identifier} location=${candidate.pickup_location_candidate} incidentTypeId=${candidate.incident_type_id_candidate}`);

    const t0 = Date.now();
    let createResp: Response;
    try {
      createResp = await fetch(`${SUPABASE_URL}/functions/v1/intake-create-job`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(intakePayload),
      });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error(`[FINALIZE] intake-create-job network error: ${msg}`);
      await logSystemEvent(supabase, {
        session_id,
        event_type: "job_creation_failed",
        event_category: "error",
        message: `intake-create-job network error — ${msg}`,
        error_code: "job_create_network_error",
        error_detail: msg,
        payload: { candidate_id },
      });
      return jsonResp({ success: false, error_code: "job_create_network_error", error: msg }, 502);
    }

    const duration_ms = Date.now() - t0;
    const createBody = await createResp.json();

    if (!createResp.ok || !createBody.success) {
      const errMsg = createBody.error ?? `HTTP ${createResp.status}`;
      console.error(`[FINALIZE] intake-create-job failed — ${errMsg}`);
      await logSystemEvent(supabase, {
        session_id,
        event_type: "job_creation_failed",
        event_category: "error",
        message: `intake-create-job returned failure — ${errMsg}`,
        error_code: createBody.code ?? "job_create_failed",
        error_detail: errMsg,
        payload: { candidate_id, http_status: createResp.status, response: createBody },
        duration_ms,
      });
      return jsonResp({
        success: false,
        error_code: "job_create_failed",
        error: errMsg,
        context: { candidate_id, upstream_response: createBody },
      }, 502);
    }

    const newJobId  = createBody.job_id;
    const newUserId = createBody.user_id;
    console.log(`[FINALIZE] Job created — job_id=${newJobId} user_id=${newUserId} sms_status=${createBody.sms_status}`);

    // ── Mark candidate finalized ─────────────────────────────────────────────
    const { error: candidateUpdateErr } = await supabase
      .from("job_payload_candidates")
      .update({
        is_finalized: true,
        finalized_at: new Date().toISOString(),
        job_id:       newJobId,
      })
      .eq("candidate_id", candidate_id);

    if (candidateUpdateErr) {
      // Non-fatal — job was created; log and continue
      console.error(`[FINALIZE] candidate update failed (non-fatal): ${candidateUpdateErr.message}`);
    } else {
      console.log(`[FINALIZE] Candidate marked finalized — candidate_id=${candidate_id}`);
    }

    // ── Update session with job_id and complete it ───────────────────────────
    const { error: sessionUpdateErr } = await supabase
      .from("intake_sessions")
      .update({
        job_id:       newJobId,
        session_status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("session_id", session_id);

    if (sessionUpdateErr) {
      // Non-fatal — job was created; log and continue
      console.error(`[FINALIZE] session update failed (non-fatal): ${sessionUpdateErr.message}`);
    } else {
      console.log(`[FINALIZE] Session updated — session_id=${session_id} status=completed`);
    }

    // ── Log job_created ──────────────────────────────────────────────────────
    await logSystemEvent(supabase, {
      session_id,
      job_id: newJobId,
      event_type: "job_created",
      event_category: "handoff",
      message: `Intake finalized — job_id=${newJobId} user_id=${newUserId} sms_status=${createBody.sms_status}`,
      payload: {
        candidate_id,
        job_id:     newJobId,
        user_id:    newUserId,
        sms_status: createBody.sms_status,
        fields_used: ["pickup_location", "incident_type_id",
          ...(candidate.vehicle_make_candidate    ? ["vehicle_make"]    : []),
          ...(candidate.vehicle_model_candidate   ? ["vehicle_model"]   : []),
          ...(candidate.vehicle_year_candidate    ? ["vehicle_year"]    : []),
          ...(candidate.can_vehicle_roll_candidate !== null && candidate.can_vehicle_roll_candidate !== undefined
              ? ["can_vehicle_roll"] : []),
        ],
      },
      duration_ms,
    });

    console.log(`[FINALIZE] job_created — job_id=${newJobId} duration_ms=${duration_ms}`);

    return jsonResp({
      success:    true,
      job_id:     newJobId,
      user_id:    newUserId,
      sms_status: createBody.sms_status,
      candidate_id,
      session_id,
      duration_ms,
    }, 200);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[FINALIZE] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});
