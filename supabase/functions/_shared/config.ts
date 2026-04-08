/**
 * Shared configuration for all edge functions.
 * APP_BASE_URL is read from Supabase env vars — set via Dashboard > Edge Functions > Secrets.
 * Defaults to localhost for development.
 */
export const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://rin.app";
