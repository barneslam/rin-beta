import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { useDrivers, useTrucks, useTruckTypes } from "@/hooks/useReferenceData";

const DriverMatching = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: drivers } = useDrivers();
  const { data: trucks } = useTrucks();
  const { data: truckTypes } = useTruckTypes();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  // Simple filter: show drivers with matching truck type and available status
  const matchingTrucks = trucks?.filter(
    (t) => t.truck_type_id === job.required_truck_type_id && t.status === "available"
  ) || [];
  const matchingDriverIds = new Set(matchingTrucks.map((t) => t.driver_id));
  const matchingDrivers = drivers?.filter(
    (d) => matchingDriverIds.has(d.driver_id) && d.availability_status === "available"
  ) || [];

  const getTruckTypeName = (id: string) => truckTypes?.find((t) => t.truck_type_id === id)?.name || "—";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 5 — Driver Matching</h1>
        <p className="text-sm text-muted-foreground">
          Available drivers matching job requirements. Ranking engine will plug in here.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Matching Drivers ({matchingDrivers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {matchingDrivers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No available drivers match the requirements.</p>
          ) : (
            <div className="space-y-3">
              {matchingDrivers.map((driver) => {
                const truck = matchingTrucks.find((t) => t.driver_id === driver.driver_id);
                return (
                  <div key={driver.driver_id} className="flex items-center justify-between rounded border p-3">
                    <div>
                      <p className="font-medium text-sm">{driver.driver_name}</p>
                      <p className="text-xs text-muted-foreground">{driver.company_name}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <p className="text-muted-foreground">Rating</p>
                        <p className="font-medium">⭐ {Number(driver.rating).toFixed(1)} ({driver.review_count})</p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">Reliability</p>
                        <p className="font-mono font-medium">{Number(driver.reliability_score).toFixed(0)}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">Radius</p>
                        <p className="font-mono">{Number(driver.service_radius_km).toFixed(0)} km</p>
                      </div>
                      {truck && (
                        <Badge variant="secondary" className="text-xs">
                          {getTruckTypeName(truck.truck_type_id)}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed border-2">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground text-sm">🔌 Driver Ranking Engine will plug in here.</p>
          <p className="text-xs text-muted-foreground mt-1">
            This module will rank drivers by proximity, rating, reliability, ETA, and equipment match.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DriverMatching;
