/**
 * RIN Dispatch Decision Engine
 * Pure functions — no React dependencies.
 * Each module operates independently on typed data.
 */

import type { Job, Driver, Truck, IncidentType } from "@/types/rin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  missingFields: string[];
  presentFields: string[];
}

export interface IncidentClassification {
  truckTypeId: string | null;
  requiredEquipment: string[];
  complexityLevel: number;
}

export interface DispatchScoreBreakdown {
  etaScore: number;
  distanceScore: number;
  capabilityScore: number;
  reliabilityScore: number;
  fairnessScore: number;
  totalScore: number;
}

export interface RankedDriver {
  driver: Driver;
  truck: Truck;
  distanceKm: number;
  etaMinutes: number;
  score: number;
  scoreBreakdown: DispatchScoreBreakdown;
}

export interface RankOptions {
  recentOfferCounts?: Map<string, number>;
  requiredTruckTypeId?: string;
}

export interface FilterOptions {
  excludeDriverIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Module 1 — Job Validation
// ---------------------------------------------------------------------------

/** Hard-required fields for dispatch */
const REQUIRED_FIELDS: (keyof Job)[] = [
  "incident_type_id",
  "can_vehicle_roll",
];

/**
 * Validate a job for dispatch readiness.
 * Location: requires EITHER (gps_lat + gps_long) OR pickup_location.
 * Vehicle make/model: soft-required (tracked as present/missing but don't block).
 * location_type: defaults to "roadside" if missing.
 */
export function validateJobForDispatch(job: Job): ValidationResult {
  const missingFields: string[] = [];
  const presentFields: string[] = [];

  // Check hard-required fields
  for (const field of REQUIRED_FIELDS) {
    const value = job[field];
    if (value === null || value === undefined || value === "") {
      missingFields.push(field);
    } else {
      presentFields.push(field);
    }
  }

  // Location: need either coordinates or text
  const hasCoords = job.gps_lat != null && job.gps_long != null;
  const hasLocationText = !!job.pickup_location;
  if (hasCoords || hasLocationText) {
    presentFields.push("location");
    if (hasCoords) { presentFields.push("gps_lat"); presentFields.push("gps_long"); }
    if (hasLocationText) presentFields.push("pickup_location");
  } else {
    missingFields.push("location");
  }

  // Soft-tracked fields (informational, not blockers)
  const softFields: (keyof Job)[] = ["vehicle_make", "vehicle_model", "vehicle_year", "location_type"];
  for (const field of softFields) {
    const value = job[field];
    if (value === null || value === undefined || value === "") {
      // location_type defaults to roadside — don't flag as missing
      if (field === "location_type") {
        presentFields.push(field);
      }
      // vehicle fields are informational
    } else {
      presentFields.push(field);
    }
  }

  return { valid: missingFields.length === 0, missingFields, presentFields };
}

// ---------------------------------------------------------------------------
// Module 2 — Incident Classification
// ---------------------------------------------------------------------------

export function classifyIncident(
  job: Job,
  incidentTypes: IncidentType[]
): IncidentClassification | null {
  if (!job.incident_type_id) return null;

  const incident = incidentTypes.find(
    (t) => t.incident_type_id === job.incident_type_id
  );
  if (!incident) return null;

  return {
    truckTypeId: incident.default_truck_type_id,
    requiredEquipment: (incident.requires_special_equipment as string[]) || [],
    complexityLevel: incident.complexity_level ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Module 3 — Truck Capability Matching
// ---------------------------------------------------------------------------

export function matchTruckCapability(job: Job, trucks: Truck[]): Truck[] {
  if (!job.required_truck_type_id) return [];
  return trucks.filter(
    (t) =>
      t.truck_type_id === job.required_truck_type_id && t.status === "available"
  );
}

// ---------------------------------------------------------------------------
// Haversine distance helper
// ---------------------------------------------------------------------------

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Module 4 — Driver Eligibility Filter
// ---------------------------------------------------------------------------

function hasUsableCoordinates(lat: number | null, lng: number | null): boolean {
  return lat !== null && lng !== null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

export function filterEligibleDrivers(
  job: Job,
  drivers: Driver[],
  eligibleTrucks: Truck[],
  minReliability = 60,
  options?: FilterOptions
): Driver[] {
  const eligibleDriverIds = new Set(eligibleTrucks.map((t) => t.driver_id));
  const hasJobCoordinates = hasUsableCoordinates(job.gps_lat, job.gps_long);
  const jobLat = hasJobCoordinates ? Number(job.gps_lat) : null;
  const jobLng = hasJobCoordinates ? Number(job.gps_long) : null;
  const excludeIds = options?.excludeDriverIds;

  return drivers.filter((d) => {
    if (excludeIds?.has(d.driver_id)) return false;
    if (!eligibleDriverIds.has(d.driver_id)) return false;
    if (d.availability_status !== "available") return false;
    if ((d.reliability_score ?? 0) < minReliability) return false;

    if (!hasJobCoordinates || jobLat === null || jobLng === null) {
      return true;
    }

    if (!hasUsableCoordinates(d.gps_lat, d.gps_long)) return false;

    const dLat = Number(d.gps_lat);
    const dLng = Number(d.gps_long);
    const distance = haversineDistanceKm(dLat, dLng, jobLat, jobLng);
    return distance <= Number(d.service_radius_km ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Module 5 — ETA Estimation
// ---------------------------------------------------------------------------

export function estimateETA(
  driverLat: number,
  driverLng: number,
  jobLat: number,
  jobLng: number
): number {
  const distance = haversineDistanceKm(driverLat, driverLng, jobLat, jobLng);
  return Math.round(distance / 0.8);
}

// ---------------------------------------------------------------------------
// Module 6 — Dispatch Recommendation Engine (5-factor weighted)
// ---------------------------------------------------------------------------

// Weights
const W_ETA = 0.30;
const W_DISTANCE = 0.25;
const W_CAPABILITY = 0.20;
const W_RELIABILITY = 0.15;
const W_FAIRNESS = 0.10;

function computeCapabilityScore(
  truck: Truck,
  requiredTruckTypeId: string | undefined
): number {
  if (!requiredTruckTypeId) return 0.5;
  return truck.truck_type_id === requiredTruckTypeId ? 1.0 : 0.5;
}

function computeFairnessScore(
  driverId: string,
  recentOfferCounts?: Map<string, number>
): number {
  if (!recentOfferCounts || recentOfferCounts.size === 0) return 0.5;
  const count = recentOfferCounts.get(driverId) ?? 0;
  const maxCount = Math.max(...recentOfferCounts.values(), 1);
  return maxCount === 0 ? 1.0 : 1.0 - count / maxCount;
}

export function rankDrivers(
  eligibleDrivers: Driver[],
  job: Job,
  eligibleTrucks: Truck[],
  options?: RankOptions
): RankedDriver[] {
  if (eligibleDrivers.length === 0) return [];

  const hasJobCoordinates = hasUsableCoordinates(job.gps_lat, job.gps_long);

  // Fallback for jobs without GPS
  if (!hasJobCoordinates) {
    return eligibleDrivers
      .map((driver) => {
        const truck = eligibleTrucks.find((t) => t.driver_id === driver.driver_id)!;
        const reliabilityScore = Number(driver.reliability_score ?? 0) / 100;
        const capabilityScore = computeCapabilityScore(truck, options?.requiredTruckTypeId);
        const fairnessScore = computeFairnessScore(driver.driver_id, options?.recentOfferCounts);

        const totalScore =
          W_CAPABILITY * capabilityScore +
          W_RELIABILITY * reliabilityScore +
          W_FAIRNESS * fairnessScore +
          (W_ETA + W_DISTANCE) * 0.5; // neutral for missing geo

        const breakdown: DispatchScoreBreakdown = {
          etaScore: 0.5,
          distanceScore: 0.5,
          capabilityScore,
          reliabilityScore,
          fairnessScore,
          totalScore,
        };

        return { driver, truck, distanceKm: 0, etaMinutes: 0, score: totalScore, scoreBreakdown: breakdown };
      })
      .sort((a, b) => b.score - a.score);
  }

  const jobLat = Number(job.gps_lat);
  const jobLng = Number(job.gps_long);

  const driverData = eligibleDrivers.map((driver) => {
    const dLat = Number(driver.gps_lat);
    const dLng = Number(driver.gps_long);
    const distanceKm = haversineDistanceKm(dLat, dLng, jobLat, jobLng);
    const etaMinutes = estimateETA(dLat, dLng, jobLat, jobLng);
    const truck = eligibleTrucks.find((t) => t.driver_id === driver.driver_id)!;
    return { driver, truck, distanceKm, etaMinutes };
  });

  const maxDistance = Math.max(...driverData.map((d) => d.distanceKm), 1);
  const maxEta = Math.max(...driverData.map((d) => d.etaMinutes), 1);

  return driverData
    .map(({ driver, truck, distanceKm, etaMinutes }) => {
      const etaScore = 1 - etaMinutes / maxEta;
      const distanceScore = 1 - distanceKm / maxDistance;
      const capabilityScore = computeCapabilityScore(truck, options?.requiredTruckTypeId);
      const reliabilityScore = Number(driver.reliability_score ?? 0) / 100;
      const fairnessScore = computeFairnessScore(driver.driver_id, options?.recentOfferCounts);

      const totalScore =
        W_ETA * etaScore +
        W_DISTANCE * distanceScore +
        W_CAPABILITY * capabilityScore +
        W_RELIABILITY * reliabilityScore +
        W_FAIRNESS * fairnessScore;

      const breakdown: DispatchScoreBreakdown = {
        etaScore,
        distanceScore,
        capabilityScore,
        reliabilityScore,
        fairnessScore,
        totalScore,
      };

      return { driver, truck, distanceKm, etaMinutes, score: totalScore, scoreBreakdown: breakdown };
    })
    .sort((a, b) => b.score - a.score);
}
