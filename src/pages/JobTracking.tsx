import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { useAuditLogs, useDrivers } from "@/hooks/useReferenceData";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/types/rin";

const JobTracking = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: auditLogs } = useAuditLogs(activeJobId ?? undefined);
  const { data: drivers } = useDrivers();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const assignedDriver = drivers?.find((d) => d.driver_id === job.assigned_driver_id);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 7 — Job Tracking</h1>
        <p className="text-sm text-muted-foreground">Full job status and audit timeline.</p>
      </div>

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
