import { useActiveJob } from "@/context/JobContext";
import { useJob, useJobs } from "@/hooks/useJobs";
import { Badge } from "@/components/ui/badge";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/types/rin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function JobHeader() {
  const { activeJobId, setActiveJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: jobs } = useJobs();

  return (
    <div className="border-b bg-card px-6 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Select value={activeJobId ?? ""} onValueChange={(v) => setActiveJobId(v || null)}>
            <SelectTrigger className="w-[260px] h-8 text-xs">
              <SelectValue placeholder="Select a job…" />
            </SelectTrigger>
            <SelectContent>
              {jobs?.map((j) => (
                <SelectItem key={j.job_id} value={j.job_id} className="text-xs">
                  {j.job_id.slice(0, 8)} — {j.vehicle_make ?? "?"} {j.vehicle_model ?? ""} ({JOB_STATUS_LABELS[j.job_status]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {job && (
            <>
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
            </>
          )}
        </div>
        {job && (
          <Badge className={JOB_STATUS_COLORS[job.job_status]}>
            {JOB_STATUS_LABELS[job.job_status]}
          </Badge>
        )}
      </div>
    </div>
  );
}