export type JobStatus =
  | "pending_customer_confirmation"
  | "pending_pricing"
  | "pending_customer_price_approval"
  | "payment_authorization_required"
  | "payment_authorized"
  | "ready_for_dispatch"
  | "driver_offer_sent"
  | "driver_assigned"
  | "driver_enroute"
  | "driver_arrived"
  | "service_in_progress"
  | "pending_completion_approval"
  | "job_completed"
  | "driver_cancelled_at_scene"
  | "customer_reapproval_pending"
  | "cancelled_by_customer";

export interface Job {
  job_id: string;
  job_status: JobStatus;
  pickup_location: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  estimated_price: number | null;
  assigned_driver_id: string | null;
  customer_phone: string | null;
  can_vehicle_roll: boolean | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  amendment_reason: string | null;
}

export interface Driver {
  driver_id: string;
  driver_name: string;
  company_name: string;
  phone: string;
  rating: number;
  gps_lat: number | null;
  gps_long: number | null;
}

/** Human-readable labels for each status */
export const STATUS_LABELS: Record<JobStatus, string> = {
  pending_customer_confirmation: "Please Confirm Your Details",
  pending_pricing: "Getting Your Quote",
  pending_customer_price_approval: "Review Your Quote",
  payment_authorization_required: "Payment Needed",
  payment_authorized: "Payment Confirmed",
  ready_for_dispatch: "Finding a Driver",
  driver_offer_sent: "Finding a Driver",
  driver_assigned: "Driver Assigned",
  driver_enroute: "Driver On the Way",
  driver_arrived: "Driver Has Arrived",
  service_in_progress: "Service In Progress",
  pending_completion_approval: "Confirm Service Complete",
  job_completed: "Service Complete",
  driver_cancelled_at_scene: "Driver Unavailable",
  customer_reapproval_pending: "Revised Quote - Please Review",
  cancelled_by_customer: "Cancelled",
};

/** Which statuses mean the customer needs to take action */
export const CUSTOMER_ACTION_REQUIRED: Set<JobStatus> = new Set([
  "pending_customer_confirmation",
  "pending_customer_price_approval",
  "payment_authorization_required",
  "pending_completion_approval",
  "customer_reapproval_pending",
]);
