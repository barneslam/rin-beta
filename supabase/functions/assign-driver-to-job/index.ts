/**
 * assign-driver-to-job — Batch 8, Dispatch Offers Engine v1
 *
 * DB-only driver assignment. Marks offer accepted (if provided), expires sibling
 * offers, and transitions job to driver_enroute. Does NOT send SMS — use
 * accept-driver-offer for the full SMS path, or respond-dispatch-offer for the
 * automated engine path.
 *
 * Use cases:
 *   - Dispatcher force-assigns a driver (bypasses offer flow)
 *   - Programmatic assignment in test / admin contexts
 *
 * Input:  { job_id, driver_id, truck_id?, offer_id? }
 * Output: { success, outcome, job_id, driver_id, driver_name, old_status, new_status }
 *
 * Outcomes:
 *   driver_assigned      — assignment complete
 *   already_assigned     — same driver already on this job (idempotent)
 *
 * Errors (4xx/5xx):
 *   already_assigned_other — job assigned to a different driver
 *   job_not_found
 *   offer_not_found
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200): Response {
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
    const { job_id, driver_id, truck_id = null, offer_id = null } = body;

    if (!job_id || !driver_id) {
      return jsonResp({ success: false, error_code: "missing_params", error: "job_id and driver_id are required" }, 400);
    }

    console.log(`[ASSIGN-DRIVER] job_id=${job_id} driver_id=${driver_id} offer_id=${offer_id}`);

    // ── 1. Fetch job ─────────────────────────────────────────────────────────
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("job_id, job_status, assigned_driver_id")
      .eq("job_id", job_id)
      .maybeSingle();

    if (jobErr || !job) {
      return jsonResp({ success: false, error_code: "job_not_found", error: "Job not found", context: { job_id } }, 404);
    }

    // Idempotency: same driver already assigned
    if (job.assigned_driver_id === driver_id) {
      return jsonResp({
        success:    true,
        outcome:    "already_assigned",
        job_id,
        driver_id,
        message:    "Driver already assigned to this job",
      });
    }

    // Guard: different driver already assigned
    if (job.assigned_driver_id) {
      return jsonResp({
        success: false,
        error_code: "already_assigned_other",
        error: `Job already assigned to a different driver (${job.assigned_driver_id})`,
        context: { job_id, assigned_driver_id: job.assigned_driver_id },
      }, 409);
    }

    // ── 2. Resolve offer if provided ─────────────────────────────────────────
    let resolvedTruckId = truck_id as string | null;

    if (offer_id) {
      const { data: offer, error: offerErr } = await supabase
        .from("dispatch_offers")
        .select("offer_id, offer_status, truck_id")
        .eq("offer_id", offer_id)
        .maybeSingle();

      if (offerErr || !offer) {
        return jsonResp({ success: false, error_code: "offer_not_found", error: "Offer not found", context: { offer_id } }, 404);
      }

      // Accept this offer (if still pending)
      if (offer.offer_status === "pending") {
        await supabase.from("dispatch_offers")
          .update({ offer_status: "accepted" })
          .eq("offer_id", offer_id);
      }

      // Expire sibling pending offers
      await supabase.from("dispatch_offers")
        .update({ offer_status: "expired" })
        .eq("job_id", job_id)
        .neq("offer_id", offer_id)
        .eq("offer_status", "pending");

      // Use truck_id from offer if not supplied directly
      if (!resolvedTruckId) {
        resolvedTruckId = (offer.truck_id as string | null) ?? null;
      }
    }

    // ── 3. Assign driver to job ──────────────────────────────────────────────
    const oldStatus = job.job_status;
    const newStatus = "driver_enroute";

    const { error: updateErr } = await supabase.from("jobs").update({
      assigned_driver_id:    driver_id,
      assigned_truck_id:     resolvedTruckId,
      job_status:            newStatus,
      reserved_driver_id:    null,
      reservation_expires_at: null,
    }).eq("job_id", job_id);

    if (updateErr) {
      return jsonResp({
        success: false,
        error_code: "db_error",
        error: `Job update failed: ${updateErr.message}`,
        context: { job_id },
      }, 500);
    }

    // ── 4. Fetch driver name for logs ────────────────────────────────────────
    const { data: driver } = await supabase
      .from("drivers")
      .select("driver_name")
      .eq("driver_id", driver_id)
      .single();

    const driverName = driver?.driver_name ?? driver_id;

    // ── 5. Write decision_log + job_events ───────────────────────────────────
    await Promise.all([
      supabase.from("decision_logs").insert({
        job_id,
        decision_type:    "dispatch",
        decision_outcome: "driver_assigned",
        decided_by:       "system",
        confidence:       1.0,
        factors: {
          driver_id,
          driver_name:  driverName,
          truck_id:     resolvedTruckId,
          offer_id,
          old_status:   oldStatus,
          new_status:   newStatus,
          assigned_by:  "assign-driver-to-job",
        },
      }),
      supabase.from("job_events").insert({
        job_id,
        event_type:     "driver_assigned",
        event_category: "dispatch",
        actor_type:     "system",
        message: `Driver ${driverName} assigned to job — status: ${oldStatus} → ${newStatus}`,
        new_value: {
          assigned_driver_id: driver_id,
          assigned_truck_id:  resolvedTruckId,
          job_status:         newStatus,
          offer_id,
        },
      }),
    ]);

    console.log(`[ASSIGN-DRIVER] Complete — job=${job_id} driver=${driverName} ${oldStatus} → ${newStatus}`);

    return jsonResp({
      success:    true,
      outcome:    "driver_assigned",
      job_id,
      driver_id,
      driver_name: driverName,
      truck_id:    resolvedTruckId,
      offer_id,
      old_status:  oldStatus,
      new_status:  newStatus,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ASSIGN-DRIVER] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});
