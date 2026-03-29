import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveJob } from "@/context/JobContext";
import { useDispatchRecommendation, useAutoDispatchOffer } from "@/hooks/useDispatchEngine";
import { useDrivers, useTrucks, useIncidentTypes, useTruckTypes } from "@/hooks/useReferenceData";
import { toast } from "sonner";
import { AlertTriangle, Zap, Search, Lock } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";

const DriverMatching = () => {
  const { activeJobId } = useActiveJob();
  const { job, rankedDrivers, eligibleTrucks, eligibleDrivers, classification, truckTypes, isLoading } = useDispatchRecommendation(activeJobId);
  const autoDispatch = useAutoDispatchOffer();
  const { data: drivers } = useDrivers();
  const { data: trucks } = useTrucks();
  const { data: incidentTypes } = useIncidentTypes();
  const { data: truckTypesData } = useTruckTypes();
  const navigate = useNavigate();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const pricingStatuses = ["pending_pricing", "pending_customer_price_approval", "payment_authorization_required"];
  const needsPricing = pricingStatuses.includes(job.job_status as string);
  if (needsPricing || (job.job_status !== "ready_for_dispatch" && job.job_status !== "driver_offer_sent" && job.job_status !== "no_driver_candidates")) {
    return (
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl font-bold">Step 5 — Driver Matching</h1>
        </div>
        <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="py-6 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-amber-900 dark:text-amber-200">Pricing must be completed first</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Job status: <span className="font-mono">{job.job_status}</span>
                <br />
                The price must be set and authorized by the customer before dispatch can begin.
              </p>
              <Button size="sm" variant="outline" className="mt-3" asChild>
                <Link to="/pricing">Go to Pricing</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getTruckTypeName = (id: string | null) =>
    truckTypes.find((t) => t.truck_type_id === id)?.name || "—";

  const handleStartAutoDispatch = async () => {
    if (!drivers || !trucks || !incidentTypes || !truckTypesData) {
      toast.error("Reference data not loaded yet");
      return;
    }
    try {
      const result = await autoDispatch.mutateAsync({
        jobId: job.job_id,
        drivers,
        trucks,
        incidentTypes,
        truckTypes: truckTypesData,
      });
      if (result.escalated) {
        toast.error("No eligible drivers found. Job moved to Exception Queue.");
        navigate("/control-panel");
      } else {
        toast.success(`Offer sent to ${result.driverName} (Wave ${result.wave})`);
        navigate("/offer");
      }
    } catch {
      toast.error("Failed to start automatic dispatch");
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Step 5 — Driver Matching</h1>
          <p className="text-sm text-muted-foreground">
            Ranked drivers based on ETA, distance, capability, reliability, and fairness.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => navigate(`/diagnostics/${job.job_id}`)}
        >
          <Search className="h-4 w-4" />
          View Diagnostics
        </Button>
      </div>

      {rankedDrivers.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Automatic Dispatch Ready</p>
              <p className="text-xs text-muted-foreground">
                {rankedDrivers.length} eligible drivers found. System will automatically route offers through up to 10 drivers in two waves.
              </p>
            </div>
            <Button
              onClick={handleStartAutoDispatch}
              disabled={autoDispatch.isPending}
              className="gap-2"
            >
              <Zap className="h-4 w-4" />
              {autoDispatch.isPending ? "Sending…" : "Start Automatic Dispatch"}
            </Button>
          </CardContent>
        </Card>
      )}

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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-3">#</th>
                    <th className="text-left py-2 pr-3">Driver</th>
                    <th className="text-right py-2 px-2">ETA</th>
                    <th className="text-right py-2 px-2">Dist</th>
                    <th className="text-right py-2 px-2">Cap</th>
                    <th className="text-right py-2 px-2">Rel</th>
                    <th className="text-right py-2 px-2">Fair</th>
                    <th className="text-right py-2 px-2 font-bold">Score</th>
                    <th className="text-right py-2 px-2">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedDrivers.map(({ driver, truck, distanceKm, etaMinutes, scoreBreakdown }, index) => (
                    <tr key={driver.driver_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{index + 1}</td>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{driver.driver_name}</p>
                        <p className="text-xs text-muted-foreground">{driver.company_name}</p>
                      </td>
                      <td className="text-right py-2 px-2 font-mono">{(scoreBreakdown.etaScore * 100).toFixed(0)}</td>
                      <td className="text-right py-2 px-2 font-mono">{(scoreBreakdown.distanceScore * 100).toFixed(0)}</td>
                      <td className="text-right py-2 px-2 font-mono">{(scoreBreakdown.capabilityScore * 100).toFixed(0)}</td>
                      <td className="text-right py-2 px-2 font-mono">{(scoreBreakdown.reliabilityScore * 100).toFixed(0)}</td>
                      <td className="text-right py-2 px-2 font-mono">{(scoreBreakdown.fairnessScore * 100).toFixed(0)}</td>
                      <td className="text-right py-2 px-2 font-mono font-bold text-primary">
                        {(scoreBreakdown.totalScore * 100).toFixed(0)}
                      </td>
                      <td className="text-right py-2 px-2">
                        <div className="flex items-center justify-end gap-3 text-xs">
                          <span className="font-mono">{etaMinutes}min</span>
                          <span className="font-mono">{distanceKm.toFixed(1)}km</span>
                          <Badge variant="secondary" className="text-xs">
                            {getTruckTypeName(truck.truck_type_id)}
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DriverMatching;
