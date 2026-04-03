/**
 * append-intake-turn — Batch 1, AI Voice
 *
 * Records a single caller or agent utterance as an ordered turn on an intake session.
 * Handles idempotency via UNIQUE(session_id, turn_number).
 * Updates session last_activity_at on success.
 *
 * DB writes: intake_turns, system_events, intake_sessions (last_activity_at only)
 * DB reads:  intake_sessions (status guard), intake_turns (idempotency check)
 *
 * Must NOT touch: jobs, job_events, dispatch_offers, job_payload_candidates, intake-create-job
 *
 * Role values (DB-enforced):
 *   'user'   — caller/customer utterance
 *   'agent'  — AI agent response
 *   'system' — system-generated turn (e.g. timeout, redirect)
 *
 * Turn category values (optional, DB-enforced if provided):
 *   'greeting' | 'intake' | 'clarification' | 'confirmation' | 'correction' | 'cancellation' | 'handoff'
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logSystemEvent } from "../_shared/logSystemEvent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VALID_ROLES = ["user", "agent", "system"] as const;
const VALID_CATEGORIES = ["greeting", "intake", "clarification", "confirmation", "correction", "cancellation", "handoff"] as const;

type TurnRole = typeof VALID_ROLES[number];
type TurnCategory = typeof VALID_CATEGORIES[number];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { session_id, role, raw_input, turn_number, turn_category, agent_response } = body;

    // ── Param validation ───────────────────────────────────────────────────────
    if (!session_id || !role || !raw_input || turn_number === undefined || turn_number === null) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "missing_params",
        error: "session_id, role, raw_input, and turn_number are required",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!VALID_ROLES.includes(role as TurnRole)) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "invalid_role",
        error: `role must be one of: ${VALID_ROLES.join(", ")}`,
        context: { provided_role: role },
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (turn_category !== undefined && turn_category !== null) {
      if (!VALID_CATEGORIES.includes(turn_category as TurnCategory)) {
        return new Response(JSON.stringify({
          success: false,
          error_code: "invalid_turn_category",
          error: `turn_category must be one of: ${VALID_CATEGORIES.join(", ")}`,
          context: { provided_turn_category: turn_category },
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (typeof turn_number !== "number" || !Number.isInteger(turn_number) || turn_number < 1) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "invalid_turn_number",
        error: "turn_number must be a positive integer",
        context: { provided_turn_number: turn_number },
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[APPEND-TURN] session_id=${session_id} turn_number=${turn_number} role=${role} category=${turn_category ?? "none"}`);

    // ── Session status guard ───────────────────────────────────────────────────
    console.log(`[APPEND-TURN] Fetching session — session_id=${session_id}`);
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("session_id, session_status")
      .eq("session_id", session_id)
      .maybeSingle();

    if (sessionErr) {
      console.error(`[APPEND-TURN] Session lookup error: ${sessionErr.message}`);
      return new Response(JSON.stringify({
        success: false,
        error_code: "session_lookup_failed",
        error: sessionErr.message,
        context: { session_id },
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!session) {
      return new Response(JSON.stringify({
        success: false,
        error_code: "session_not_found",
        error: `Session not found: ${session_id}`,
        context: { session_id },
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (session.session_status !== "active") {
      console.warn(`[APPEND-TURN] Blocked — session not active: status=${session.session_status} session_id=${session_id}`);

      await logSystemEvent(supabase, {
        session_id,
        event_type: "turn_append_blocked",
        event_category: "session",
        message: `Turn append blocked — session_status=${session.session_status}`,
        error_code: "invalid_session_state",
        error_detail: `session_status=${session.session_status}`,
        payload: { turn_number, role, session_status: session.session_status },
      });

      return new Response(JSON.stringify({
        success: false,
        error_code: "invalid_session_state",
        error: `Session is not active (current status: ${session.session_status})`,
        context: { session_id, session_status: session.session_status },
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── IDEMPOTENCY: check if turn already exists ──────────────────────────────
    console.log(`[APPEND-TURN] Idempotency check — session_id=${session_id} turn_number=${turn_number}`);
    const { data: existingTurn, error: dupCheckErr } = await supabase
      .from("intake_turns")
      .select("turn_id")
      .eq("session_id", session_id)
      .eq("turn_number", turn_number)
      .maybeSingle();

    if (dupCheckErr) {
      // Non-fatal — log and proceed with insert; DB UNIQUE constraint is the backstop
      console.warn(`[APPEND-TURN] Duplicate check error (non-fatal): ${dupCheckErr.message}`);
    }

    if (existingTurn) {
      console.log(`[APPEND-TURN] Idempotent — turn already exists turn_id=${existingTurn.turn_id} session_id=${session_id} turn_number=${turn_number}`);
      return new Response(JSON.stringify({
        success: true,
        turn_id: existingTurn.turn_id,
        session_id,
        turn_number,
        idempotent: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Insert turn ────────────────────────────────────────────────────────────
    console.log(`[APPEND-TURN] Inserting turn — session_id=${session_id} turn_number=${turn_number} role=${role}`);

    const insertPayload: Record<string, unknown> = {
      session_id,
      turn_number,
      role,
      raw_input,
    };
    if (turn_category) insertPayload.turn_category = turn_category;
    if (agent_response) insertPayload.agent_response = agent_response;

    const { data: newTurn, error: insertErr } = await supabase
      .from("intake_turns")
      .insert(insertPayload)
      .select("turn_id")
      .single();

    if (insertErr || !newTurn) {
      const msg = insertErr?.message ?? "No data returned";
      console.error(`[APPEND-TURN] Insert failed: ${msg}`);

      await logSystemEvent(supabase, {
        session_id,
        event_type: "turn_append_failed",
        event_category: "error",
        message: `intake_turns insert failed — session_id=${session_id} turn_number=${turn_number}`,
        error_code: "turn_insert_failed",
        error_detail: msg,
        payload: { turn_number, role },
      });

      return new Response(JSON.stringify({
        success: false,
        error_code: "turn_insert_failed",
        error: msg,
        context: { session_id, turn_number },
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[APPEND-TURN] Turn inserted — turn_id=${newTurn.turn_id} session_id=${session_id} turn_number=${turn_number}`);

    // ── Update session activity timestamp ──────────────────────────────────────
    const { error: activityErr } = await supabase
      .from("intake_sessions")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("session_id", session_id);

    if (activityErr) {
      // Non-fatal — turn was saved; don't fail the request
      console.warn(`[APPEND-TURN] last_activity_at update failed (non-fatal): ${activityErr.message}`);
    }

    // ── Observability ──────────────────────────────────────────────────────────
    await logSystemEvent(supabase, {
      session_id,
      event_type: "turn_appended",
      event_category: "session",
      message: `Turn ${turn_number} appended — role=${role} turn_id=${newTurn.turn_id}`,
      payload: {
        turn_id: newTurn.turn_id,
        turn_number,
        role,
        turn_category: turn_category ?? null,
        input_length: raw_input.length,
      },
    });

    console.log(`[APPEND-TURN] turn_appended — turn_id=${newTurn.turn_id}`);

    return new Response(JSON.stringify({
      success: true,
      turn_id: newTurn.turn_id,
      session_id,
      turn_number,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[APPEND-TURN] Unhandled error: ${msg}`);
    return new Response(JSON.stringify({
      success: false,
      error_code: "internal_error",
      error: msg,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
