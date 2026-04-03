/**
 * match-drivers-for-job — Batch 7, Driver Matching Engine
 *
 * Evaluates eligible drivers for a job and returns a ranked candidate list.
 * Does NOT send SMS, create dispatch_offers, or assign a driver.
 *
 * ── Input ─────────────────────────────────────────────────────────────────────
 *   { job_id: string }
 *
 * ── Outcomes ──────────────────────────────────────────────────────────────────
 *   match_candidates_generated — ≥1 eligible driver scored ≥ MIN_SCORE (25/100)
 *   no_eligible_drivers        — 0 drivers passed hard eligibility filters
 *   manual_dispatch_required   — drivers exist but none scored ≥ MIN_SCORE
 *   job_not_matchable          — job not in a matchable state or missing GPS
 *
 * ── Matchable job statuses ────────────────────────────────────────────────────
 *   ready_for_dispatch | no_driver_candidates | dispatch_recommendation_ready
 *
 * ── Hard eligibility filters (ALL required) ───────────────────────────────────
 *   1. driver.is_active = true
 *   2. driver.availability_status = 'available'
 *   3. truck.status = 'available' (driver must have ≥1 available truck)
 *   4. driver GPS within driver.service_radius_km of job pickup GPS
 *   5. Truck type matches job.required_truck_type_id (or incident default) if set
 *   6. No pending dispatch_offer for this driver+job combination
 *   7. driver.no_response_count < MAX_NO_RESPONSE (5)
 *
 * ── Scoring weights (sum to 100) ──────────────────────────────────────────────
 *   ETA/distance    30%  Haversine distance, assumes 40 km/h; floor at 25 km
 *   Capability      25%  Truck type match quality
 *   Reliability     25%  driver.reliability_score / 100
 *   Fairness        10%  Recency of offers in last 24h (dampens overuse)
 *   Responsiveness  10%  1 - (no_response_count / MAX_NO_RESPONSE)
 *
 * ── Job status transitions ────────────────────────────────────────────────────
 *   match_candidates_generated → dispatch_recommendation_ready
 *   no_eligible_drivers        → no_driver_candidates
 *   manual_dispatch_required   → validation_required
 *   job_not_matchable          → no change
 *
 * ── DB writes ─────────────────────────────────────────────────────────────────
 *   decision_logs (1 record — full explainability payload)
 *   jobs (job_status, dispatch_attempt_count)
 *
 * ── DB reads ──────────────────────────────────────────────────────────────────
 *   jobs, incident_types, drivers, trucks, truck_types, dispatch_offers
 *
 * Must NOT: send SMS, create dispatch_offers, write job_events, assign driver
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_SCORE          = 25;   // /100 — below this → manual_dispatch_required
const MAX_NO_RESPONSE    = 5;    // hard filter threshold
const MAX_ETA_KM         = 25;   // distance at which ETA score reaches 0
const AVG_SPEED_KMH      = 40;   // urban speed assumption for ETA estimation
const FAIRNESS_WINDOW_H  = 24;   // hours for recent-offer fairness window
const FAIRNESS_MAX_OFFERS = 5;   // offers in window at which fairness score = 0

const MATCHABLE_STATUSES = [
  "ready_for_dispatch",
  "no_driver_candidates",
  "dispatch_recommendation_ready",
] as const;

// ── Scoring weights (must sum to 1.0) ─────────────────────────────────────────

const W_ETA            = 0.30;
const W_CAPABILITY     = 0.25;
const W_RELIABILITY    = 0.25;
const W_FAIRNESS       = 0.10;
const W_RESPONSIVENESS = 0.10;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  eta:            { score: number; distance_km: number; eta_minutes: number; weight: number };
  capability:     { score: number; weight: number; matched_type: boolean; required: boolean };
  reliability:    { score: number; weight: number; raw_score: number | null };
  fairness:       { score: number; weight: number; recent_offer_count: number };
  responsiveness: { score: number; weight: number; no_response_count: number };
}

interface RankedCandidate {
  rank:             number;
  driver_id:        string;
  driver_name:      string;
  truck_id:         string;
  truck_type_name:  string;
  truck_type_id:    string;
  score:            number;
  score_breakdown:  ScoreBreakdown;
  distance_km:      number;
  eta_minutes:      number;
}

interface FilteredDriver {
  driver_id:   string;
  driver_name: string;
  reason:      string;
}

// ── Haversine ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── JSON response ──────────────────────────────────────────────────────────────

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

// ── Main handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const t0 = Date.now();

  try {
    const body = await req.json();
    const { job_id } = body;

    if (!job_id) {
      return jsonResp({ success: false, error_code: "missing_params", error: "job_id is required" }, 400);
    }

    console.log(`[MATCH] job_id=${job_id}`);

    // ── 1. Read job + incident type ─────────────────────────────────────────────

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select(`
        job_id, job_status, pickup_location, gps_lat, gps_long,
        incident_type_id, required_truck_type_id, required_equipment,
        can_vehicle_roll, location_type, dispatch_attempt_count,
        incident_types (
          incident_type_id, incident_name, default_truck_type_id,
          complexity_level, requires_special_equipment
        )
      `)
      .eq("job_id", job_id)
      .maybeSingle();

    if (jobErr || !job) {
      return jsonResp({
        success: false, error_code: "job_not_found",
        error: jobErr?.message ?? "Job not found",
        context: { job_id },
      }, 404);
    }

    // ── 2. Matchability check ───────────────────────────────────────────────────

    if (!MATCHABLE_STATUSES.includes(job.job_status as typeof MATCHABLE_STATUSES[number])) {
      console.warn(`[MATCH] Not matchable — job_status=${job.job_status}`);
      return jsonResp({
        success:  true,
        outcome:  "job_not_matchable",
        job_id,
        job_status: job.job_status,
        reason:   `Job status '${job.job_status}' is not eligible for driver matching`,
      }, 200);
    }

    if (!job.gps_lat || !job.gps_long) {
      console.warn(`[MATCH] Not matchable — missing GPS`);
      await updateJobStatus(supabase, job_id, null, job.dispatch_attempt_count);
      return jsonResp({
        success: true,
        outcome: "job_not_matchable",
        job_id,
        reason:  "Job missing GPS coordinates — cannot compute driver distance",
      }, 200);
    }

    const jobLat = Number(job.gps_lat);
    const jobLon = Number(job.gps_long);

    // Resolve required truck type: explicit on job, or incident default
    const incident = Array.isArray(job.incident_types) ? job.incident_types[0] : job.incident_types;
    const requiredTruckTypeId: string | null =
      job.required_truck_type_id ?? incident?.default_truck_type_id ?? null;

    console.log(`[MATCH] job_status=${job.job_status} lat=${jobLat} lon=${jobLon} required_truck_type=${requiredTruckTypeId ?? "any"}`);

    // ── 3. Read all available drivers with trucks ───────────────────────────────

    const { data: driverRows, error: driversErr } = await supabase
      .from("drivers")
      .select(`
        driver_id, driver_name, gps_lat, gps_long, service_radius_km,
        rating, reliability_score, no_response_count,
        availability_status, is_active,
        trucks (
          truck_id, truck_type_id, status,
          max_vehicle_weight, winch_capacity,
          truck_types ( truck_type_id, name )
        )
      `)
      .eq("is_active", true)
      .eq("availability_status", "available");

    if (driversErr) {
      return jsonResp({
        success: false, error_code: "driver_query_failed",
        error: driversErr.message,
      }, 500);
    }

    const allDrivers = driverRows ?? [];
    console.log(`[MATCH] Total active+available drivers: ${allDrivers.length}`);

    // ── 4. Read pending offers for this job (to exclude those drivers) ──────────

    const { data: pendingOffers } = await supabase
      .from("dispatch_offers")
      .select("driver_id")
      .eq("job_id", job_id)
      .eq("offer_status", "pending");

    const pendingDriverIds = new Set((pendingOffers ?? []).map((o: { driver_id: string }) => o.driver_id));

    // ── 5. Read fairness data: recent offer count per driver in last 24h ────────

    const fairnessCutoff = new Date(Date.now() - FAIRNESS_WINDOW_H * 3600 * 1000).toISOString();
    const { data: recentOffers } = await supabase
      .from("dispatch_offers")
      .select("driver_id")
      .gte("sms_sent_at", fairnessCutoff);

    const recentOfferCounts = new Map<string, number>();
    for (const offer of recentOffers ?? []) {
      const o = offer as { driver_id: string };
      recentOfferCounts.set(o.driver_id, (recentOfferCounts.get(o.driver_id) ?? 0) + 1);
    }

    // ── 6. Apply hard filters + score ──────────────────────────────────────────

    const eligible: RankedCandidate[] = [];
    const filtered: FilteredDriver[]  = [];

    for (const driver of allDrivers) {
      const driverLat = driver.gps_lat  != null ? Number(driver.gps_lat)  : null;
      const driverLon = driver.gps_long != null ? Number(driver.gps_long) : null;
      const radiusKm  = driver.service_radius_km != null ? Number(driver.service_radius_km) : 50;

      // ── Hard filter: GPS required ─────────────────────────────────────────────
      if (driverLat === null || driverLon === null) {
        filtered.push({ driver_id: driver.driver_id, driver_name: driver.driver_name, reason: "no_gps" });
        continue;
      }

      // ── Hard filter: pending offer for this job ───────────────────────────────
      if (pendingDriverIds.has(driver.driver_id)) {
        filtered.push({ driver_id: driver.driver_id, driver_name: driver.driver_name, reason: "pending_offer" });
        continue;
      }

      // ── Hard filter: no_response_count ───────────────────────────────────────
      if ((driver.no_response_count ?? 0) >= MAX_NO_RESPONSE) {
        filtered.push({ driver_id: driver.driver_id, driver_name: driver.driver_name, reason: "max_no_response" });
        continue;
      }

      // ── Find best available truck ─────────────────────────────────────────────
      const trucks = (Array.isArray(driver.trucks) ? driver.trucks : driver.trucks ? [driver.trucks] : []) as Array<{
        truck_id: string; truck_type_id: string; status: string;
        max_vehicle_weight: number | null; winch_capacity: number | null;
        truck_types: { truck_type_id: string; name: string } | null;
      }>;

      const availableTrucks = trucks.filter(t => t.status === "available");

      if (availableTrucks.length === 0) {
        filtered.push({ driver_id: driver.driver_id, driver_name: driver.driver_name, reason: "no_available_truck" });
        continue;
      }

      // ── Hard filter: truck type match ─────────────────────────────────────────
      let matchedTruck = availableTrucks[0];
      let truckTypeMatched = false;

      if (requiredTruckTypeId) {
        const typedTruck = availableTrucks.find(t => t.truck_type_id === requiredTruckTypeId);
        if (!typedTruck) {
          filtered.push({ driver_id: driver.driver_id, driver_name: driver.driver_name, reason: "truck_type_mismatch" });
          continue;
        }
        matchedTruck    = typedTruck;
        truckTypeMatched = true;
      } else {
        truckTypeMatched = false; // no requirement — any truck is fine
      }

      // ── Hard filter: service radius ───────────────────────────────────────────
      const distanceKm = haversineKm(driverLat, driverLon, jobLat, jobLon);
      if (distanceKm > radiusKm) {
        filtered.push({ driver_id: driver.driver_id, driver_name: driver.driver_name, reason: "outside_radius" });
        continue;
      }

      // ── Compute scores ────────────────────────────────────────────────────────

      // ETA
      const etaScore    = Math.max(0, 1 - distanceKm / MAX_ETA_KM);
      const etaMinutes  = Math.round((distanceKm / AVG_SPEED_KMH) * 60);

      // Capability
      const capScore = (requiredTruckTypeId === null || truckTypeMatched) ? 1.0 : 0.0;

      // Reliability
      const relRaw   = driver.reliability_score != null ? Number(driver.reliability_score) : 75;
      const relScore = Math.min(1, relRaw / 100);

      // Fairness
      const recentCount = recentOfferCounts.get(driver.driver_id) ?? 0;
      const fairScore   = Math.max(0, 1 - recentCount / FAIRNESS_MAX_OFFERS);

      // Responsiveness
      const noResp    = driver.no_response_count ?? 0;
      const respScore = Math.max(0, 1 - noResp / MAX_NO_RESPONSE);

      // Weighted total
      const totalScore = 100 * (
        W_ETA            * etaScore +
        W_CAPABILITY     * capScore +
        W_RELIABILITY    * relScore +
        W_FAIRNESS       * fairScore +
        W_RESPONSIVENESS * respScore
      );

      const truckTypeName = matchedTruck.truck_types?.name ?? "Unknown";

      eligible.push({
        rank:            0, // assigned after sort
        driver_id:       driver.driver_id,
        driver_name:     driver.driver_name,
        truck_id:        matchedTruck.truck_id,
        truck_type_name: truckTypeName,
        truck_type_id:   matchedTruck.truck_type_id,
        score:           Math.round(totalScore * 10) / 10,
        distance_km:     Math.round(distanceKm * 10) / 10,
        eta_minutes:     etaMinutes,
        score_breakdown: {
          eta:            { score: Math.round(etaScore * 1000) / 1000, distance_km: Math.round(distanceKm * 10) / 10, eta_minutes: etaMinutes, weight: W_ETA },
          capability:     { score: capScore, weight: W_CAPABILITY, matched_type: truckTypeMatched, required: !!requiredTruckTypeId },
          reliability:    { score: Math.round(relScore * 1000) / 1000, weight: W_RELIABILITY, raw_score: driver.reliability_score != null ? Number(driver.reliability_score) : null },
          fairness:       { score: Math.round(fairScore * 1000) / 1000, weight: W_FAIRNESS, recent_offer_count: recentCount },
          responsiveness: { score: Math.round(respScore * 1000) / 1000, weight: W_RESPONSIVENESS, no_response_count: noResp },
        },
      });
    }

    // Sort descending by score, assign ranks
    eligible.sort((a, b) => b.score - a.score);
    eligible.forEach((c, i) => { c.rank = i + 1; });

    console.log(`[MATCH] Eligible: ${eligible.length} / Filtered: ${filtered.length}`);
    if (eligible.length > 0) {
      console.log(`[MATCH] Top candidate: ${eligible[0].driver_name} score=${eligible[0].score} distance=${eligible[0].distance_km}km eta=${eligible[0].eta_minutes}min`);
    }

    // ── 7. Determine outcome ───────────────────────────────────────────────────

    let outcome: string;
    let newJobStatus: string | null = null;

    if (eligible.length === 0) {
      outcome      = "no_eligible_drivers";
      newJobStatus = "no_driver_candidates";
    } else if (eligible[0].score < MIN_SCORE) {
      outcome      = "manual_dispatch_required";
      newJobStatus = "validation_required";
    } else {
      outcome      = "match_candidates_generated";
      newJobStatus = job.job_status === "dispatch_recommendation_ready"
        ? null              // already in the right status — no write needed
        : "dispatch_recommendation_ready";
    }

    console.log(`[MATCH] Outcome: ${outcome} newStatus=${newJobStatus ?? "no change"}`);

    const duration_ms = Date.now() - t0;

    // ── 8. Write decision_log ──────────────────────────────────────────────────

    const topScore = eligible.length > 0 ? eligible[0].score : 0;
    const confidence = eligible.length > 0 ? Math.round(topScore) / 100 : 0;

    const { data: decisionLog, error: decisionErr } = await supabase
      .from("decision_logs")
      .insert({
        job_id,
        decision_type:    "dispatch",
        decision_outcome: outcome,
        reasoning: eligible.length > 0
          ? `Found ${eligible.length} eligible driver(s). Top candidate ${eligible[0].driver_name} scored ${eligible[0].score}/100 (${eligible[0].distance_km}km, ${eligible[0].eta_minutes}min ETA).`
          : `No eligible drivers found after evaluating ${allDrivers.length} driver(s). ${filtered.length} driver(s) filtered.`,
        factors: {
          job_id,
          job_status:              job.job_status,
          required_truck_type_id:  requiredTruckTypeId,
          incident_type:           incident?.incident_name ?? null,
          job_lat:                 jobLat,
          job_lon:                 jobLon,
          total_drivers_evaluated: allDrivers.length,
          eligible_count:          eligible.length,
          filtered_count:          filtered.length,
          filter_breakdown: {
            no_gps:            filtered.filter(f => f.reason === "no_gps").length,
            pending_offer:     filtered.filter(f => f.reason === "pending_offer").length,
            max_no_response:   filtered.filter(f => f.reason === "max_no_response").length,
            no_available_truck:filtered.filter(f => f.reason === "no_available_truck").length,
            truck_type_mismatch:filtered.filter(f => f.reason === "truck_type_mismatch").length,
            outside_radius:    filtered.filter(f => f.reason === "outside_radius").length,
          },
          ranked_candidates: eligible.map(c => ({
            rank:           c.rank,
            driver_id:      c.driver_id,
            driver_name:    c.driver_name,
            truck_id:       c.truck_id,
            truck_type:     c.truck_type_name,
            score:          c.score,
            distance_km:    c.distance_km,
            eta_minutes:    c.eta_minutes,
            score_breakdown: c.score_breakdown,
          })),
          scoring_weights: {
            eta: W_ETA, capability: W_CAPABILITY, reliability: W_RELIABILITY,
            fairness: W_FAIRNESS, responsiveness: W_RESPONSIVENESS,
          },
          constants: {
            min_score: MIN_SCORE, max_eta_km: MAX_ETA_KM,
            avg_speed_kmh: AVG_SPEED_KMH, max_no_response: MAX_NO_RESPONSE,
          },
          duration_ms,
        },
        alternatives_considered: filtered.map(f => ({
          driver_id:   f.driver_id,
          driver_name: f.driver_name,
          reason_filtered: f.reason,
        })),
        decided_by: "system",
        confidence,
      })
      .select("decision_id")
      .single();

    if (decisionErr) {
      // Non-fatal — job update and response still proceed
      console.error(`[MATCH] decision_logs insert failed (non-fatal): ${decisionErr.message}`);
    } else {
      console.log(`[MATCH] Decision log written — decision_id=${decisionLog.decision_id}`);
    }

    // ── 9. Update job status + dispatch_attempt_count ──────────────────────────

    await updateJobStatus(supabase, job_id, newJobStatus, job.dispatch_attempt_count + 1);

    // ── 10. Return response ────────────────────────────────────────────────────

    return jsonResp({
      success:  true,
      outcome,
      job_id,
      candidates:            eligible,
      decision_id:           decisionLog?.decision_id ?? null,
      candidates_eligible:   eligible.length,
      candidates_filtered:   filtered.length,
      drivers_evaluated:     allDrivers.length,
      duration_ms,
    }, 200);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[MATCH] Unhandled error: ${msg}`);
    return jsonResp({ success: false, error_code: "internal_error", error: msg }, 500);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function updateJobStatus(
  supabase: ReturnType<typeof createClient>,
  job_id: string,
  newStatus: string | null,
  newAttemptCount: number,
): Promise<void> {
  const patch: Record<string, unknown> = { dispatch_attempt_count: newAttemptCount };
  if (newStatus) patch.job_status = newStatus;

  const { error } = await supabase
    .from("jobs")
    .update(patch)
    .eq("job_id", job_id);

  if (error) {
    console.error(`[MATCH] job update failed (non-fatal): ${error.message}`);
  } else {
    console.log(`[MATCH] Job updated — status=${newStatus ?? "unchanged"} attempt=${newAttemptCount}`);
  }
}
