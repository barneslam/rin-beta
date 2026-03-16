import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { JOB_STATUS_LABELS } from "@/types/rin";
import { Loader2, CheckCircle2, Truck, MapPin, Clock, User, CreditCard, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CUSTOMER_STEPS = [
  { key: "requested", label: "Help Requested", statuses: ["intake_started", "intake_completed", "validation_required"] },
  {
    key: "finding",
    label: "Finding a Driver",
    statuses: [
      "ready_for_dispatch",
      "dispatch_recommendation_ready",
      "driver_offer_prepared",
      "driver_offer_sent",
      "reassignment_required",
      "driver_unavailable",
      "job_amended",
      "customer_reapproval_pending",
    ],
  },
  {
    key: "payment",
    label: "Authorize Payment",
    statuses: ["payment_authorization_required", "payment_failed", "driver_assigned"],
  },
  { key: "enroute", label: "Driver On the Way", statuses: ["driver_enroute"] },
  { key: "arrived", label: "Driver Arrived", statuses: ["driver_arrived", "vehicle_loaded"] },
  { key: "done", label: "Complete", statuses: ["job_completed"] },
];

const REASSIGNMENT_STATUSES = new Set([
  "reassignment_required",
  "driver_unavailable",
  "job_amended",
  "customer_reapproval_pending",
]);

function getActiveStep(status: string): number {
  const idx = CUSTOMER_STEPS.findIndex((s) => s.statuses.includes(status));
  return idx >= 0 ? idx : 0;
}

export default function CustomerTracking() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const { data: job, isLoading } = useQuery({
    queryKey: ["jobs", jobId],
    enabled: !!jobId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: assignedDriver } = useQuery({
    queryKey: ["driver", job?.assigned_driver_id],
    enabled: !!job?.assigned_driver_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("driver_name, phone")
        .eq("driver_id", job!.assigned_driver_id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-sidebar-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-sidebar-background flex flex-col items-center justify-center px-6 text-center">
        <p className="text-lg text-sidebar-foreground font-semibold mb-2">Job not found</p>
        <button onClick={() => navigate("/")} className="text-primary text-sm hover:underline">
          Back to home
        </button>
      </div>
    );
  }

  const isCancelled = job.job_status.startsWith("cancelled");
  const activeStep = isCancelled ? -1 : getActiveStep(job.job_status);
  const isPaymentStep = job.job_status === "payment_authorization_required" || job.job_status === "payment_failed";

  return (
    <div className="min-h-screen bg-sidebar-background flex flex-col px-6 py-8">
      <div className="max-w-md mx-auto w-full space-y-8">
        {/* Status header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary/15 flex items-center justify-center">
            {isCancelled ? (
              <span className="text-2xl">✕</span>
            ) : isPaymentStep ? (
              <CreditCard className="w-7 h-7 text-primary" />
            ) : activeStep >= 3 ? (
              <Truck className="w-7 h-7 text-primary" />
            ) : (
              <Clock className="w-7 h-7 text-primary" />
            )}
          </div>
          <h1 className="text-xl font-semibold text-sidebar-foreground">
            {isCancelled
              ? "Request Cancelled"
              : isPaymentStep
              ? "Payment Authorization Required"
              : CUSTOMER_STEPS[activeStep]?.label || "Processing"}
          </h1>
          <p className="text-sm text-sidebar-accent-foreground/60">
            {isPaymentStep
              ? "Please authorize payment so your driver can begin service"
              : REASSIGNMENT_STATUSES.has(job.job_status)
              ? "We're securing the next available driver"
              : JOB_STATUS_LABELS[job.job_status] || job.job_status}
          </p>
        </div>

        {/* Payment action */}
        {isPaymentStep && (
          <div className="space-y-3">
            {job.job_status === "payment_failed" && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>Previous authorization failed. Please try again with a different card.</p>
              </div>
            )}
            <Button
              className="w-full"
              size="lg"
              onClick={() => navigate(`/pay/${job.job_id}`)}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              {job.job_status === "payment_failed" ? "Retry Payment" : "Complete Payment"}
            </Button>
          </div>
        )}

        {/* ETA */}
        {job.eta_minutes && !isCancelled && (
          <div className="bg-sidebar-accent rounded-2xl p-4 text-center">
            <p className="text-sm text-sidebar-accent-foreground/60">Estimated arrival</p>
            <p className="text-3xl font-bold text-sidebar-foreground">{job.eta_minutes} min</p>
          </div>
        )}

        {/* Progress stepper */}
        {!isCancelled && (
          <div className="space-y-0">
            {CUSTOMER_STEPS.map((step, i) => {
              const completed = i < activeStep;
              const active = i === activeStep;
              return (
                <div key={step.key} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        completed
                          ? "bg-primary text-primary-foreground"
                          : active
                          ? "bg-primary/20 border-2 border-primary text-primary"
                          : "bg-sidebar-border text-sidebar-accent-foreground/40"
                      }`}
                    >
                      {completed ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-xs font-medium">{i + 1}</span>}
                    </div>
                    {i < CUSTOMER_STEPS.length - 1 && (
                      <div className={`w-0.5 h-8 ${completed ? "bg-primary" : "bg-sidebar-border"}`} />
                    )}
                  </div>
                  <p className={`pt-1.5 text-sm ${active ? "font-semibold text-sidebar-foreground" : completed ? "text-sidebar-foreground" : "text-sidebar-accent-foreground/40"}`}>
                    {step.label}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Assigned driver */}
        {assignedDriver && (
          <div className="bg-sidebar-accent rounded-2xl p-4 flex items-start gap-3">
            <User className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-sidebar-accent-foreground/60">Your driver</p>
              <p className="text-sm text-sidebar-foreground font-medium">{assignedDriver.driver_name}</p>
              {assignedDriver.phone && (
                <p className="text-xs text-sidebar-accent-foreground/60 mt-0.5">{assignedDriver.phone}</p>
              )}
            </div>
          </div>
        )}

        {/* Location */}
        {job.pickup_location && (
          <div className="bg-sidebar-accent rounded-2xl p-4 flex items-start gap-3">
            <MapPin className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-sidebar-accent-foreground/60">Pickup location</p>
              <p className="text-sm text-sidebar-foreground">{job.pickup_location}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
