import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { useTruckTypes, useEquipment } from "@/hooks/useReferenceData";

const DispatchDecision = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: truckTypes } = useTruckTypes();
  const { data: equipment } = useEquipment();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const requiredTruckType = truckTypes?.find((t) => t.truck_type_id === job.required_truck_type_id);
  const requiredEquipIds = (job.required_equipment as string[]) || [];
  const requiredEquipNames = equipment?.filter((e) => requiredEquipIds.includes(e.equipment_id)).map((e) => e.name) || [];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 3 — Dispatch Decision</h1>
        <p className="text-sm text-muted-foreground">Review requirements before dispatch. Decision engine logic will plug in here.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Job Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{job.job_status}</Badge></p>
            <p><span className="text-muted-foreground">Vehicle:</span> {job.vehicle_year} {job.vehicle_make} {job.vehicle_model}</p>
            <p><span className="text-muted-foreground">Can Roll:</span> {job.can_vehicle_roll ? "Yes" : "No"}</p>
            <p><span className="text-muted-foreground">Location Type:</span> {job.location_type || "—"}</p>
            <p><span className="text-muted-foreground">Condition:</span> {job.vehicle_condition || "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dispatch Requirements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Required Truck Type</span>
              <p className="font-medium">{requiredTruckType?.name || "Not set"}</p>
              {requiredTruckType?.description && (
                <p className="text-xs text-muted-foreground">{requiredTruckType.description}</p>
              )}
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Required Equipment</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {requiredEquipNames.length > 0 ? (
                  requiredEquipNames.map((name) => (
                    <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">None specified</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-dashed border-2">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">
              🔌 Dispatch Decision Engine will plug in here.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This module will analyze job requirements, driver availability, and optimal routing to make dispatch decisions.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DispatchDecision;
