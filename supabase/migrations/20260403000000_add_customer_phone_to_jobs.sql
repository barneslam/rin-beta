-- Migration: add customer_phone to jobs
-- Adds a denormalized E.164 customer phone field on the jobs table.
-- Populated at intake time so SMS functions don't need a JOIN to users.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- Backfill from users for existing jobs
UPDATE jobs j
SET customer_phone = u.phone
FROM users u
WHERE j.user_id = u.user_id
  AND j.customer_phone IS NULL
  AND u.phone IS NOT NULL;

COMMENT ON COLUMN jobs.customer_phone IS 'E.164 customer phone number, copied from users.phone at job creation. Canonical for all outbound SMS — avoids runtime JOIN to users.';
