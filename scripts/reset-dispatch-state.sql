-- ============================================================
-- RIN Dispatch State Reset Script
-- Safe to run in dev/staging. DO NOT run on production jobs
-- that are actively in driver_enroute or later states.
--
-- Resets a job back to ready_for_dispatch for clean re-testing.
-- Usage: replace :job_id with your target job UUID.
-- ============================================================

-- 1. Cancel all pending/expired offers for the job
UPDATE dispatch_offers
SET offer_status = 'expired'
WHERE job_id = :'job_id'
  AND offer_status = 'pending';

-- 2. Reset job to ready_for_dispatch, clear driver assignment
UPDATE jobs SET
  job_status            = 'ready_for_dispatch',
  assigned_driver_id    = NULL,
  assigned_truck_id     = NULL,
  reserved_driver_id    = NULL,
  reservation_expires_at = NULL,
  dispatch_attempt_count = 0,
  exception_code        = NULL,
  exception_message     = NULL,
  step_deadline_at      = NULL
WHERE job_id = :'job_id';

-- 3. Verify
SELECT job_id, job_status, assigned_driver_id, dispatch_attempt_count
FROM jobs WHERE job_id = :'job_id';

SELECT offer_id, driver_id, offer_status, created_at
FROM dispatch_offers WHERE job_id = :'job_id'
ORDER BY created_at DESC LIMIT 10;
