/**
 * twilio-voice-intake — Batch 5, AI Voice
 *
 * Twilio Voice webhook for AI-driven roadside assistance intake.
 * Single function handles both the initial inbound call and all
 * speech-gather callbacks.
 *
 * ── URL routing ───────────────────────────────────────────────────────────────
 *   POST (no ?action)   — initial call: create session, return greeting TwiML
 *   POST ?action=gather — speech callback: process turn, extract, respond or finalize
 *
 * ── State passing ─────────────────────────────────────────────────────────────
 *   session_id, candidate_id, turn (user turn number) are embedded in the
 *   Gather action URL. Twilio re-posts these on every callback.
 *   No server-side per-call state is required between callbacks.
 *
 * ── Turn numbering ────────────────────────────────────────────────────────────
 *   User turns:  1, 3, 5, 7, 9  (odd)
 *   Agent turns: 2, 4, 6, 8, 10 (even, appended after each user turn)
 *   MAX_EXCHANGES = 5 → caller gets up to 5 question-answer pairs.
 *   If all required fields collected earlier, finalize immediately.
 *
 * ── Readiness criteria (delegated to finalize-intake-to-job) ─────────────────
 *   pickup_location_candidate + incident_type_id_candidate + channel_identifier
 *
 * ── Pipeline calls ────────────────────────────────────────────────────────────
 *   start-intake-session   — on initial call
 *   append-intake-turn     — user utterance (role=user) + AI response (role=agent)
 *   extract-intake-turn    — LLM extraction from user turn only
 *   finalize-intake-to-job — when required fields are present
 *
 * ── Security note ─────────────────────────────────────────────────────────────
 *   Twilio request signature validation is NOT implemented (deferred to Batch 6).
 *   This function must be deployed with JWT verification DISABLED in the
 *   Supabase dashboard (Edge Functions → twilio-voice-intake → toggle off).
 *
 * DB reads:  job_payload_candidates (readiness check after extraction)
 * DB writes: system_events (voice_call_started, voice_intake_max_turns,
 *            voice_finalize_failed)
 * External:  start-intake-session, append-intake-turn, extract-intake-turn,
 *            finalize-intake-to-job
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/phone.ts";
import { logSystemEvent } from "../_shared/logSystemEvent.ts";

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_EXCHANGES    = 5;   // max caller question-answer pairs before giving up
const VOICE            = "Polly.Joanna";
const GATHER_TIMEOUT   = "8"; // seconds of silence before Twilio fires action
const SPEECH_TIMEOUT   = "2"; // seconds of post-speech silence to end utterance

// ── TwiML helpers ──────────────────────────────────────────────────────────────

function twimlResp(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

/** TwiML: say message and hang up. */
function hangup(message: string): string {
  return `<Say voice="${VOICE}">${escapeXml(message)}</Say><Hangup/>`;
}

