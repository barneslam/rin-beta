import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveJob } from "@/context/JobContext";
import { useJob, useUpdateJob } from "@/hooks/useJobs";
import { useAuditLogs, useDrivers } from "@/hooks/useReferenceData";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/types/rin";
import type { JobStatus } from "@/types/rin";
import { toast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

const TRACKING_STAGES: JobStatus[] = [
  "driver_assigned",
  "driver_enroute",
  "driver_arrived",
  "vehicle_loaded",
  "job_completed",
];

const JobTracking = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: auditLogs } = useAuditLogs(activeJobId ?? undefined);
  const { data: drivers } = useDrivers();
  const updateJob = useUpdateJob();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const assignedDriver = drivers?.find((d) => d.driver_id === job.assigned_driver_id);
  const driverAssigned = !!job.assigned_driver_id;

  const currentStageIndex = TRACKING_STAGES.indexOf(job.job_status as JobStatus);
  const nextStage = currentStageIndex >= 0 && currentStageIndex < TRACKING_STAGES.length - 1
    ? TRACKING_STAGES[currentStageIndex + 1]
    : null;

  const handleAdvanceStatus = () => {
    if (!nextStage) return;
    updateJob.mutate(
      {
        jobId: job.job_id,
        updates: { job_status: nextStage },
        eventSource: "tracking_screen",
      },
      {
        onSuccess: () => {
          toast({ title: "Status Updated", description: `Job is now: ${JOB_STATUS_LABELS[nextStage]}` });
        },
      }
    );
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 7 — Job Tracking</h1>
        <p className="text-sm text-muted-foreground">Full job status and audit timeline.</p>
      </div>

      {!driverAssigned ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Tracking begins once a driver offer is accepted.</p>
            <p className="text-xs text-muted-foreground mt-1">Return to Step 6 to accept an offer.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Status</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge className={JOB_STATUS_COLORS[job.job_status] + " text-sm px-3 py-1"}>
                  {JOB_STATUS_LABELS[job.job_status]}
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
                  {job.eta_minutes ? `${job.eta_minutes} min` : "—"}
                </p>
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
                      {/* Connector line */}
                      {i < TRACKING_STAGES.length - 1 && (
                        <div
                          className={`absolute left-[-20px] top-6 w-px h-8 ${
                            isCompleted && i < currentStageIndex ? "bg-primary" : "bg-border"
                          }`}
                        />
                      )}
                      {/* Circle */}
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
                  disabled={updateJob.isPending}
                >
                  Advance to: {JOB_STATUS_LABELS[nextStage]}
                </Button>
              )}

              {job.job_status === "job_completed" && (
                <p className="mt-4 text-sm text-success font-medium">✅ Job completed.</p>
              )}
            </CardContent>
          </Card>
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
    </div>
  );
};

export default JobTracking;
