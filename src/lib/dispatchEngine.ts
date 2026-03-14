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

export interface RankedDriver {
  driver: Driver;
  truck: Truck;
  distanceKm: number;
  etaMinutes: number;
  score: number;
}

// ---------------------------------------------------------------------------
// Module 1 — Job Validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof Job)[] = [
  "incident_type_id",
  "pickup_location",
  "gps_lat",
  "gps_long",
  "vehicle_make",
  "vehicle_model",
  "vehicle_year",
  "can_vehicle_roll",
  "location_type",
];

export function validateJobForDispatch(job: Job): ValidationResult {
  const missingFields: string[] = [];
  const presentFields: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = job[field];
    if (value === null || value === undefined || value === "") {
      missingFields.push(field);
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
// Placeholder: Haversine distance helper
// Will be replaced with Google Maps routing API in a future phase.
// ---------------------------------------------------------------------------

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius km
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

export function filterEligibleDrivers(
  job: Job,
  drivers: Driver[],
  eligibleTrucks: Truck[],
  minReliability = 60
): Driver[] {
  const eligibleDriverIds = new Set(eligibleTrucks.map((t) => t.driver_id));
  const jobLat = Number(job.gps_lat);
  const jobLng = Number(job.gps_long);

  if (!jobLat || !jobLng) return [];

  return drivers.filter((d) => {
    if (!eligibleDriverIds.has(d.driver_id)) return false;
    if (d.availability_status !== "available") return false;
    if ((d.reliability_score ?? 0) < minReliability) return false;

    const dLat = Number((d as any).gps_lat);
    const dLng = Number((d as any).gps_long);
    if (!dLat || !dLng) return false;

    const distance = haversineDistanceKm(dLat, dLng, jobLat, jobLng);
    return distance <= Number(d.service_radius_km ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Module 5 — ETA Estimation (Placeholder)
// Placeholder: distance / 0.8 km/min ≈ 48 km/h average urban speed
// Will be replaced with Google Maps Directions API.
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
// Module 6 — Dispatch Recommendation Engine
// ---------------------------------------------------------------------------

export function rankDrivers(
  eligibleDrivers: Driver[],
  job: Job,
  eligibleTrucks: Truck[]
): RankedDriver[] {
  const jobLat = Number(job.gps_lat);
  const jobLng = Number(job.gps_long);
  if (!jobLat || !jobLng || eligibleDrivers.length === 0) return [];

  // Calculate distances for normalization
  const driverData = eligibleDrivers.map((driver) => {
    const dLat = Number((driver as any).gps_lat);
    const dLng = Number((driver as any).gps_long);
    const distanceKm = haversineDistanceKm(dLat, dLng, jobLat, jobLng);
    const etaMinutes = estimateETA(dLat, dLng, jobLat, jobLng);
    const truck = eligibleTrucks.find((t) => t.driver_id === driver.driver_id)!;
    return { driver, truck, distanceKm, etaMinutes };
  });

  const maxDistance = Math.max(...driverData.map((d) => d.distanceKm), 1);

  return driverData
    .map(({ driver, truck, distanceKm, etaMinutes }) => {
      const proximityScore = 1 - distanceKm / maxDistance;
      const ratingScore = Number(driver.rating ?? 0) / 5;
      const reliabilityScore = Number(driver.reliability_score ?? 0) / 100;
      // Workload balance: flat 0.5 neutral — placeholder for future job-count-based balancing
      const workloadScore = 0.5;

      const score =
        0.4 * proximityScore +
        0.3 * ratingScore +
        0.2 * reliabilityScore +
        0.1 * workloadScore;

      return { driver, truck, distanceKm, etaMinutes, score };
    })
    .sort((a, b) => b.score - a.score);
}
