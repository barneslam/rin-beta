-- ============================================================
-- RIN Workflow Hardening — Phase 1
-- Adds exception tracking and step deadline visibility to jobs.
-- ============================================================

-- exception_code: queryable, set when a job enters a failure/exception state
--   without changing job_status (e.g., payment_sms_failed while staying at
--   payment_authorization_required, invalid_customer_phone, no_driver_response)
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS exception_code text;

-- exception_message: human-readable description of the exception for operator UI
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS exception_message text;

-- step_deadline_at: when the current step must complete by.
--   Set when time-sensitive steps begin (offer sent, payment required).
--   Used for countdown display and watchdog scans instead of deriving from updated_at.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS step_deadline_at timestamptz;

-- Index: fast exception queue queries ("show me all jobs needing attention")
CREATE INDEX IF NOT EXISTS idx_jobs_exception_code
  ON public.jobs (exception_code)
  WHERE exception_code IS NOT NULL;

-- Index: watchdog deadline sweep (find jobs where deadline has passed)
CREATE INDEX IF NOT EXISTS idx_jobs_step_deadline
  ON public.jobs (step_deadline_at)
  WHERE step_deadline_at IS NOT NULL;
