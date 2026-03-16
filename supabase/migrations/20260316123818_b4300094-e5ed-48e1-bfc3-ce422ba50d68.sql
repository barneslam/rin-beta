
-- Add new job status enum values
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'service_in_progress';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'payment_authorized';

-- Add reservation and cancellation fee columns to jobs
ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS reserved_driver_id uuid,
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_fee_applicable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS cancellation_fee_reason text;

-- Create driver_location_updates table
CREATE TABLE IF NOT EXISTS public.driver_location_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(job_id),
  driver_id uuid NOT NULL REFERENCES public.drivers(driver_id),
  lat numeric(10,7) NOT NULL,
  lng numeric(10,7) NOT NULL,
  speed_kmh numeric,
  heading numeric,
  recorded_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.driver_location_updates ENABLE ROW LEVEL SECURITY;

-- Permissive RLS policies for MVP
CREATE POLICY "Driver location updates are readable by all" ON public.driver_location_updates FOR SELECT USING (true);
CREATE POLICY "Driver location updates can be inserted by all" ON public.driver_location_updates FOR INSERT WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_location_updates;
