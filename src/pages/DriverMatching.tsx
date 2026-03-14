import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveJob } from "@/context/JobContext";
import { useDispatchRecommendation, useCreateDispatchOffer } from "@/hooks/useDispatchEngine";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

const DriverMatching = () => {
  const { activeJobId } = useActiveJob();
  const { job, rankedDrivers, truckTypes, isLoading } = useDispatchRecommendation(activeJobId);
  const createOffer = useCreateDispatchOffer();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const getTruckTypeName = (id: string) =>
    truckTypes.find((t) => t.truck_type_id === id)?.name || "—";

  const handlePrepareOffer = async (driverId: string, truckId: string) => {
    try {
      await createOffer.mutateAsync({
        jobId: job.job_id,
        driverId,
        truckId,
      });
      toast.success("Dispatch offer prepared");
    } catch {
      toast.error("Failed to prepare offer");
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 5 — Driver Matching</h1>
        <p className="text-sm text-muted-foreground">
          Ranked drivers based on proximity, rating, reliability, and availability.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Ranked Drivers ({rankedDrivers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : rankedDrivers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <AlertTriangle className="h-8 w-8 text-accent" />
              <p className="text-sm font-medium">No eligible drivers found</p>
              <p className="text-xs text-muted-foreground text-center max-w-sm">
                No drivers match the current job requirements. Check truck type availability, driver status, service radius, and reliability thresholds.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rankedDrivers.map(({ driver, truck, distanceKm, etaMinutes, score }, index) => (
                <div key={driver.driver_id} className="flex items-center justify-between rounded border p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground w-5">#{index + 1}</span>
                    <div>
                      <p className="font-medium text-sm">{driver.driver_name}</p>
                      <p className="text-xs text-muted-foreground">{driver.company_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-right">
                      <p className="text-muted-foreground">Score</p>
                      <p className="font-mono font-bold text-primary">{(score * 100).toFixed(0)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">ETA</p>
                      <p className="font-mono font-medium">{etaMinutes} min</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Distance</p>
                      <p className="font-mono">{distanceKm.toFixed(1)} km</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Rating</p>
                      <p className="font-medium">⭐ {Number(driver.rating).toFixed(1)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Reliability</p>
                      <p className="font-mono">{Number(driver.reliability_score).toFixed(0)}%</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {getTruckTypeName(truck.truck_type_id)}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePrepareOffer(driver.driver_id, truck.truck_id)}
                      disabled={createOffer.isPending}
                    >
                      Prepare Offer
                    </Button>
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

export default DriverMatching;
