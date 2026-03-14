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

export const JOB_STATUS_LABELS: Record<string, string> = {
  intake_started: "Intake Started",
  intake_completed: "Intake Completed",
  validation_required: "Validation Required",
  ready_for_dispatch: "Ready for Dispatch",
  dispatch_recommendation_ready: "Recommendation Ready",
  driver_offer_prepared: "Offer Prepared",
  driver_offer_sent: "Offer Sent",
  driver_assigned: "Driver Assigned",
  driver_enroute: "Driver En Route",
  driver_arrived: "Driver Arrived",
  vehicle_loaded: "Vehicle Loaded",
  job_completed: "Job Completed",
  job_amended: "Job Amended",
  customer_reapproval_pending: "Customer Re-Approval Pending",
  reassignment_required: "Reassignment Required",
  driver_unavailable: "Driver Unavailable",
  cancelled_by_customer: "Cancelled by Customer",
  cancelled_after_dispatch: "Cancelled After Dispatch",
};

export const JOB_STATUS_COLORS: Record<string, string> = {
  intake_started: "bg-muted text-muted-foreground",
  intake_completed: "bg-primary/10 text-primary",
  validation_required: "bg-accent/20 text-accent-foreground",
  ready_for_dispatch: "bg-primary/15 text-primary",
  dispatch_recommendation_ready: "bg-primary/20 text-primary",
  driver_offer_prepared: "bg-accent/25 text-accent-foreground",
  driver_offer_sent: "bg-accent/30 text-accent-foreground",
  driver_assigned: "bg-success/15 text-success",
  driver_enroute: "bg-success/25 text-success",
  driver_arrived: "bg-success/30 text-success",
  vehicle_loaded: "bg-success/35 text-success",
  job_completed: "bg-success/20 text-success",
  job_amended: "bg-destructive/10 text-destructive",
  customer_reapproval_pending: "bg-accent/40 text-accent-foreground",
  reassignment_required: "bg-destructive/15 text-destructive",
  driver_unavailable: "bg-destructive/20 text-destructive",
  cancelled_by_customer: "bg-destructive/25 text-destructive",
  cancelled_after_dispatch: "bg-destructive/30 text-destructive",
};

export interface JobEvent {
  event_id: string;
  job_id: string;
  event_type: string;
  event_category: string;
  event_status: string | null;
  actor_type: string | null;
  actor_id: string | null;
  message: string | null;
  reason: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}
