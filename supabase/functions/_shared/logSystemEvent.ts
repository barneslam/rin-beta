/**
 * Shared system event logger for AI Voice intake functions.
 *
 * Writes to system_events table. Never throws — all errors are swallowed
 * and logged to console so callers cannot be broken by logging failures.
 *
 * NOT for use with job_events (execution layer). This is intake layer only.
 *
 * event_category must be one of:
 *   'session' | 'model' | 'extraction' | 'validation' | 'handoff' | 'error' | 'watchdog'
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface SystemEventOpts {
  session_id?: string;
  job_id?: string;
  event_type: string;
  event_category: "session" | "model" | "extraction" | "validation" | "handoff" | "error" | "watchdog";
  message?: string;
  payload?: Record<string, unknown>;
  error_code?: string;
  error_detail?: string;
  duration_ms?: number;
}

export async function logSystemEvent(
  supabase: SupabaseClient,
  opts: SystemEventOpts
): Promise<void> {
  try {
    const { error } = await supabase.from("system_events").insert({
      session_id: opts.session_id ?? null,
      job_id: opts.job_id ?? null,
      event_type: opts.event_type,
      event_category: opts.event_category,
      message: opts.message ?? null,
      payload: opts.payload ?? null,
      error_code: opts.error_code ?? null,
      error_detail: opts.error_detail ?? null,
      duration_ms: opts.duration_ms ?? null,
    });
    if (error) {
      // Log but never throw — logging must not break callers
      console.error(`[logSystemEvent] DB write failed for event="${opts.event_type}": ${error.message}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[logSystemEvent] Unexpected error writing event="${opts.event_type}": ${msg}`);
  }
}
