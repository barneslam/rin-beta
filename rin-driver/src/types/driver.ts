export interface DispatchOffer {
  offer_id: string;
  job_id: string;
  driver_id: string;
  truck_id: string;
  offer_status: "pending" | "accepted" | "declined" | "expired";
  expires_at: string;
  created_at: string;
  token: string;
}

export interface JobForDriver {
  job_id: string;
  job_status: string;
  pickup_location: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_condition: string | null;
  can_vehicle_roll: boolean | null;
  estimated_price: number | null;
  customer_phone: string | null;
  incident_type_id: string | null;
  assigned_driver_id: string | null;
  amendment_reason: string | null;
  created_at: string;
}

export interface DriverProfile {
  driver_id: string;
  driver_name: string;
  company_name: string;
  phone: string;
  availability_status: "available" | "busy" | "offline";
  is_active: boolean;
}

/** Driver action states */
export type DriverActionPhase =
  | "idle"              // No active job
  | "offer_pending"     // Offer received, waiting to accept/decline
  | "enroute"           // Accepted, driving to scene
  | "on_scene"          // Arrived at scene
  | "working"           // Service in progress
  | "awaiting_confirm"  // Marked DONE, waiting for customer
  | "completed";        // Job done

export const INCIDENT_NAMES: Record<string, string> = {
  "34c06174-258e-4bed-978f-cad26ee6c789": "Flat Tire",
  "a4cdb184-d275-41a0-a2dc-cf17fe4ba5c9": "Battery Boost",
  "1d8d7d3b-c58b-4b2b-944e-b1c00ca8969f": "Tow",
  "3629c93a-0972-474f-b8f5-5e9124ce3445": "Winch / Recovery",
  "2d677673-e400-423b-88a6-89632546ec46": "Accident / Collision",
  "a53fc74d-2c2c-40dd-ad2f-8141137dda51": "Lockout",
  "f2c9fc2d-d3a4-4aac-a607-9568de922a1d": "Fuel Delivery",
  "8e5dd7f8-28df-4f98-be40-5d8c05eaff41": "Mechanical Breakdown",
  "252293cb-7340-4b47-8cf6-b2a7813f4309": "Other",
  "a1bb065d-725a-43e6-86ab-009c370af32d": "Stuck Vehicle",
};
