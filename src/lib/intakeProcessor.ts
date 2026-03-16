import type { IntakePayload, ConfidenceLevel } from "@/types/intake";
import { REQUIRED_INTAKE_FIELDS, TOW_REQUIRED_FIELDS, FIELD_LABELS } from "@/types/intake";
import { supabase } from "@/integrations/supabase/client";

export interface IntakeProcessingResult {
  ready: boolean;
  missingFields: string[];
  missingFieldLabels: string[];
  payload: IntakePayload;
}

/**
 * Process an IntakePayload: validate required fields, attempt geocoding,
 * infer tow requirements, and return readiness status.
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
      // Drivable vehicle — check if incident implies tow anyway
      const towKeywords = ["accident", "collision", "totaled", "tow"];
      const desc = updated.incident_description.toLowerCase();
      updated.tow_required = towKeywords.some((k) => desc.includes(k));
    }
  }

  // 3. Validate required fields
  const missing: string[] = [];
  for (const field of REQUIRED_INTAKE_FIELDS) {
    const val = updated[field];
    if (val === null || val === undefined || val === "") {
      missing.push(field);
    }
  }

  // 4. If tow is required, check tow-specific fields
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
