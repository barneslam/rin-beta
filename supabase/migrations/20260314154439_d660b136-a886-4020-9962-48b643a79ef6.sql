
-- =============================================
-- RIN Phase 1 Foundation Schema
-- =============================================

-- ENUMS
CREATE TYPE public.job_status AS ENUM (
  'intake_started',
  'intake_completed',
  'validation_required',
  'ready_for_dispatch',
  'driver_offer_sent',
  'driver_assigned',
  'driver_enroute',
  'job_completed',
  'job_amended'
);

CREATE TYPE public.offer_status AS ENUM (
  'pending', 'accepted', 'declined', 'expired'
);

CREATE TYPE public.truck_status AS ENUM (
  'available', 'busy', 'offline'
);

CREATE TYPE public.driver_availability AS ENUM (
  'available', 'busy', 'offline'
);

CREATE TYPE public.audit_event_type AS ENUM (
  'job_created', 'job_updated', 'status_changed',
  'driver_assigned', 'offer_sent', 'offer_responded', 'system_event'
);

-- TIMESTAMP TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =============================================
-- 1. USERS (motorists)
-- =============================================
CREATE TABLE public.users (
  user_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  license_plate TEXT,
  payment_token_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users are readable by all" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can be inserted by all" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can be updated by all" ON public.users FOR UPDATE USING (true);
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 2. DRIVERS
-- =============================================
CREATE TABLE public.drivers (
  driver_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT,
  driver_name TEXT NOT NULL,
  phone TEXT,
  rating NUMERIC(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  service_radius_km NUMERIC(6,2),
  availability_status public.driver_availability NOT NULL DEFAULT 'available',
  reliability_score NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Drivers are readable by all" ON public.drivers FOR SELECT USING (true);
CREATE POLICY "Drivers can be inserted by all" ON public.drivers FOR INSERT WITH CHECK (true);
CREATE POLICY "Drivers can be updated by all" ON public.drivers FOR UPDATE USING (true);
CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_drivers_availability ON public.drivers (availability_status);

-- =============================================
-- 3. TRUCK TYPES (reference)
-- =============================================
CREATE TABLE public.truck_types (
  truck_type_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  max_weight_capacity NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.truck_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Truck types are readable by all" ON public.truck_types FOR SELECT USING (true);
CREATE POLICY "Truck types can be inserted by all" ON public.truck_types FOR INSERT WITH CHECK (true);

-- =============================================
-- 4. EQUIPMENT (reference)
-- =============================================
CREATE TABLE public.equipment (
  equipment_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipment is readable by all" ON public.equipment FOR SELECT USING (true);
CREATE POLICY "Equipment can be inserted by all" ON public.equipment FOR INSERT WITH CHECK (true);

-- =============================================
-- 5. TRUCKS
-- =============================================
CREATE TABLE public.trucks (
  truck_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES public.drivers(driver_id) ON DELETE CASCADE,
  truck_type_id UUID NOT NULL REFERENCES public.truck_types(truck_type_id),
  max_vehicle_weight NUMERIC(10,2),
  clearance_height NUMERIC(5,2),
  winch_capacity NUMERIC(10,2),
  status public.truck_status NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trucks are readable by all" ON public.trucks FOR SELECT USING (true);
CREATE POLICY "Trucks can be inserted by all" ON public.trucks FOR INSERT WITH CHECK (true);
CREATE POLICY "Trucks can be updated by all" ON public.trucks FOR UPDATE USING (true);
CREATE TRIGGER update_trucks_updated_at BEFORE UPDATE ON public.trucks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_trucks_status ON public.trucks (status);
CREATE INDEX idx_trucks_driver ON public.trucks (driver_id);
CREATE INDEX idx_trucks_type ON public.trucks (truck_type_id);

-- =============================================
-- 6. TRUCK_EQUIPMENT (junction)
-- =============================================
CREATE TABLE public.truck_equipment (
  truck_id UUID NOT NULL REFERENCES public.trucks(truck_id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES public.equipment(equipment_id) ON DELETE CASCADE,
  PRIMARY KEY (truck_id, equipment_id)
);
ALTER TABLE public.truck_equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Truck equipment is readable by all" ON public.truck_equipment FOR SELECT USING (true);
CREATE POLICY "Truck equipment can be inserted by all" ON public.truck_equipment FOR INSERT WITH CHECK (true);

-- =============================================
-- 7. INCIDENT TYPES
-- =============================================
CREATE TABLE public.incident_types (
  incident_type_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_truck_type_id UUID REFERENCES public.truck_types(truck_type_id),
  complexity_level INTEGER DEFAULT 1,
  requires_special_equipment JSONB DEFAULT '[]'::jsonb
);
ALTER TABLE public.incident_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Incident types are readable by all" ON public.incident_types FOR SELECT USING (true);
CREATE POLICY "Incident types can be inserted by all" ON public.incident_types FOR INSERT WITH CHECK (true);

-- =============================================
-- 8. PRICING RULES
-- =============================================
CREATE TABLE public.pricing_rules (
  rule_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_type_id UUID NOT NULL REFERENCES public.incident_types(incident_type_id),
  base_fee NUMERIC(10,2) NOT NULL,
  distance_rate_per_km NUMERIC(8,2) NOT NULL DEFAULT 0,
  equipment_surcharge NUMERIC(10,2) DEFAULT 0,
  complexity_surcharge NUMERIC(10,2) DEFAULT 0,
  minimum_authorization NUMERIC(10,2) DEFAULT 0
);
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pricing rules are readable by all" ON public.pricing_rules FOR SELECT USING (true);
CREATE POLICY "Pricing rules can be inserted by all" ON public.pricing_rules FOR INSERT WITH CHECK (true);

-- =============================================
-- 9. JOBS (CENTRAL OBJECT)
-- =============================================
CREATE TABLE public.jobs (
  job_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(user_id),
  incident_type_id UUID REFERENCES public.incident_types(incident_type_id),
  pickup_location TEXT,
  gps_lat NUMERIC(10,7),
  gps_long NUMERIC(10,7),
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_condition TEXT,
  can_vehicle_roll BOOLEAN,
  location_type TEXT,
  required_truck_type_id UUID REFERENCES public.truck_types(truck_type_id),
  required_equipment JSONB DEFAULT '[]'::jsonb,
  estimated_price NUMERIC(10,2),
  authorization_status TEXT DEFAULT 'pending',
  assigned_driver_id UUID REFERENCES public.drivers(driver_id),
  assigned_truck_id UUID REFERENCES public.trucks(truck_id),
  eta_minutes INTEGER,
  job_status public.job_status NOT NULL DEFAULT 'intake_started',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Jobs are readable by all" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Jobs can be inserted by all" ON public.jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Jobs can be updated by all" ON public.jobs FOR UPDATE USING (true);
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_jobs_status ON public.jobs (job_status);
CREATE INDEX idx_jobs_driver ON public.jobs (assigned_driver_id);
CREATE INDEX idx_jobs_user ON public.jobs (user_id);
CREATE INDEX idx_jobs_incident ON public.jobs (incident_type_id);
CREATE INDEX idx_jobs_created ON public.jobs (created_at);

-- =============================================
-- 10. DISPATCH OFFERS
-- =============================================
CREATE TABLE public.dispatch_offers (
  offer_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(driver_id),
  truck_id UUID REFERENCES public.trucks(truck_id),
  offer_status public.offer_status NOT NULL DEFAULT 'pending',
  response_time INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.dispatch_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dispatch offers are readable by all" ON public.dispatch_offers FOR SELECT USING (true);
CREATE POLICY "Dispatch offers can be inserted by all" ON public.dispatch_offers FOR INSERT WITH CHECK (true);
CREATE POLICY "Dispatch offers can be updated by all" ON public.dispatch_offers FOR UPDATE USING (true);
CREATE INDEX idx_offers_job ON public.dispatch_offers (job_id);
CREATE INDEX idx_offers_driver ON public.dispatch_offers (driver_id);
CREATE INDEX idx_offers_status ON public.dispatch_offers (offer_status);
CREATE INDEX idx_offers_expires ON public.dispatch_offers (expires_at);

-- =============================================
-- 11. REVIEWS
-- =============================================
CREATE TABLE public.reviews (
  review_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(driver_id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reviews are readable by all" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Reviews can be inserted by all" ON public.reviews FOR INSERT WITH CHECK (true);

-- =============================================
-- 12. AUDIT LOGS
-- =============================================
CREATE TABLE public.audit_logs (
  log_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  event_type public.audit_event_type NOT NULL DEFAULT 'system_event',
  event_source TEXT DEFAULT 'system',
  performed_by TEXT,
  old_value JSONB,
  new_value JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit logs are readable by all" ON public.audit_logs FOR SELECT USING (true);
CREATE POLICY "Audit logs can be inserted by all" ON public.audit_logs FOR INSERT WITH CHECK (true);
CREATE INDEX idx_audit_job ON public.audit_logs (job_id);
CREATE INDEX idx_audit_timestamp ON public.audit_logs (timestamp);
