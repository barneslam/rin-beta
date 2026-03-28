-- ============================================================
-- Add no_driver_candidates to job_status enum
-- Separates "no drivers exist for this job" from "dispatch waves exhausted"
-- (reassignment_required). This prevents premature escalation on first attempt.
-- ============================================================

ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'no_driver_candidates';
