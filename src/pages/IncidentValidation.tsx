import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useActiveJob } from "@/context/JobContext";
import { useJob, useUpdateJob } from "@/hooks/useJobs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const IncidentValidation = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const updateJob = useUpdateJob();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const handleValidate = async () => {
    try {
      await updateJob.mutateAsync({
        jobId: job.job_id,
        updates: { job_status: "validation_required" },
        eventSource: "validation_screen",
      });
      toast.success("Job marked for validation");
    } catch {
      toast.error("Failed to update job");
    }
  };

  const handleConfirm = async () => {
    try {
      await updateJob.mutateAsync({
        jobId: job.job_id,
        updates: { job_status: "ready_for_dispatch" },
        eventSource: "validation_screen",
      });
      toast.success("Validation confirmed — ready for dispatch");
    } catch {
      toast.error("Failed to update");
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 2 — Incident Validation</h1>
        <p className="text-sm text-muted-foreground">Review and confirm incident details before dispatch.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vehicle Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Make:</span> {job.vehicle_make || "—"}</p>
            <p><span className="text-muted-foreground">Model:</span> {job.vehicle_model || "—"}</p>
            <p><span className="text-muted-foreground">Year:</span> {job.vehicle_year || "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vehicle Condition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Condition Notes</Label>
              <Input
                defaultValue={job.vehicle_condition || ""}
                onBlur={(e) =>
                  updateJob.mutate({ jobId: job.job_id, updates: { vehicle_condition: e.target.value }, eventSource: "validation_screen" })
                }
                placeholder="Describe damage or condition..."
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Can vehicle roll?</Label>
              <Switch
                checked={job.can_vehicle_roll ?? false}
                onCheckedChange={(v) =>
                  updateJob.mutate({ jobId: job.job_id, updates: { can_vehicle_roll: v }, eventSource: "validation_screen" })
                }
              />
            </div>
            <div>
              <Label className="text-xs">Location Type</Label>
              <Select
                value={job.location_type || ""}
                onValueChange={(v) =>
                  updateJob.mutate({ jobId: job.job_id, updates: { location_type: v }, eventSource: "validation_screen" })
                }
              >
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="highway">Highway</SelectItem>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="parking_lot">Parking Lot</SelectItem>
                  <SelectItem value="underground">Underground</SelectItem>
                  <SelectItem value="rural">Rural</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Address:</span> {job.pickup_location || "—"}</p>
            <p className="font-mono text-xs">
              <span className="text-muted-foreground">GPS:</span> {job.gps_lat}, {job.gps_long}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={handleValidate} disabled={updateJob.isPending}>
          Mark for Validation
        </Button>
        <Button onClick={handleConfirm} disabled={updateJob.isPending}>
          Confirm & Ready for Dispatch
        </Button>
      </div>
    </div>
  );
};

export default IncidentValidation;
