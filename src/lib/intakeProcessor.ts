import type { IntakePayload, ConfidenceLevel } from "@/types/intake";
import {
  REQUIRED_INTAKE_FIELDS,
  TOW_REQUIRED_FIELDS,
  FIELD_LABELS,
  VAGUE_LOCATION_PATTERNS,
  LOCATION_COMPLETENESS_PROMPT,
} from "@/types/intake";
import { supabase } from "@/integrations/supabase/client";

export interface IntakeProcessingResult {
  ready: boolean;
  missingFields: string[];
  missingFieldLabels: string[];
  locationIncomplete: boolean;
  locationPrompt: string;
  payload: IntakePayload;
}

/**
 * Determine if a location_text is operationally complete enough for dispatch.
 * Coordinates or successful geocoding always override vague-text heuristics.
 */
export function isLocationComplete(
  text: string,
  lat: number | null,
  lng: number | null
): { complete: boolean; reason: string } {
  // GPS coordinates always override text checks
  if (lat != null && lng != null) {
    return { complete: true, reason: "has_coordinates" };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { complete: false, reason: "empty" };
  }

  // Check if the text matches a known vague pattern
  for (const pattern of VAGUE_LOCATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { complete: false, reason: "vague_pattern" };
    }
  }

  // If text contains digits (likely a street number or highway exit) → accept
  if (/\d/.test(trimmed)) {
    return { complete: true, reason: "has_digits" };
  }

  // If text contains "and" or "&" or "/" (likely an intersection) → accept
  if (/\b(and|&)\b|\//.test(trimmed)) {
    return { complete: true, reason: "intersection_pattern" };
  }

  // If text has 3+ words, it's likely specific enough
  if (trimmed.split(/\s+/).length >= 3) {
    return { complete: true, reason: "multi_word" };
  }

  // Short text with no digits, no intersection markers → likely vague
  return { complete: false, reason: "too_short_no_specifics" };
}

/**
 * Process an IntakePayload: validate required fields, attempt geocoding,
 * infer tow requirements, and return readiness status.
 *
 * Location logic: if coordinates are present, location_text is NOT required.
 * Vehicle year is optional. Make/model are soft-required (warned but not blocking).
 */
export async function processIntakePayload(
  payload: IntakePayload
): Promise<IntakeProcessingResult> {
  const updated = { ...payload };

  // 1. Attempt geocoding if text location provided but no coordinates
  if (updated.location_text && updated.location_lat == null) {
    try {
      const geo = await geocodeLocation(updated.location_text);
      if (geo.lat != null && geo.lng != null) {
        updated.location_lat = geo.lat;
        updated.location_lng = geo.lng;
        updated.location_confidence = geo.confidence;
        updated.field_confidence = {
          ...updated.field_confidence,
          location: geo.confidence,
        };
      }
    } catch (e) {
      console.warn("Geocoding failed, continuing without coordinates:", e);
    }
  }

  // If we have GPS coordinates, confidence is at least medium
  if (updated.location_lat != null && updated.location_lng != null) {
    if (updated.location_confidence === "low") {
      updated.location_confidence = "medium";
    }
  }

  // 2. Infer tow_required from drivable status + incident description
  if (updated.tow_required == null && updated.drivable != null) {
    if (updated.drivable === false) {
      updated.tow_required = true;
    } else {
      const towKeywords = ["accident", "collision", "totaled", "tow"];
      const desc = updated.incident_description.toLowerCase();
      updated.tow_required = towKeywords.some((k) => desc.includes(k));
    }
  }

  // 3. Validate required fields
  const missing: string[] = [];
  const hasCoordinates = updated.location_lat != null && updated.location_lng != null;

  for (const field of REQUIRED_INTAKE_FIELDS) {
    // Skip location_text if we have GPS coordinates
    if (field === "location_text" && hasCoordinates) {
      continue;
    }
    // Skip vehicle_year — it's optional
    // (vehicle_year is not in REQUIRED_INTAKE_FIELDS, but guard anyway)
    const val = updated[field];
    if (val === null || val === undefined || val === "") {
      missing.push(field);
    }
  }

  // 4. Location completeness check (only if no coordinates and location_text exists)
  let locationIncomplete = false;
  if (!hasCoordinates && updated.location_text && !missing.includes("location_text")) {
    const locCheck = isLocationComplete(
      updated.location_text,
      updated.location_lat,
      updated.location_lng
    );
    if (!locCheck.complete) {
      locationIncomplete = true;
      missing.push("location_text");
    }
  }

  // 5. If tow is required, check tow-specific fields
  if (updated.tow_required === true) {
    for (const field of TOW_REQUIRED_FIELDS) {
      const val = updated[field];
      if (val === null || val === undefined || val === "") {
        missing.push(field);
      }
    }
  }

  updated.missing_fields = missing;

  return {
    ready: missing.length === 0,
    missingFields: missing,
    missingFieldLabels: missing.map((f) => FIELD_LABELS[f] || f),
    locationIncomplete,
    locationPrompt: locationIncomplete ? LOCATION_COMPLETENESS_PROMPT : "",
    payload: updated,
  };
}

/**
 * Call the geocode-location edge function to convert text to coordinates.
 */
async function geocodeLocation(
  locationText: string
): Promise<{ lat: number | null; lng: number | null; confidence: ConfidenceLevel }> {
  const { data, error } = await supabase.functions.invoke("geocode-location", {
    body: { location_text: locationText },
  });

  if (error || !data) {
    return { lat: null, lng: null, confidence: "low" };
  }

  return {
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    confidence: data.confidence ?? "low",
  };
}

/**
 * Match an incident description string to an incident_type_id from reference data.
 */
export function matchIncidentTypeId(
  description: string,
  incidentTypes: Array<{ incident_type_id: string; incident_name: string; description: string | null }>
): string | null {
  if (!incidentTypes?.length || !description) return null;
  const lower = description.toLowerCase();

  const match = incidentTypes.find(
    (t) =>
      t.incident_name.toLowerCase().includes(lower) ||
      lower.includes(t.incident_name.toLowerCase()) ||
      (t.description &&
        (t.description.toLowerCase().includes(lower) ||
          lower.includes(t.description.toLowerCase())))
  );

  return match?.incident_type_id ?? incidentTypes[0]?.incident_type_id ?? null;
}
