import { useState } from "react";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveJob } from "@/context/JobContext";
import { useJob, useUpdateJob } from "@/hooks/useJobs";
import { useAuditLogs, useDrivers } from "@/hooks/useReferenceData";
import { useDriverLocation } from "@/hooks/useDriverLocation";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/types/rin";
import type { JobStatus, Job } from "@/types/rin";
import { toast } from "@/hooks/use-toast";
import { Check, Edit, RefreshCw, UserX, XCircle, AlertTriangle, MapPin, Clock, WrenchIcon } from "lucide-react";
import { AmendJobDialog } from "@/components/dispatch/AmendJobDialog";
import { ReassignmentDialog } from "@/components/dispatch/ReassignmentDialog";
import { DriverUnavailableDialog } from "@/components/dispatch/DriverUnavailableDialog";
import { CancelJobDialog } from "@/components/dispatch/CancelJobDialog";
import { PAYMENT_WARNING_MINUTES, PAYMENT_EXPIRY_MINUTES } from "@/lib/paymentConstants";

const TRACKING_STAGES: JobStatus[] = [
  "payment_authorization_required",
  "payment_authorized",
  "driver_enroute",
  "driver_arrived",
  "service_in_progress",
  "pending_completion_approval",
  "job_completed",
];

const OPERATIONAL_CONTROL_STATUSES = [
  "payment_authorized", "driver_assigned", "driver_enroute", "driver_arrived", "service_in_progress",
];

const STALL_THRESHOLD_MS = 10 * 60 * 1000;

