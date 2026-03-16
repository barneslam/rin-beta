-- Add payment lifecycle statuses to job_status enum
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'payment_authorization_required';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'payment_failed';

-- Add stripe_payment_intent_id column to jobs
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;