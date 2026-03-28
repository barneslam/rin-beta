import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useJob } from "@/hooks/useJobs";
import { useDrivers, useTrucks, useIncidentTypes, useTruckTypes } from "@/hooks/useReferenceData";
import {
  validateJobForDispatch,
  classifyIncident,
  matchTruckCapability,
  filterEligibleDrivers,
  rankDrivers,
  haversineDistanceKm,
} from "@/lib/dispatchEngine";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { useQuery } from "@tanstack/react-query";
import type { Driver, Truck } from "@/types/rin";
import { useMemo } from "react";

function useDispatchOffers(jobId: string | undefined) {
  return useQuery({
    queryKey: ["dispatch_offers", jobId],
    queryFn: async () => {
      if (!jobId) return [];
      const { data } = await supabase
        .from("dispatch_offers")
        .select("*, drivers(driver_name)")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!jobId,
  });
}

function useRecentOfferCounts() {
  return useQuery({
    queryKey: ["recent_offer_counts"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("dispatch_offers")
        .select("driver_id")
        .gte("created_at", since);
      const counts = new Map<string, number>();
      (data ?? []).forEach((o) => {
        counts.set(o.driver_id, (counts.get(o.driver_id) || 0) + 1);
      });
      return counts;
    },
  });
}

export default function DispatchDiagnostics() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data: job } = useJob(jobId ?? null);
  const { data: drivers } = useDrivers();
  const { data: trucks } = useTrucks();
  const { data: incidentTypes } = useIncidentTypes();
  const { data: truckTypes } = useTruckTypes();
  const { data: offers } = useDispatchOffers(jobId);
  const { data: recentOfferCounts } = useRecentOfferCounts();

  const diagnostics = useMemo(() => {
    if (!job || !drivers || !trucks || !incidentTypes) return null;

    const validation = validateJobForDispatch(job);
    const classification = classifyIncident(job, incidentTypes);
    const effectiveJob =
      !job.required_truck_type_id && classification?.truckTypeId
        ? { ...job, required_truck_type_id: classification.truckTypeId }
        : job;

    const eligibleTrucks = matchTruckCapability(effectiveJob, trucks);
    const eligible = filterEligibleDrivers(effectiveJob, drivers, eligibleTrucks);
    const ranked = rankDrivers(eligible, effectiveJob, eligibleTrucks, {
      recentOfferCounts: recentOfferCounts ?? new Map(),
      requiredTruckTypeId: effectiveJob.required_truck_type_id ?? undefined,
    });

    // Build exclusion reasons for all drivers
    const eligibleTruckDriverIds = new Set(eligibleTrucks.map((t) => t.driver_id));
    const eligibleDriverIds = new Set(eligible.map((d) => d.driver_id));
    const hasJobCoords =
      job.gps_lat != null && job.gps_long != null;

    const driverAnalysis = drivers.map((d) => {
      const reasons: string[] = [];
      if (!eligibleTruckDriverIds.has(d.driver_id)) reasons.push("No matching truck");
      if (d.availability_status !== "available") reasons.push(`Status: ${d.availability_status}`);
      if ((d.reliability_score ?? 0) < 60) reasons.push("Low reliability");
      if (hasJobCoords && d.gps_lat != null && d.gps_long != null) {
        const dist = haversineDistanceKm(
          Number(d.gps_lat), Number(d.gps_long),
          Number(job.gps_lat), Number(job.gps_long)
        );
        if (dist > Number(d.service_radius_km ?? 0)) reasons.push(`Outside radius (${dist.toFixed(1)}km > ${d.service_radius_km}km)`);
      }
      return {
        driver: d,
        eligible: eligibleDriverIds.has(d.driver_id),
        reasons,
      };
    });

    return { validation, classification, eligibleTrucks, ranked, driverAnalysis };
  }, [job, drivers, trucks, incidentTypes, recentOfferCounts]);

  const getTypeName = (id: string | null) =>
    truckTypes?.find((t) => t.truck_type_id === id)?.name ?? "—";
  const getIncidentName = (id: string | null) =>
    incidentTypes?.find((t) => t.incident_type_id === id)?.incident_name ?? "—";

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Job not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Dispatch Diagnostics</h1>
        <p className="text-sm text-muted-foreground font-mono">
          Job {job.job_id.slice(0, 8)}
        </p>
      </div>

      {/* Job Requirements */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Job Requirements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Incident</p>
              <p className="font-medium">{getIncidentName(job.incident_type_id)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Truck Type</p>
              <p className="font-medium">{getTypeName(job.required_truck_type_id)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Location</p>
              <p className="font-medium">{job.pickup_location || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">GPS</p>
              <p className="font-mono text-xs">
                {job.gps_lat && job.gps_long
                  ? `${Number(job.gps_lat).toFixed(4)}, ${Number(job.gps_long).toFixed(4)}`
                  : "None"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Vehicle</p>
              <p className="font-medium">
                {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Drivable</p>
              <p className="font-medium">
                {job.can_vehicle_roll == null ? "—" : job.can_vehicle_roll ? "Yes" : "No"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Status</p>
              <Badge variant="secondary">{job.job_status}</Badge>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Validation</p>
              <Badge variant={diagnostics?.validation.valid ? "default" : "destructive"}>
                {diagnostics?.validation.valid ? "Valid" : `${diagnostics?.validation.missingFields.length} missing`}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* All Drivers with Filter Reasons */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Driver Eligibility ({diagnostics?.driverAnalysis.filter((d) => d.eligible).length ?? 0} / {diagnostics?.driverAnalysis.length ?? 0} eligible)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {diagnostics?.driverAnalysis.map(({ driver, eligible, reasons }) => (
              <div
                key={driver.driver_id}
                className={`flex items-center justify-between rounded border p-2 text-sm ${
                  eligible ? "border-primary/20 bg-primary/5" : "border-border opacity-60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Badge variant={eligible ? "default" : "secondary"} className="text-xs w-16 justify-center">
                    {eligible ? "Eligible" : "Excluded"}
                  </Badge>
                  <div>
                    <p className="font-medium">{driver.driver_name}</p>
                    <p className="text-xs text-muted-foreground">{driver.company_name}</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground text-right max-w-xs">
                  {reasons.length > 0 ? reasons.join(" · ") : "✓ All checks passed"}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Ranked Drivers with Score Breakdown */}
      {diagnostics && diagnostics.ranked.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Ranked Drivers ({diagnostics.ranked.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                    <th className="text-right py-2 px-2 font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.ranked.map(({ driver, truck, scoreBreakdown, distanceKm, etaMinutes }, i) => (
                    <tr key={driver.driver_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{driver.driver_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {getTypeName(truck.truck_type_id)} · {distanceKm.toFixed(1)}km · {etaMinutes}min
                        </p>
                      </td>
                      <td className="text-right py-2 px-2 font-mono">
                        {(scoreBreakdown.etaScore * 100).toFixed(0)}
                      </td>
                      <td className="text-right py-2 px-2 font-mono">
                        {(scoreBreakdown.distanceScore * 100).toFixed(0)}
                      </td>
                      <td className="text-right py-2 px-2 font-mono">
                        {(scoreBreakdown.capabilityScore * 100).toFixed(0)}
                      </td>
                      <td className="text-right py-2 px-2 font-mono">
                        {(scoreBreakdown.reliabilityScore * 100).toFixed(0)}
                      </td>
                      <td className="text-right py-2 px-2 font-mono">
                        {(scoreBreakdown.fairnessScore * 100).toFixed(0)}
                      </td>
                      <td className="text-right py-2 px-2 font-mono font-bold text-primary">
                        {(scoreBreakdown.totalScore * 100).toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Offer History */}
      {offers && offers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Offer History ({offers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {offers.map((offer: any) => (
                <div key={offer.offer_id} className="flex items-center justify-between rounded border p-2 text-sm">
                  <div>
                    <p className="font-medium">{offer.drivers?.driver_name ?? offer.driver_id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {new Date(offer.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <Badge
                    variant={
                      offer.offer_status === "accepted"
                        ? "default"
                        : offer.offer_status === "pending"
                        ? "secondary"
                        : "destructive"
                    }
                  >
                    {offer.offer_status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