const JobTracking = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: auditLogs } = useAuditLogs(activeJobId ?? undefined);
  const { data: drivers } = useDrivers();
  const updateJob = useUpdateJob();

  const [amendOpen, setAmendOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [unavailableOpen, setUnavailableOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancellingAtScene, setCancellingAtScene] = useState(false);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);

  const handleDriverCancelAtScene = async () => {
    if (!job?.assigned_driver_id) return;
    setCancellingAtScene(true);
    try {
      const { data, error } = await supabase.functions.invoke("driver-cancel-at-scene", {
        body: {
          jobId: job.job_id,
          driverId: job.assigned_driver_id,
          driverName: assignedDriver?.driver_name ?? "Driver",
          reason: "Equipment failure — dispatcher triggered",
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: "Driver Cancelled", description: "Job moved to Driver Cancelled at Scene. Customer notified." });
      } else {
        toast({ title: "Error", description: data?.error || "Could not process cancellation", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCancellingAtScene(false);
    }
  };

  const isDriverActive = job && ["driver_enroute", "driver_arrived", "service_in_progress", "payment_authorized"].includes(job.job_status);
  const { driverLocation, distanceKm, etaMinutes } = useDriverLocation(
    isDriverActive ? activeJobId : null,
    job?.gps_lat ? Number(job.gps_lat) : null,
    job?.gps_long ? Number(job.gps_long) : null
  );

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const assignedDriver = drivers?.find((d) => d.driver_id === job.assigned_driver_id);
  const driverAssigned = !!job.assigned_driver_id;
  const showControls = OPERATIONAL_CONTROL_STATUSES.includes(job.job_status);

  const currentStageIndex = TRACKING_STAGES.indexOf(job.job_status as JobStatus);
  const nextStage = currentStageIndex >= 0 && currentStageIndex < TRACKING_STAGES.length - 1
    ? TRACKING_STAGES[currentStageIndex + 1]
    : null;

  // Stalled driver detection
  const isStalled = job.job_status === "payment_authorized" &&
    job.assigned_driver_id &&
    job.updated_at &&
    (Date.now() - new Date(job.updated_at).getTime()) > STALL_THRESHOLD_MS;

  // Payment timeout warning
  const paymentAgeMinutes = job.job_status === "payment_authorization_required" && job.updated_at
    ? Math.floor((Date.now() - new Date(job.updated_at).getTime()) / 60000)
    : 0;
  const isPaymentWarning = job.job_status === "payment_authorization_required" && paymentAgeMinutes >= PAYMENT_WARNING_MINUTES;

  const handleAdvanceStatus = async () => {
    if (!nextStage) return;

    // When advancing from pending_completion_approval → job_completed,
    // call complete-job Phase 2 so the driver gets their receipt SMS.
    if (job.job_status === "pending_completion_approval" && nextStage === "job_completed") {
      setConfirmingCompletion(true);
      try {
        const { data, error } = await supabase.functions.invoke("complete-job", {
          body: { jobId: job.job_id, confirmed: true },
        });
        if (error) throw error;
        if (data?.success) {
          toast({ title: "Job Completed", description: "Payment processed. Driver notified." });
        } else {
          toast({ title: "Error", description: data?.error || "Could not complete job", variant: "destructive" });
        }
      } catch (err) {
        toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
      } finally {
        setConfirmingCompletion(false);
      }
      return;
    }

    updateJob.mutate(
      { jobId: job.job_id, updates: { job_status: nextStage }, eventSource: "tracking_screen" },
      { onSuccess: () => { toast({ title: "Status Updated", description: `Job is now: ${JOB_STATUS_LABELS[nextStage]}` }); } }
    );
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 7 — Job Tracking</h1>
        <p className="text-sm text-muted-foreground">Full job status and audit timeline.</p>
      </div>

      {!driverAssigned && !["customer_reapproval_pending", "reassignment_required", "driver_unavailable", "cancelled_by_customer", "cancelled_after_dispatch", "payment_authorization_required", "payment_failed"].includes(job.job_status) ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Tracking begins once a driver offer is accepted.</p>
            <p className="text-xs text-muted-foreground mt-1">Return to Step 6 to accept an offer.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stalled driver warning */}
          {isStalled && (
            <Card className="border-destructive/50">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-sm font-medium">Driver Stalled — no movement to en route within 10 minutes</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Payment timeout warning */}
          {isPaymentWarning && (
            <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <Clock className="h-4 w-4" />
                  <p className="text-sm font-medium">
                    Payment pending for {paymentAgeMinutes} minutes — auto-expires at {PAYMENT_EXPIRY_MINUTES} min
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Driver cancelled at scene alert */}
          {job.job_status === "driver_cancelled_at_scene" && (
            <Card className="border-destructive/50">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-destructive">
                  <WrenchIcon className="h-4 w-4" />
                  <p className="text-sm font-medium">
                    Driver cancelled at scene — no compensation. Customer notified. Return to Driver Matching to reassign.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Payment failed warning */}
          {job.job_status === "payment_failed" && (
            <Card className="border-destructive/50">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-sm font-medium">
                    {job.authorization_status === "expired"
                      ? "Payment authorization expired — customer did not complete payment in time"
                      : "Payment authorization failed — awaiting customer retry"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Status</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge className={`${JOB_STATUS_COLORS[job.job_status] ?? "bg-muted text-muted-foreground"} text-sm px-3 py-1`}>
                  {JOB_STATUS_LABELS[job.job_status] ?? job.job_status}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Assigned Driver</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {assignedDriver ? (
                  <div>
                    <p className="font-medium">{assignedDriver.driver_name}</p>
                    <p className="text-xs text-muted-foreground">{assignedDriver.company_name}</p>
                    <p className="text-xs text-muted-foreground mt-1">📞 {assignedDriver.phone}</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No driver assigned</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">ETA</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold font-mono">
                  {etaMinutes ? `${etaMinutes} min` : job.eta_minutes ? `${job.eta_minutes} min` : "—"}
                </p>
                {distanceKm != null && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    <span>{distanceKm} km away</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Tracking Stepper */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tracking Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative pl-8 space-y-4">
                {TRACKING_STAGES.map((stage, i) => {
                  const isCompleted = currentStageIndex >= 0 && i <= currentStageIndex;
                  const isCurrent = i === currentStageIndex;

                  return (
                    <div key={stage} className="relative flex items-center gap-3">
                      {i < TRACKING_STAGES.length - 1 && (
                        <div
                          className={`absolute left-[-20px] top-6 w-px h-8 ${
                            isCompleted && i < currentStageIndex ? "bg-primary" : "bg-border"
                          }`}
                        />
                      )}
                      <div
                        className={`absolute left-[-24px] w-2.5 h-2.5 rounded-full border-2 flex items-center justify-center ${
                          isCompleted
                            ? "bg-primary border-primary"
                            : "bg-background border-muted-foreground/30"
                        }`}
                      >
                        {isCompleted && i < currentStageIndex && (
                          <Check className="w-2 h-2 text-primary-foreground" />
                        )}
                      </div>
                      <span
                        className={`text-sm ${
                          isCurrent ? "font-bold text-foreground" : isCompleted ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {JOB_STATUS_LABELS[stage]}
                      </span>
                      {isCurrent && (
                        <Badge variant="outline" className="text-[10px]">Current</Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              {nextStage && (
                <Button
                  className="mt-6"
                  size="sm"
                  onClick={handleAdvanceStatus}
                  disabled={updateJob.isPending || confirmingCompletion}
                >
                  {confirmingCompletion ? "Processing…" : `Advance to: ${JOB_STATUS_LABELS[nextStage]}`}
                </Button>
              )}

              {job.job_status === "job_completed" && (
                <p className="mt-4 text-sm text-success font-medium">✅ Job completed. Payment processed.</p>
              )}
            </CardContent>
          </Card>

          {/* Operational Controls */}
          {showControls && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Operational Controls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" size="sm" onClick={() => setAmendOpen(true)}>
                    <Edit className="h-4 w-4 mr-1.5" /> Amend Job
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setReassignOpen(true)}>
                    <RefreshCw className="h-4 w-4 mr-1.5" /> Request Reassignment
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setUnavailableOpen(true)}>
                    <UserX className="h-4 w-4 mr-1.5" /> Mark Driver Unavailable
                  </Button>
                  {["driver_arrived", "service_in_progress"].includes(job.job_status) && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDriverCancelAtScene}
                      disabled={cancellingAtScene}
                    >
                      <WrenchIcon className="h-4 w-4 mr-1.5" />
                      {cancellingAtScene ? "Processing…" : "Driver Unable to Complete"}
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>
                    <XCircle className="h-4 w-4 mr-1.5" /> Cancel Job
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Audit Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Audit Timeline ({auditLogs?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!auditLogs || auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No audit events yet.</p>
          ) : (
            <div className="relative pl-6 space-y-4">
              <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
              {auditLogs.map((log) => (
                <div key={log.log_id} className="relative">
                  <div className="absolute -left-[18px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <div className="rounded border p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {log.event_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{log.event_source}</span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{log.action_type}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AmendJobDialog open={amendOpen} onOpenChange={setAmendOpen} job={job as Job} />
      <ReassignmentDialog open={reassignOpen} onOpenChange={setReassignOpen} jobId={job.job_id} />
      <DriverUnavailableDialog open={unavailableOpen} onOpenChange={setUnavailableOpen} jobId={job.job_id} />
      <CancelJobDialog open={cancelOpen} onOpenChange={setCancelOpen} job={job as Job} />
    </div>
  );
};

export default JobTracking;
