import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useActiveJob } from "@/context/JobContext";
import { useDispatchRecommendation } from "@/hooks/useDispatchEngine";
import { toast } from "sonner";

const DispatchDecision = () => {
  const { activeJobId } = useActiveJob();
  const {
    job,
    validationResult,
    classification,
    eligibleTrucks,
    rankedDrivers,
    truckTypes,
    equipment,
    isLoading,
  } = useDispatchRecommendation(activeJobId);
  const navigate = useNavigate();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const requiredTruckType = truckTypes.find((t) => t.truck_type_id === job.required_truck_type_id);
  const classifiedTruckType = classification?.truckTypeId
    ? truckTypes.find((t) => t.truck_type_id === classification.truckTypeId)
    : null;

  const requiredEquipIds = classification?.requiredEquipment || [];
  const requiredEquipNames = equipment
    .filter((e) => requiredEquipIds.includes(e.equipment_id))
    .map((e) => e.name);

  const complexityLabels: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High", 4: "Critical" };

  const handleRunRecommendation = () => {
    // dispatch_recommendation_ready has no gating function downstream — navigate directly
    toast.success("Dispatch recommendation ready");
    navigate("/matching");
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 3 — Dispatch Decision</h1>
        <p className="text-sm text-muted-foreground">
          Review incident classification and dispatch readiness.
        </p>
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
            <CardTitle className="text-base">Incident Classification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {classification ? (
              <>
                <div>
                  <span className="text-muted-foreground text-xs">Required Truck Type</span>
                  <p className="font-medium">{classifiedTruckType?.name || requiredTruckType?.name || "Not set"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Complexity</span>
                  <p className="font-medium">{complexityLabels[classification.complexityLevel] || `Level ${classification.complexityLevel}`}</p>
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
              </>
            ) : (
              <p className="text-muted-foreground text-xs">No incident type selected on this job.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dispatch Readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Validation:</span>{" "}
              {validationResult?.valid ? (
                <Badge className="bg-success/15 text-success">Passed</Badge>
              ) : (
                <Badge className="bg-destructive/10 text-destructive">
                  {validationResult?.missingFields.length ?? 0} fields missing
                </Badge>
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Eligible Trucks:</span>{" "}
              <span className="font-mono font-medium">{eligibleTrucks.length}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Eligible Drivers:</span>{" "}
              <span className="font-mono font-medium">{rankedDrivers.length}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6 flex flex-col items-center justify-center gap-3">
            <Button
              onClick={handleRunRecommendation}
              disabled={!validationResult?.valid || isLoading}
              className="w-full"
            >
              Run Dispatch Recommendation
            </Button>
            {!validationResult?.valid && (
              <p className="text-xs text-muted-foreground text-center">
                Job must pass validation before running dispatch.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DispatchDecision;
