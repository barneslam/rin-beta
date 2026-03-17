
CREATE TABLE public.voice_call_sessions (
  call_sid TEXT PRIMARY KEY,
  step INTEGER NOT NULL DEFAULT 1,
  retry_count INTEGER NOT NULL DEFAULT 0,
  caller_phone TEXT,
  incident_description TEXT,
  drivable BOOLEAN,
  location_type TEXT,
  location_text TEXT,
  vehicle_info TEXT,
  destination_text TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.voice_call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_sessions_select" ON public.voice_call_sessions FOR SELECT USING (true);
CREATE POLICY "voice_sessions_insert" ON public.voice_call_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "voice_sessions_update" ON public.voice_call_sessions FOR UPDATE USING (true);
