-- ============================================================
-- RIN Full Test Baseline Reset
-- Resets ALL non-terminal jobs to ready_for_dispatch and
-- clears all dispatch_offers. Run before a clean test pass.
--
-- Terminal states (preserved): job_completed, cancelled_*
-- ============================================================

-- 1. Expire all pending offers
UPDATE dispatch_offers
SET offer_status = 'expired'
WHERE offer_status = 'pending';

-- 2. Reset dispatch-phase jobs (not completed/cancelled/intake)
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
WHERE job_status IN (
  'driver_offer_sent',
  'driver_enroute',
  'payment_authorization_required',
  'no_driver_candidates',
  'dispatch_recommendation_ready'
);

-- 3. Summary
SELECT job_status, COUNT(*) FROM jobs GROUP BY job_status ORDER BY job_status;
SELECT offer_status, COUNT(*) FROM dispatch_offers GROUP BY offer_status;
