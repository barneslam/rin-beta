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
import { validateJobForDispatch } from "@/lib/dispatchEngine";
import { CheckCircle2, XCircle } from "lucide-react";

const FIELD_LABELS: Record<string, string> = {
  incident_type_id: "Incident Type",
  pickup_location: "Pickup Location",
  gps_lat: "GPS Latitude",
  gps_long: "GPS Longitude",
  vehicle_make: "Vehicle Make",
  vehicle_model: "Vehicle Model",
  vehicle_year: "Vehicle Year",
  can_vehicle_roll: "Can Vehicle Roll",
  location_type: "Location Type",
};

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

  const validation = validateJobForDispatch(job);

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

      {/* Validation Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Validation Status
            {validation.valid ? (
              <Badge className="bg-success/15 text-success">Ready</Badge>
            ) : (
              <Badge className="bg-destructive/10 text-destructive">{validation.missingFields.length} Missing</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(FIELD_LABELS).map(([field, label]) => {
              const present = validation.presentFields.includes(field);
              return (
                <div key={field} className="flex items-center gap-2 text-sm py-1">
                  {present ? (
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className={present ? "text-foreground" : "text-destructive font-medium"}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
        <Button
          onClick={handleConfirm}
          disabled={!validation.valid || updateJob.isPending}
        >
          Confirm &amp; Ready for Dispatch
        </Button>
        {!validation.valid && (
          <p className="text-xs text-muted-foreground self-center">
            Complete all required fields before confirming.
          </p>
        )}
      </div>
    </div>
  );
};

export default IncidentValidation;
