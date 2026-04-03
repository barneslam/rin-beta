/**
 * start-intake-session — Batch 1, AI Voice
 *
 * Creates a new intake session + empty job_payload_candidates draft.
 * Handles idempotency (same call_sid) and resume detection (same phone, abandoned within 30 min).
 *
 * DB writes: intake_sessions, job_payload_candidates, system_events
 * DB reads:  intake_sessions (idempotency + resume checks)
 *
 * Must NOT touch: jobs, job_events, dispatch_offers, intake_turns
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/phone.ts";
import { logSystemEvent } from "../_shared/logSystemEvent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESUME_WINDOW_MINUTES = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { call_sid, caller_phone, channel } = body;

    // ── Param validation ───────────────────────────────────────────────────────
    if (!call_sid || !caller_phone || !channel) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "missing_params",
        error: "call_sid, caller_phone, and channel are required",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allowedChannels = ["voice", "sms", "web", "api", "email"];
    if (!allowedChannels.includes(channel)) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "invalid_channel",
        error: `channel must be one of: ${allowedChannels.join(", ")}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const normalizedPhone = normalizePhone(caller_phone);
    console.log(`[START-SESSION] call_sid=${call_sid} caller_phone=${normalizedPhone} channel=${channel}`);

    // ── IDEMPOTENCY: same call_sid already has a session ──────────────────────
    console.log(`[START-SESSION] Checking for existing session — call_sid=${call_sid}`);
    const { data: existingByCallSid, error: callSidErr } = await supabase
      .from("intake_sessions")
      .select("session_id")
      .eq("voice_call_sid", call_sid)
      .maybeSingle();

    if (callSidErr) {
      console.error(`[START-SESSION] Idempotency check error: ${callSidErr.message}`);
    }

    if (existingByCallSid) {
      console.log(`[START-SESSION] Idempotent — session already exists session_id=${existingByCallSid.session_id}`);

      const { data: existingCandidate } = await supabase
        .from("job_payload_candidates")
        .select("candidate_id")
        .eq("session_id", existingByCallSid.session_id)
        .maybeSingle();

      return new Response(JSON.stringify({
        success: true,
        session_id: existingByCallSid.session_id,
        candidate_id: existingCandidate?.candidate_id ?? null,
        resumed: false,
        idempotent: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── RESUME DETECTION: abandoned session from same phone within window ─────
    const resumeCutoff = new Date(Date.now() - RESUME_WINDOW_MINUTES * 60 * 1000).toISOString();
    console.log(`[START-SESSION] Resume check — phone=${normalizedPhone} window=${RESUME_WINDOW_MINUTES}min cutoff=${resumeCutoff}`);

    const { data: abandonedSession, error: resumeErr } = await supabase
      .from("intake_sessions")
      .select("session_id, job_id")
      .eq("channel_identifier", normalizedPhone)
      .eq("session_status", "abandoned")
      .gte("last_activity_at", resumeCutoff)
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resumeErr) {
      // Non-fatal — log and continue to create new session
      console.warn(`[START-SESSION] Resume check query error (non-fatal): ${resumeErr.message}`);
    }

    if (abandonedSession) {
      console.log(`[START-SESSION] Resuming abandoned session session_id=${abandonedSession.session_id}`);

      const { error: resumeUpdateErr } = await supabase
        .from("intake_sessions")
        .update({
          session_status: "active",
          voice_call_sid: call_sid,
          last_activity_at: new Date().toISOString(),
        })
        .eq("session_id", abandonedSession.session_id);

      if (resumeUpdateErr) {
        console.error(`[START-SESSION] Failed to reactivate session: ${resumeUpdateErr.message}`);
        // Fall through to create new session rather than surface error
      } else {
        const { data: resumedCandidate } = await supabase
          .from("job_payload_candidates")
          .select("candidate_id")
          .eq("session_id", abandonedSession.session_id)
          .maybeSingle();

        await logSystemEvent(supabase, {
          session_id: abandonedSession.session_id,
          event_type: "session_resumed",
          event_category: "session",
          message: `Session resumed from abandoned — new call_sid=${call_sid} phone=${normalizedPhone}`,
          payload: { call_sid, caller_phone: normalizedPhone, channel },
        });

        console.log(`[START-SESSION] session_resumed — session_id=${abandonedSession.session_id} candidate_id=${resumedCandidate?.candidate_id ?? "none"}`);

        return new Response(JSON.stringify({
          success: true,
          session_id: abandonedSession.session_id,
          candidate_id: resumedCandidate?.candidate_id ?? null,
          resumed: true,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── NEW SESSION ────────────────────────────────────────────────────────────
    console.log(`[START-SESSION] Creating new session — phone=${normalizedPhone} channel=${channel}`);

    const { data: newSession, error: sessionInsertErr } = await supabase
      .from("intake_sessions")
      .insert({
        channel,
        channel_identifier: normalizedPhone,
        session_status: "active",
        voice_call_sid: call_sid,
      })
      .select("session_id")
      .single();

    if (sessionInsertErr || !newSession) {
      const msg = sessionInsertErr?.message ?? "No data returned";
      console.error(`[START-SESSION] Session insert failed: ${msg}`);
      return new Response(JSON.stringify({
        success: false,
        error_code: "session_create_failed",
        error: msg,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[START-SESSION] Session created — session_id=${newSession.session_id}`);

    // ── CANDIDATE DRAFT ────────────────────────────────────────────────────────
    const { data: candidate, error: candidateInsertErr } = await supabase
      .from("job_payload_candidates")
      .insert({
        session_id: newSession.session_id,
        is_finalized: false,
      })
      .select("candidate_id")
      .single();

    if (candidateInsertErr || !candidate) {
      const msg = candidateInsertErr?.message ?? "No data returned";
      console.error(`[START-SESSION] Candidate insert failed: ${msg}`);

      // Log failure — session exists but has no candidate; do not silently orphan
      await logSystemEvent(supabase, {
        session_id: newSession.session_id,
        event_type: "candidate_create_failed",
        event_category: "error",
        message: `job_payload_candidates insert failed for session_id=${newSession.session_id}`,
        error_code: "candidate_create_failed",
        error_detail: msg,
      });

      return new Response(JSON.stringify({
        success: false,
        error_code: "candidate_create_failed",
        error: msg,
        context: { session_id: newSession.session_id },
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[START-SESSION] Candidate created — candidate_id=${candidate.candidate_id}`);

    // ── OBSERVABILITY ──────────────────────────────────────────────────────────
    await logSystemEvent(supabase, {
      session_id: newSession.session_id,
      event_type: "intake_session_started",
      event_category: "session",
      message: `New intake session started — channel=${channel} phone=${normalizedPhone} call_sid=${call_sid}`,
      payload: {
        call_sid,
        caller_phone: normalizedPhone,
        channel,
        candidate_id: candidate.candidate_id,
      },
    });

    console.log(`[START-SESSION] intake_session_started — session_id=${newSession.session_id} candidate_id=${candidate.candidate_id}`);

    return new Response(JSON.stringify({
      success: true,
      session_id: newSession.session_id,
      candidate_id: candidate.candidate_id,
      resumed: false,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[START-SESSION] Unhandled error: ${msg}`);
    return new Response(JSON.stringify({
      success: false,
      error_code: "internal_error",
      error: msg,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
