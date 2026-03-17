/**
 * Canonical Intake Payload — shared by chat, form, and future voice intake.
 * All intake methods produce this same structure before job creation.
 */

export type ConfidenceLevel = "high" | "medium" | "low";
export type IntakeSource = "chat" | "form" | "voice";

export interface IntakePayload {
  incident_description: string;
  incident_type: string | null;

  location_text: string;
  location_lat: number | null;
  location_lng: number | null;
  location_type: string | null;
  location_confidence: ConfidenceLevel;

  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number | null;

  drivable: boolean | null;
  tow_required: boolean | null;

  destination_text: string | null;
  destination_lat: number | null;
  destination_lng: number | null;

  caller_name: string;
  caller_phone: string;

  language: string;
  intake_source: IntakeSource;

  missing_fields: string[];
  field_confidence: Record<string, ConfidenceLevel>;
}

/** Fields required before a job can be created */
export const REQUIRED_INTAKE_FIELDS: (keyof IntakePayload)[] = [
  "location_text",
  "incident_description",
  "vehicle_make",
  "vehicle_model",
  "drivable",
  "caller_phone",
];

/** Additional fields required for tow jobs */
export const TOW_REQUIRED_FIELDS: (keyof IntakePayload)[] = [
  "destination_text",
];

/** Human-readable labels for missing field prompts */
export const FIELD_LABELS: Record<string, string> = {
  location_text: "a specific address, intersection, highway exit, or landmark with city",
  incident_description: "what happened",
  vehicle_make: "your vehicle make",
  vehicle_model: "your vehicle model",
  drivable: "whether your vehicle can still drive",
  caller_phone: "your phone number",
  destination_text: "where to tow your vehicle",
};

/**
 * Patterns that indicate a vague / non-routable location.
 * These alone (without additional specifics) are not operationally useful.
 */
export const VAGUE_LOCATION_PATTERNS: RegExp[] = [
  /^(downtown|uptown|midtown)$/i,
  /^(parking\s*(lot|garage)|garage|underground\s*garage)$/i,
  /^(near|by|close\s*to|off)\s+(the\s+)?(highway|freeway|road|interstate|mall|airport|bridge)$/i,
  /^(side\s+of\s+(the\s+)?road)$/i,
  /^(highway|freeway|interstate|road|street)$/i,
  /^(my\s+house|my\s+place|home|work|office|school)$/i,
  /^(a\s+)?(mall|store|gas\s*station|rest\s*stop|rest\s*area)$/i,
  /^(somewhere|around|in\s+the\s+area)$/i,
];

export const LOCATION_COMPLETENESS_PROMPT =
  "Please provide the nearest street address, intersection, highway exit, or landmark with city name.";

/** Create a blank intake payload with defaults */
export function createBlankPayload(source: IntakeSource): IntakePayload {
  return {
    incident_description: "",
    incident_type: null,
    location_text: "",
    location_lat: null,
    location_lng: null,
    location_type: null,
    location_confidence: "low",
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: null,
    drivable: null,
    tow_required: null,
    destination_text: null,
    destination_lat: null,
    destination_lng: null,
    caller_name: "",
    caller_phone: "",
    language: "en",
    intake_source: source,
    missing_fields: [],
    field_confidence: {},
  };
}
