import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useActiveJob } from "@/context/JobContext";
import { useJob, useUpdateJob } from "@/hooks/useJobs";
import { useIncidentTypes } from "@/hooks/useReferenceData";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { validateJobForDispatch } from "@/lib/dispatchEngine";
import { CheckCircle2, XCircle, Info, AlertTriangle } from "lucide-react";

const REQUIRED_FIELD_LABELS: Record<string, string> = {
  incident_type_id: "Incident Type",
  can_vehicle_roll: "Can Vehicle Roll",
  location: "Location (GPS or address)",
};

const SOFT_FIELD_LABELS: Record<string, string> = {
  vehicle_make: "Vehicle Make",
  vehicle_model: "Vehicle Model",
  vehicle_year: "Vehicle Year",
  location_type: "Location Type",
};

const LOCATION_TYPES = [
  { value: "roadside", label: "Roadside" },
  { value: "highway", label: "Highway" },
  { value: "residential", label: "Residential" },
  { value: "parking_lot", label: "Parking Lot" },
  { value: "underground", label: "Underground" },
  { value: "rural", label: "Rural" },
];

const IncidentValidation = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const updateJob = useUpdateJob();
  const { data: incidentTypes } = useIncidentTypes();

  const [form, setForm] = useState({
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: "",
    pickup_location: "",
  });
  const [pendingOverrideConfirm, setPendingOverrideConfirm] = useState(false);

  // Sync local form from job only when the active job changes
  useEffect(() => {
    if (job) {
      setForm({
        vehicle_make: job.vehicle_make ?? "",
        vehicle_model: job.vehicle_model ?? "",
        vehicle_year: job.vehicle_year != null ? String(job.vehicle_year) : "",
        pickup_location: job.pickup_location ?? "",
      });
    }
  }, [job?.job_id]);

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const validation = validateJobForDispatch(job);

  const save = (updates: Record<string, unknown>) =>
    updateJob.mutate({ jobId: job.job_id, updates, eventSource: "validation_screen" });

  const handleConfirm = async (force = false) => {
    // Guard: job is still waiting on customer confirmation and customer hasn't confirmed
    if (!force && (job as any).job_status === "pending_customer_confirmation" && !(job as any).sms_confirmed) {
      setPendingOverrideConfirm(true);
      return;
    }
    setPendingOverrideConfirm(false);
    try {
      await updateJob.mutateAsync({
        jobId: job.job_id,
        updates: {
          job_status: "ready_for_dispatch",
          ...(job.location_type ? {} : { location_type: "roadside" }),
        },
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
        <p className="text-sm text-muted-foreground">Review and complete incident details before dispatch.</p>
      </div>

      {/* Validation Status */}
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
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Required for dispatch</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(REQUIRED_FIELD_LABELS).map(([field, label]) => {
                const present = validation.presentFields.includes(field);
                return (
                  <div key={field} className="flex items-center gap-2 text-sm py-1">
                    {present ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <span className={present ? "text-foreground" : "text-destructive font-medium"}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Informational (recommended)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(SOFT_FIELD_LABELS).map(([field, label]) => {
                const present = validation.presentFields.includes(field);
                return (
                  <div key={field} className="flex items-center gap-2 text-sm py-1">
                    {present ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className={present ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Incident Type — required */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-1">
              Incident Type
              {!job.incident_type_id && <XCircle className="h-4 w-4 text-destructive ml-1" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={job.incident_type_id ?? ""}
              onValueChange={(v) => save({ incident_type_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select incident type..." />
              </SelectTrigger>
              <SelectContent>
                {incidentTypes?.map((t) => (
                  <SelectItem key={t.incident_type_id} value={t.incident_type_id}>
                    {t.incident_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Vehicle — editable inputs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Make</Label>
                <Input
                  value={form.vehicle_make}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_make: e.target.value }))}
                  onBlur={(e) => save({ vehicle_make: e.target.value || null })}
                  placeholder="Toyota"
                />
              </div>
              <div>
                <Label className="text-xs">Model</Label>
                <Input
                  value={form.vehicle_model}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_model: e.target.value }))}
                  onBlur={(e) => save({ vehicle_model: e.target.value || null })}
                  placeholder="Camry"
                />
              </div>
              <div>
                <Label className="text-xs">Year</Label>
                <Input
                  value={form.vehicle_year}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_year: e.target.value }))}
                  onBlur={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    save({ vehicle_year: val });
                  }}
                  placeholder="2021"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch
                checked={job.can_vehicle_roll ?? false}
                onCheckedChange={(v) => save({ can_vehicle_roll: v })}
              />
              <Label className="text-xs">Can vehicle roll?</Label>
              {job.can_vehicle_roll == null && (
                <span className="text-xs text-destructive font-medium">(required)</span>
              )}
            </div>
            <div>
              <Label className="text-xs">Condition Notes</Label>
              <Input
                defaultValue={job.vehicle_condition || ""}
                onBlur={(e) => save({ vehicle_condition: e.target.value })}
                placeholder="Describe damage or condition..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Location */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Address / Description</Label>
              <Input
                value={form.pickup_location}
                onChange={(e) => setForm((f) => ({ ...f, pickup_location: e.target.value }))}
                onBlur={(e) => save({ pickup_location: e.target.value || null })}
                placeholder="123 Main St, Toronto"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">GPS Latitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  defaultValue={job.gps_lat ?? ""}
                  placeholder="43.6532"
                  onBlur={(e) => {
                    const val = e.target.value ? parseFloat(e.target.value) : null;
                    save({ gps_lat: val });
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">GPS Longitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  defaultValue={job.gps_long ?? ""}
                  placeholder="-79.3832"
                  onBlur={(e) => {
                    const val = e.target.value ? parseFloat(e.target.value) : null;
                    save({ gps_long: val });
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Location Type</Label>
                <Select
                  value={job.location_type || "roadside"}
                  onValueChange={(v) => save({ location_type: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOCATION_TYPES.map((lt) => (
                      <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {pendingOverrideConfirm && (
        <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Customer has not confirmed</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    This job is still pending customer confirmation and the customer has not yet confirmed via the SMS link.
                    Overriding will bypass customer confirmation and move the job to ready for dispatch.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleConfirm(true)}
                    disabled={updateJob.isPending}
                  >
                    Override — dispatch without customer confirmation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPendingOverrideConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 items-center">
        <Button
          onClick={() => handleConfirm(false)}
          disabled={!validation.valid || updateJob.isPending}
        >
          Confirm &amp; Ready for Dispatch
        </Button>
        {!validation.valid && (
          <p className="text-xs text-muted-foreground">
            Complete required fields above before confirming.
          </p>
        )}
      </div>
    </div>
  );
};

export default IncidentValidation;