/** TwiML: say message then open a speech gather. Falls back to hangup on silence. */
function gather(message: string, actionUrl: string): string {
  return (
    `<Say voice="${VOICE}">${escapeXml(message)}</Say>` +
    `<Gather input="speech" action="${actionUrl}" method="POST"` +
    ` timeout="${GATHER_TIMEOUT}" speechTimeout="${SPEECH_TIMEOUT}" enhanced="true">` +
    `</Gather>` +
    `<Say voice="${VOICE}">I didn't catch that. Please call back when you're ready. Goodbye.</Say>` +
    `<Hangup/>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Response generation ────────────────────────────────────────────────────────

/**
 * Rule-based follow-up question. Fast and predictable — no extra LLM call.
 * Called only when required fields are still missing.
 */
function nextQuestion(hasLocation: boolean, hasIncident: boolean, exchangeNum: number): string {
  if (!hasLocation && !hasIncident) {
    return exchangeNum === 1
      ? "I'm sorry to hear you're having trouble. Could you tell me your current location and describe what happened with your vehicle?"
      : "I still need your location and the nature of the problem. Where are you and what's happened?";
  }
  if (!hasLocation) {
    return "Got it. What's your current location? A street address or nearby intersection works well.";
  }
  if (!hasIncident) {
    return "Understood. What's the problem with your vehicle? For example — flat tire, won't start, locked out, or you need a tow?";
  }
  // Should not be reached; finalize triggers before this
  return "Let me get that set up for you now.";
}

// ── Internal pipeline fetch ────────────────────────────────────────────────────

async function callFunction(
  baseUrl: string,
  serviceKey: string,
  functionName: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  try {
    const resp = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await resp.json();
    return { ok: resp.ok, status: resp.status, body };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: { success: false, error: msg } };
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  // Twilio posts form-encoded bodies
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    console.error("[VOICE-INTAKE] Failed to parse form body");
    return twimlResp(hangup("We encountered an error. Please call back."));
  }

  const callSid  = (formData.get("CallSid")  as string | null) ?? "";
  const fromRaw  = (formData.get("From")     as string | null) ?? "";

  if (!callSid || !fromRaw) {
    console.error("[VOICE-INTAKE] Missing CallSid or From in Twilio payload");
    return twimlResp(hangup("Invalid request. Goodbye."));
  }

  const callerPhone = normalizePhone(fromRaw);

  // ══════════════════════════════════════════════════════════════════════════════
  // INITIAL CALL — create session, return greeting
  // ══════════════════════════════════════════════════════════════════════════════

  if (action !== "gather") {
    console.log(`[VOICE-INTAKE] Incoming call — callSid=${callSid} from=${callerPhone}`);

    const start = await callFunction(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "start-intake-session", {
      call_sid:     callSid,
      caller_phone: callerPhone,
      channel:      "voice",
    });

    if (!start.ok || !start.body.success) {
      const err = start.body.error ?? `HTTP ${start.status}`;
      console.error(`[VOICE-INTAKE] start-intake-session failed: ${err}`);
      return twimlResp(hangup("We're sorry, we couldn't start your session. Please call back shortly."));
    }

    const session_id   = start.body.session_id   as string;
    const candidate_id = start.body.candidate_id as string;
    const resumed      = !!start.body.resumed;

    await logSystemEvent(supabase, {
      session_id,
      event_type: "voice_call_started",
      event_category: "session",
      message: `Inbound voice call — callSid=${callSid} from=${callerPhone} resumed=${resumed}`,
      payload: { call_sid: callSid, caller_phone: callerPhone, resumed, candidate_id },
    });

    console.log(`[VOICE-INTAKE] Session ready — session_id=${session_id} candidate_id=${candidate_id} resumed=${resumed}`);

    // User turn 1 will be the first gather callback
    const gatherUrl = buildGatherUrl(SUPABASE_URL, session_id, candidate_id, 1);

    const greeting = resumed
      ? "Welcome back to RIN roadside assistance. Let's continue where we left off. Please describe your location and the situation."
      : "Thank you for calling RIN roadside assistance. To dispatch help quickly, I'll need a few details. Please tell me your current location and describe what happened with your vehicle.";

    return twimlResp(gather(greeting, gatherUrl));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // GATHER CALLBACK — process utterance, extract, decide next step
  // ══════════════════════════════════════════════════════════════════════════════

  const session_id   = url.searchParams.get("session_id")   ?? "";
  const candidate_id = url.searchParams.get("candidate_id") ?? "";
  const userTurnNum  = parseInt(url.searchParams.get("turn") ?? "1", 10);
  const speechResult = (formData.get("SpeechResult") as string | null)?.trim() ?? "";
  const confidence   = parseFloat((formData.get("Confidence") as string | null) ?? "0");

  if (!session_id || !candidate_id) {
    console.error("[VOICE-INTAKE] Missing session_id or candidate_id in gather URL");
    return twimlResp(hangup("We encountered a session error. Please call back."));
  }

  const exchangeNum = Math.ceil(userTurnNum / 2); // 1, 2, 3... (user turns are odd: 1,3,5...)
  console.log(`[VOICE-INTAKE] Gather — session_id=${session_id} turn=${userTurnNum} exchange=${exchangeNum} confidence=${confidence} speech_len=${speechResult.length}`);

  // ── Handle silence / no speech ───────────────────────────────────────────────

  if (!speechResult) {
    console.warn(`[VOICE-INTAKE] No speech at turn=${userTurnNum}`);

    if (exchangeNum > MAX_EXCHANGES) {
      return twimlResp(hangup("I'm sorry I couldn't assist you today. Please call back when you're ready. Goodbye."));
    }

    // Re-prompt same turn
    const retryUrl = buildGatherUrl(SUPABASE_URL, session_id, candidate_id, userTurnNum);
    return twimlResp(gather(
      "I didn't catch that. Could you please describe your location and what happened with your vehicle?",
      retryUrl,
    ));
  }

  // ── Append user turn ─────────────────────────────────────────────────────────

  const appendUser = await callFunction(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "append-intake-turn", {
    session_id,
    turn_number:   userTurnNum,
    role:          "user",
    raw_input:     speechResult,
    turn_category: "intake",
  });

  if (!appendUser.ok || !appendUser.body.success) {
    console.error(`[VOICE-INTAKE] append-intake-turn (user) failed: ${appendUser.body.error}`);
    // Non-fatal — attempt extraction with null turn_id (will be skipped gracefully)
  }

  const turnId = appendUser.body.turn_id as string | undefined;

  // ── Extract fields from user utterance ───────────────────────────────────────

  if (turnId) {
    const extract = await callFunction(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "extract-intake-turn", {
      turn_id:      turnId,
      session_id,
      candidate_id,
    });

    if (!extract.ok || !extract.body.success) {
      console.warn(`[VOICE-INTAKE] extract-intake-turn failed (non-fatal): ${extract.body.error}`);
    } else {
      console.log(`[VOICE-INTAKE] Extraction complete — turn_id=${turnId}`);
    }
  } else {
    console.warn(`[VOICE-INTAKE] Skipping extraction — no turn_id (append failed)`);
  }

  // ── Read candidate state post-extraction ─────────────────────────────────────

  const { data: candidate } = await supabase
    .from("job_payload_candidates")
    .select("pickup_location_candidate, incident_type_id_candidate, is_finalized, job_id")
    .eq("candidate_id", candidate_id)
    .maybeSingle();

  const hasLocation = !!candidate?.pickup_location_candidate;
  const hasIncident = !!candidate?.incident_type_id_candidate;

  console.log(`[VOICE-INTAKE] Post-extraction state — hasLocation=${hasLocation} hasIncident=${hasIncident} exchange=${exchangeNum}`);

  // ── Check max exchanges exceeded ─────────────────────────────────────────────

  if (exchangeNum >= MAX_EXCHANGES && (!hasLocation || !hasIncident)) {
    await logSystemEvent(supabase, {
      session_id,
      event_type: "voice_intake_max_turns",
      event_category: "session",
      message: `Max exchanges (${MAX_EXCHANGES}) reached — hasLocation=${hasLocation} hasIncident=${hasIncident}`,
      payload: { candidate_id, exchange_num: exchangeNum, has_location: hasLocation, has_incident: hasIncident },
    });

    return twimlResp(hangup(
      "I'm sorry, I wasn't able to collect all the information needed to dispatch help. " +
      "Please call back or visit our website for assistance. Goodbye.",
    ));
  }

  // ── Ready: attempt finalization ───────────────────────────────────────────────

  if (hasLocation && hasIncident) {
    console.log(`[VOICE-INTAKE] Required fields present — calling finalize-intake-to-job`);

    const finalize = await callFunction(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "finalize-intake-to-job", {
      session_id,
      candidate_id,
    });

    if (finalize.ok && finalize.body.success) {
      const jobId  = finalize.body.job_id;
      const skipped = !!finalize.body.skipped;
      console.log(`[VOICE-INTAKE] Finalized — job_id=${jobId} skipped=${skipped}`);

      const msg = skipped
        ? "Your service request is already on file. Help is on the way. You will receive a confirmation text shortly. Goodbye."
        : "Perfect. Your service request has been created and help is on the way. You'll receive a confirmation text shortly. Goodbye.";

      return twimlResp(hangup(msg));
    }

    // Finalization failed — log and bail; do not loop back
    const errMsg = finalize.body.error ?? `HTTP ${finalize.status}`;
    console.error(`[VOICE-INTAKE] finalize-intake-to-job failed: ${errMsg}`);

    await logSystemEvent(supabase, {
      session_id,
      event_type: "voice_finalize_failed",
      event_category: "error",
      message: `finalize-intake-to-job failed mid-call — ${errMsg}`,
      error_code: (finalize.body.error_code as string) ?? "finalize_failed",
      payload: { candidate_id, exchange_num: exchangeNum, response: finalize.body },
    });

    return twimlResp(hangup(
      "We encountered a technical issue creating your service request. " +
      "Please call back in a moment and we will assist you. Goodbye.",
    ));
  }

  // ── Not ready: ask next question ─────────────────────────────────────────────

  const agentTurnNum = userTurnNum + 1;
  const nextUserTurn = userTurnNum + 2;
  const question     = nextQuestion(hasLocation, hasIncident, exchangeNum);

  // Append agent turn (observability — non-fatal if fails)
  const appendAgent = await callFunction(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "append-intake-turn", {
    session_id,
    turn_number:   agentTurnNum,
    role:          "agent",
    raw_input:     question,
    turn_category: "intake",
  });

  if (!appendAgent.ok || !appendAgent.body.success) {
    console.warn(`[VOICE-INTAKE] append-intake-turn (agent) failed (non-fatal): ${appendAgent.body.error}`);
  }

  const nextUrl = buildGatherUrl(SUPABASE_URL, session_id, candidate_id, nextUserTurn);
  return twimlResp(gather(question, nextUrl));
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildGatherUrl(
  supabaseUrl: string,
  session_id: string,
  candidate_id: string,
  turn: number,
): string {
  const u = new URL(`${supabaseUrl}/functions/v1/twilio-voice-intake`);
  u.searchParams.set("action",       "gather");
  u.searchParams.set("session_id",   session_id);
  u.searchParams.set("candidate_id", candidate_id);
  u.searchParams.set("turn",         String(turn));
  return u.toString();
}
