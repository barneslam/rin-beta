import type { Database } from "@/integrations/supabase/types";

// Core row types from Supabase
export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];
export type JobUpdate = Database["public"]["Tables"]["jobs"]["Update"];

export type Driver = Database["public"]["Tables"]["drivers"]["Row"];
export type Truck = Database["public"]["Tables"]["trucks"]["Row"];
export type TruckType = Database["public"]["Tables"]["truck_types"]["Row"];
export type Equipment = Database["public"]["Tables"]["equipment"]["Row"];
export type IncidentType = Database["public"]["Tables"]["incident_types"]["Row"];
export type PricingRule = Database["public"]["Tables"]["pricing_rules"]["Row"];
export type DispatchOffer = Database["public"]["Tables"]["dispatch_offers"]["Row"];
export type DispatchOfferInsert = Database["public"]["Tables"]["dispatch_offers"]["Insert"];
export type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
export type Review = Database["public"]["Tables"]["reviews"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];

export type JobStatus = Database["public"]["Enums"]["job_status"];
export type OfferStatus = Database["public"]["Enums"]["offer_status"];
export type TruckStatus = Database["public"]["Enums"]["truck_status"];
export type DriverAvailability = Database["public"]["Enums"]["driver_availability"];
export type AuditEventType = Database["public"]["Enums"]["audit_event_type"];

// Step definitions for the 7-step flow
export const JOB_STEPS = [
  { key: "intake", label: "Incident Intake", path: "/intake", step: 1 },
  { key: "validation", label: "Validation", path: "/validation", step: 2 },
  { key: "dispatch", label: "Dispatch Decision", path: "/dispatch", step: 3 },
  { key: "pricing", label: "Pricing & Auth", path: "/pricing", step: 4 },
  { key: "matching", label: "Driver Matching", path: "/matching", step: 5 },
  { key: "offer", label: "Driver Offer", path: "/offer", step: 6 },
  { key: "tracking", label: "Job Tracking", path: "/tracking", step: 7 },
] as const;

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  intake_started: "Intake Started",
  intake_completed: "Intake Completed",
  validation_required: "Validation Required",
  ready_for_dispatch: "Ready for Dispatch",
  dispatch_recommendation_ready: "Recommendation Ready",
  driver_offer_prepared: "Offer Prepared",
  driver_offer_sent: "Offer Sent",
  driver_assigned: "Driver Assigned",
  driver_enroute: "Driver En Route",
  job_completed: "Job Completed",
  job_amended: "Job Amended",
};

export const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  intake_started: "bg-muted text-muted-foreground",
  intake_completed: "bg-primary/10 text-primary",
  validation_required: "bg-accent/20 text-accent-foreground",
  ready_for_dispatch: "bg-primary/15 text-primary",
  dispatch_recommendation_ready: "bg-primary/20 text-primary",
  driver_offer_prepared: "bg-accent/25 text-accent-foreground",
  driver_offer_sent: "bg-accent/30 text-accent-foreground",
  driver_assigned: "bg-success/15 text-success",
  driver_enroute: "bg-success/25 text-success",
  job_completed: "bg-success/20 text-success",
  job_amended: "bg-destructive/10 text-destructive",
};
