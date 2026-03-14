
-- Add columns to jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS dispatch_priority_score numeric;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS dispatch_attempt_count integer NOT NULL DEFAULT 0;

-- Add GPS columns to drivers table
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS gps_lat numeric(10,7);
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS gps_long numeric(10,7);

-- Add new enum values to job_status
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'dispatch_recommendation_ready';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'driver_offer_prepared';
