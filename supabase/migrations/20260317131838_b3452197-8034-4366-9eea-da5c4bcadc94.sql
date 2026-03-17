
-- Job-level SMS confirmation (not just user-level)
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS sms_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS sms_confirmed_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS confirmation_channel text; -- 'sms', 'web', 'voice', 'chat'

-- User-level SMS tracking
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_sms_sent_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_sms_response_at timestamptz;

-- Driver-level SMS tracking + soft unreachable counter
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS last_sms_sent_at timestamptz;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS last_sms_response_at timestamptz;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS sms_delivery_status text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS no_response_count integer NOT NULL DEFAULT 0;

-- Offer-level SMS tracking
ALTER TABLE public.dispatch_offers ADD COLUMN IF NOT EXISTS sms_sent_at timestamptz;
ALTER TABLE public.dispatch_offers ADD COLUMN IF NOT EXISTS sms_delivery_status text;
