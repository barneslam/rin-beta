/**
 * Shared phone number validation for RIN Edge Functions.
 *
 * Usage:
 *   import { normalizePhone, validatePhone } from "../_shared/phone.ts";
 *
 *   const check = validatePhone(rawPhone);
 *   if (!check.valid) { ... set exception ... }
 *   // Use check.e164 for the normalized form
 */

export interface PhoneValidationResult {
  valid: boolean;
  e164: string;
  reason?: "empty" | "not_e164" | "fake_number";
}

/**
 * Phone patterns that Twilio rejects (causes 400 "invalid To number") or are
 * obviously fake/placeholder values used in test data.
 */
const FAKE_PATTERNS: RegExp[] = [
  /^\+1555\d{7}$/, // Classic US 555 test numbers (+15551234567 etc)
  /^\+10{10}$/,    // +10000000000
  /^\+11{10}$/,    // +11111111111
  /^\+12{10}$/,    // +12222222222
  /^\+13{10}$/,
  /^\+14{10}$/,
  /^\+15{10}$/,
  /^\+16{10}$/,
  /^\+17{10}$/,
  /^\+18{10}$/,
  /^\+19{10}$/,
];

/**
 * Normalize a raw phone string to E.164.
 * Strips spaces, dashes, parentheses, dots.
 * Assumes North American (+1) for 10-digit bare numbers.
 * Mirrors the logic in twilio-webhook — keep these in sync.
 */
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  let cleaned = raw.replace(/[\s\-\(\)\.]/g, "");
  if (!cleaned.startsWith("+")) {
    if (cleaned.startsWith("1") && cleaned.length === 11) {
      cleaned = "+" + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = "+1" + cleaned;
    } else {
      cleaned = "+" + cleaned;
    }
  }
  return cleaned;
}

/**
 * Validate a phone number.
 * Normalizes first, then checks E.164 format and fake-number patterns.
 * Always returns the normalized e164 value (may be empty/invalid).
 */
export function validatePhone(raw: string): PhoneValidationResult {
  if (!raw || raw.trim() === "") {
    return { valid: false, e164: "", reason: "empty" };
  }

  const e164 = normalizePhone(raw.trim());

  if (!/^\+[1-9]\d{6,14}$/.test(e164)) {
    return { valid: false, e164, reason: "not_e164" };
  }

  for (const pattern of FAKE_PATTERNS) {
    if (pattern.test(e164)) {
      return { valid: false, e164, reason: "fake_number" };
    }
  }

  return { valid: true, e164 };
}
