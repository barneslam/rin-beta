import { useMemo } from "react";
import type { Job, DispatchOffer, JobEvent } from "@/types/rin";
import type { DecisionLog } from "@/hooks/useDecisionLogsForJob";

export type StateHealth = "valid" | "waiting" | "warning" | "stuck" | "complete";

export interface FlowSupervisorResult {
  currentStatus: string;
  stateHealth: StateHealth;
  why: string;
  nextValidAction: string;
  recommendedOperatorAction: string;
  evidenceSummary: string;
}

function latestEventSummary(events: JobEvent[] | undefined): string {
  if (!events || events.length === 0) return "No events recorded.";
  const e = events[0];
  const ts = new Date(e.created_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return `Last event: ${e.event_type} (${e.event_category}) at ${ts}${e.message ? ` — ${e.message}` : ""}`;
}

function latestDecisionSummary(logs: DecisionLog[] | undefined): string {
  if (!logs || logs.length === 0) return "";
  const d = logs[0];
  return `Last decision: ${d.decision_type ?? "unknown"} → ${d.decision_outcome ?? "—"}`;
}

function evaluateRules(
  job: Job,
  offers: DispatchOffer[] | undefined,
  events: JobEvent[] | undefined,
  _decisionLogs: DecisionLog[] | undefined,
): Omit<FlowSupervisorResult, "evidenceSummary"> {
  const s = job.job_status;
  const now = Date.now();

  // Terminal states
  if (s === "job_completed") {
    return { currentStatus: s, stateHealth: "complete", why: "Job has been completed.", nextValidAction: "None", recommendedOperatorAction: "No further action required." };
  }
  if (s === "cancelled_by_customer" || s === "cancelled_after_dispatch") {
    return { currentStatus: s, stateHealth: "complete", why: `Job was cancelled (${s}).`, nextValidAction: "None", recommendedOperatorAction: "No further action required." };
  }

  // Stuck / reassignment states
  if (s === "driver_unavailable" || s === "reassignment_required") {
    return { currentStatus: s, stateHealth: "stuck", why: `Driver is unavailable or reassignment is required.`, nextValidAction: "Reassign driver or restart dispatch", recommendedOperatorAction: "Reassign to a new driver or restart the dispatch process." };
  }
  if (s === "job_amended" || s === "customer_reapproval_pending") {
    return { currentStatus: s, stateHealth: "waiting", why: "Job has been amended. Waiting for customer re-approval.", nextValidAction: "Wait for customer response", recommendedOperatorAction: "Monitor for customer re-approval." };
  }

  // Intake / early states
  if (s === "intake_started") {
    return { currentStatus: s, stateHealth: "waiting", why: "Customer is completing intake.", nextValidAction: "Wait for intake completion", recommendedOperatorAction: "No action needed — customer is still providing details." };
  }
  if (s === "intake_completed") {
    return { currentStatus: s, stateHealth: "waiting", why: "Intake complete. Awaiting validation or dispatch readiness.", nextValidAction: "Wait for validation processing", recommendedOperatorAction: "Monitor — system should advance to validation or dispatch." };
  }
  if (s === "validation_required") {
    return { currentStatus: s, stateHealth: "waiting", why: "Job requires validation before dispatch.", nextValidAction: "Complete validation", recommendedOperatorAction: "Review and validate job details." };
  }

  // Payment states
  if (s === "payment_authorization_required") {
    return { currentStatus: s, stateHealth: "waiting", why: "Waiting for customer to authorize payment.", nextValidAction: "Wait for payment authorization", recommendedOperatorAction: "Monitor payment status. Use DEV bypass in test mode if needed." };
  }
  if (s === "payment_failed") {
    return { currentStatus: s, stateHealth: "stuck", why: "Payment authorization failed.", nextValidAction: "Retry payment or contact customer", recommendedOperatorAction: "Contact customer about payment failure or retry." };
  }
  if (s === "payment_authorized") {
    return { currentStatus: s, stateHealth: "valid", why: "Payment authorized. Ready to proceed.", nextValidAction: "Proceed to dispatch", recommendedOperatorAction: "Job should advance to dispatch. Monitor for status transition." };
  }

  // Ready for dispatch — tightened rules
  if (s === "ready_for_dispatch") {
    const missingFields: string[] = [];
    if (job.gps_lat == null || job.gps_long == null) missingFields.push("GPS coordinates");
    if (!job.incident_type_id) missingFields.push("incident type");
    if (job.assigned_driver_id) missingFields.push("driver already assigned (unexpected)");

    if (missingFields.length > 0) {
      return {
        currentStatus: s,
        stateHealth: "warning",
        why: `Missing required data: ${missingFields.join(", ")}.`,
        nextValidAction: "Resolve missing fields before matching",
        recommendedOperatorAction: `Verify and fix: ${missingFields.join(", ")}. Do not match drivers until resolved.`,
      };
    }
    return { currentStatus: s, stateHealth: "valid", why: "Job is ready for dispatch with all required fields present.", nextValidAction: "Match Drivers", recommendedOperatorAction: "Click 'Match Drivers' to find eligible drivers." };
  }

  // Dispatch recommendation ready
  if (s === "dispatch_recommendation_ready") {
    return { currentStatus: s, stateHealth: "valid", why: "Driver matching complete. Recommendation ready.", nextValidAction: "Start Dispatch", recommendedOperatorAction: "Click 'Start Dispatch' to send offers to matched drivers." };
  }

  // Driver offer prepared (pre-send)
  if (s === "driver_offer_prepared") {
    return { currentStatus: s, stateHealth: "valid", why: "Offer prepared but not yet sent.", nextValidAction: "Send driver offer", recommendedOperatorAction: "Send the prepared offer to the driver." };
  }

  // Driver offer sent — check offer state
  if (s === "driver_offer_sent") {
    const activeOffers = (offers ?? []).filter((o) => o.offer_status === "pending");
    const hasActivePending = activeOffers.some((o) => {
      if (!o.expires_at) return true;
      return new Date(o.expires_at).getTime() > now;
    });

    if (hasActivePending) {
      return { currentStatus: s, stateHealth: "waiting", why: `${activeOffers.length} pending offer(s) awaiting driver response.`, nextValidAction: "Wait for driver response", recommendedOperatorAction: "Monitor — driver has an active offer." };
    }

    // Check if all offers expired or declined
    const allOffers = offers ?? [];
    const expiredOrDeclined = allOffers.filter((o) => o.offer_status === "expired" || o.offer_status === "declined");
    const latestEvent = events?.[0];
    const eventContext = latestEvent ? ` Last event: ${latestEvent.event_type}${latestEvent.reason ? ` (${latestEvent.reason})` : ""}.` : "";

    return {
      currentStatus: s,
      stateHealth: "stuck",
      why: `No active pending offers. ${expiredOrDeclined.length} expired/declined.${eventContext}`,
      nextValidAction: "Retry dispatch or create new offer",
      recommendedOperatorAction: "All offers exhausted. Retry dispatch with new drivers or manually create a new offer.",
    };
  }

  // Service lifecycle
  if (s === "driver_assigned") {
    return { currentStatus: s, stateHealth: "valid", why: "Driver assigned. Awaiting en-route status.", nextValidAction: "Monitor driver movement", recommendedOperatorAction: "Driver should begin en-route shortly. Monitor for status update." };
  }
  if (s === "driver_enroute") {
    return { currentStatus: s, stateHealth: "valid", why: "Driver is en route to pickup location.", nextValidAction: "Monitor ETA", recommendedOperatorAction: "Track driver progress. ETA: " + (job.eta_minutes ? `${job.eta_minutes} min` : "unknown") + "." };
  }
  if (s === "driver_arrived") {
    return { currentStatus: s, stateHealth: "valid", why: "Driver has arrived at the scene.", nextValidAction: "Begin service", recommendedOperatorAction: "Service should begin shortly." };
  }
  if (s === "service_in_progress") {
    return { currentStatus: s, stateHealth: "valid", why: "Service is in progress.", nextValidAction: "Wait for service completion", recommendedOperatorAction: "Monitor — service is underway." };
  }
  if (s === "vehicle_loaded") {
    return { currentStatus: s, stateHealth: "valid", why: "Vehicle has been loaded.", nextValidAction: "Proceed to completion", recommendedOperatorAction: "Awaiting completion confirmation." };
  }
  if (s === "pending_completion_approval") {
    return { currentStatus: s, stateHealth: "waiting", why: "Awaiting customer confirmation to complete job.", nextValidAction: "Wait for customer confirmation", recommendedOperatorAction: "Customer must confirm job completion." };
  }

  // Fallback
  return { currentStatus: s, stateHealth: "warning", why: `Unrecognized state: ${s}.`, nextValidAction: "Investigate", recommendedOperatorAction: "Review job status manually — state not covered by supervisor rules." };
}

export function useFlowSupervisor(
  job: Job | null,
  offers: DispatchOffer[] | undefined,
  events: JobEvent[] | undefined,
  decisionLogs: DecisionLog[] | undefined,
): FlowSupervisorResult | null {
  return useMemo(() => {
    if (!job) return null;
    const result = evaluateRules(job, offers, events, decisionLogs);
    const parts = [latestEventSummary(events as JobEvent[] | undefined)];
    const decisionPart = latestDecisionSummary(decisionLogs);
    if (decisionPart) parts.push(decisionPart);
    if (offers && offers.length > 0) {
      const pending = offers.filter((o) => o.offer_status === "pending").length;
      const accepted = offers.filter((o) => o.offer_status === "accepted").length;
      const declined = offers.filter((o) => o.offer_status === "declined").length;
      const expired = offers.filter((o) => o.offer_status === "expired").length;
      parts.push(`Offers: ${offers.length} total (${pending} pending, ${accepted} accepted, ${declined} declined, ${expired} expired)`);
    }
    return { ...result, evidenceSummary: parts.join(" · ") };
  }, [job, offers, events, decisionLogs]);
}
