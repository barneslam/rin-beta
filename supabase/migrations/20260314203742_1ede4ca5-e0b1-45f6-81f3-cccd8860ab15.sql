-- 1. Add new job_status enum values
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'customer_reapproval_pending';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'reassignment_required';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'driver_unavailable';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'cancelled_by_customer';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'cancelled_after_dispatch';

-- 2. Add new audit_event_type enum values
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'amendment_requested';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'reassignment_requested';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'driver_unavailable';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'job_cancelled';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'customer_update';

-- 3. Add columns to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_fee numeric;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_by text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS amendment_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reassignment_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_update_message text;

-- 4. Create job_events table
CREATE TABLE IF NOT EXISTS job_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_category text NOT NULL,
  event_status text,
  actor_type text,
  actor_id text,
  message text,
  reason text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_job_events_created_at ON job_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_events_event_category ON job_events(event_category);

-- 6. RLS
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Job events are readable by all" ON job_events FOR SELECT TO public USING (true);
CREATE POLICY "Job events can be inserted by all" ON job_events FOR INSERT TO public WITH CHECK (true);