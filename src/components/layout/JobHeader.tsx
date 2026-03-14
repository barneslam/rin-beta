import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { Badge } from "@/components/ui/badge";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/types/rin";

export function JobHeader() {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);

  if (!job) {
    return (
      <div className="border-b bg-card px-6 py-3">
        <p className="text-sm text-muted-foreground">No active job selected. Create or select a job from Incident Intake.</p>
      </div>
    );
  }

  return (
    <div className="border-b bg-card px-6 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Job ID</span>
            <p className="font-mono text-xs font-medium">{job.job_id.slice(0, 8)}</p>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Vehicle</span>
            <p className="text-sm font-medium">
              {job.vehicle_year} {job.vehicle_make} {job.vehicle_model}
            </p>
          </div>
          {job.pickup_location && (
            <>
              <div className="h-8 w-px bg-border" />
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Location</span>
                <p className="text-sm">{job.pickup_location}</p>
              </div>
            </>
          )}
        </div>
        <Badge className={JOB_STATUS_COLORS[job.job_status]}>
          {JOB_STATUS_LABELS[job.job_status]}
        </Badge>
      </div>
    </div>
  );
}
