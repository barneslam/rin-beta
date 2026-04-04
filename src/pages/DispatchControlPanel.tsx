import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useJobs } from "@/hooks/useJobs";
import { useDrivers, useIncidentTypes, useDispatchOffers } from "@/hooks/useReferenceData";
import { useJobEventsForJob } from "@/hooks/useJobEventsForJob";
import { useDecisionLogsForJob } from "@/hooks/useDecisionLogsForJob";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/types/rin";
import type { Job, JobStatus } from "@/types/rin";
import { AlertTriangle, Truck, Play, ChevronRight, Clock, MapPin, Car, Shield } from "lucide-react";
import { useFlowSupervisor, type StateHealth } from "@/hooks/useFlowSupervisor";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { toast } from "@/hooks/use-toast";

const DASHBOARD_POLL = 10_000;

const FILTER_STATUSES: Record<string, string[]> = {
  active: [
    "ready_for_dispatch",
    "dispatch_recommendation_ready",
    "driver_offer_sent",
    "driver_assigned",
    "payment_authorization_required",
  ],
  dispatch: ["ready_for_dispatch", "dispatch_recommendation_ready"],
  offers: ["driver_offer_sent"],
  assigned: ["driver_assigned"],
  payment: ["payment_authorization_required"],
};

function statusBadge(status: string) {
  return (
    <Badge className={`${JOB_STATUS_COLORS[status as JobStatus] ?? "bg-muted text-muted-foreground"} text-[10px] whitespace-nowrap`}>
      {JOB_STATUS_LABELS[status as JobStatus] ?? status}
    </Badge>
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtShortId(id: string) {
  return id.slice(0, 8);
}

const DispatchControlPanel = () => {
  const { data: jobs } = useJobs();
  const { data: drivers } = useDrivers();
  const { data: incidentTypes } = useIncidentTypes();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState("active");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Detail panel data — all poll at 10s
  const { data: jobEvents } = useJobEventsForJob(selectedJobId);
  const { data: decisionLogs } = useDecisionLogsForJob(selectedJobId);
  const { data: dispatchOffers } = useDispatchOffers(selectedJobId, DASHBOARD_POLL);

  // Flow Supervisor
  const supervisor = useFlowSupervisor(
    selectedJob,
    dispatchOffers,
    jobEvents as any,
    decisionLogs,
  );

  // Action state
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [dispatchLoading, setDispatchLoading] = useState(false);

  const driverMap = useMemo(
    () => Object.fromEntries((drivers ?? []).map((d) => [d.driver_id, d])),
    [drivers]
  );
  const incidentMap = useMemo(
    () => Object.fromEntries((incidentTypes ?? []).map((i) => [i.incident_type_id, i])),
    [incidentTypes]
  );

  const filteredJobs = useMemo(() => {
    const statuses = FILTER_STATUSES[filter];
    if (!statuses) return jobs ?? [];
    return (jobs ?? []).filter((j) => statuses.includes(j.job_status));
  }, [jobs, filter]);

  const selectedJob = useMemo(
    () => (jobs ?? []).find((j) => j.job_id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  );

  // --- Actions ---
  const handleMatchDrivers = async () => {
    if (!selectedJobId) return;
    setMatchingLoading(true);
    try {
      const { error } = await supabase.functions.invoke("match-drivers-for-job", {
        body: { job_id: selectedJobId },
      });
      if (error) throw error;
      toast({ title: "Driver matching started" });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err) {
      toast({ title: "Match failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setMatchingLoading(false);
    }
  };

  const handleStartDispatch = async () => {
    if (!selectedJobId) return;
    setDispatchLoading(true);
    try {
      const { error } = await supabase.functions.invoke("start-dispatch-offers", {
        body: { job_id: selectedJobId },
      });
      if (error) throw error;
      toast({ title: "Dispatch offers started" });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers", selectedJobId] });
    } catch (err) {
      toast({ title: "Dispatch failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDispatchLoading(false);
    }
  };

  const canMatchDrivers = selectedJob?.job_status === "ready_for_dispatch";
  const canStartDispatch = selectedJob?.job_status === "dispatch_recommendation_ready";

  const isDev = import.meta.env.DEV;
  const canDevBypass = isDev && selectedJob?.job_status === "payment_authorization_required";
  const [bypassLoading, setBypassLoading] = useState(false);

  const handleDevBypass = async () => {
    if (!selectedJobId) return;
    setBypassLoading(true);
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ job_status: "ready_for_dispatch" as any } as any)
        .eq("job_id", selectedJobId);
      if (error) throw error;
      toast({ title: "DEV: Status overridden to ready_for_dispatch" });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err) {
      toast({ title: "Override failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBypassLoading(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0 overflow-hidden">
      {/* ===== LEFT PANEL: Job List ===== */}
      <div className="w-full md:w-[420px] lg:w-[480px] shrink-0 border-r border-border flex flex-col bg-card">
        <div className="p-4 pb-2">
          <h1 className="text-lg font-bold text-foreground">Dispatch Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="px-4 pb-3">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="w-full grid grid-cols-5 h-8">
              <TabsTrigger value="active" className="text-[11px] px-1">All Active</TabsTrigger>
              <TabsTrigger value="dispatch" className="text-[11px] px-1">Dispatch</TabsTrigger>
              <TabsTrigger value="offers" className="text-[11px] px-1">Offers</TabsTrigger>
              <TabsTrigger value="assigned" className="text-[11px] px-1">Assigned</TabsTrigger>
              <TabsTrigger value="payment" className="text-[11px] px-1">Payment</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-2 pb-4 space-y-1">
            {filteredJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No jobs match this filter.</p>
            ) : (
              filteredJobs.map((job) => {
                const incident = job.incident_type_id ? incidentMap[job.incident_type_id] : null;
                const driver = job.assigned_driver_id ? driverMap[job.assigned_driver_id] : null;
                const isSelected = job.job_id === selectedJobId;
                return (
                  <button
                    key={job.job_id}
                    onClick={() => setSelectedJobId(job.job_id)}
                    className={`w-full text-left rounded-md px-3 py-2.5 transition-colors border ${
                      isSelected
                        ? "bg-primary/10 border-primary/30"
                        : "bg-card border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{fmtShortId(job.job_id)}</span>
                      {statusBadge(job.job_status)}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium truncate">
                        {incident?.incident_name ?? "Unknown incident"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {job.vehicle_make && (
                        <span className="flex items-center gap-1">
                          <Car className="h-3 w-3" />
                          {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ")}
                        </span>
                      )}
                      {job.pickup_location && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3" />
                          {job.pickup_location}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {fmtTime(job.created_at)}
                      {driver && (
                        <>
                          <span>·</span>
                          <span>{driver.driver_name}</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ===== RIGHT PANEL: Job Detail ===== */}
      <div className="flex-1 overflow-hidden flex flex-col bg-background">
        {!selectedJob ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <ChevronRight className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select a job to view details</p>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-6 max-w-3xl">
              {/* Job Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Job Summary</CardTitle>
                    {statusBadge(selectedJob.job_status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground text-xs">Job ID</dt>
                      <dd className="font-mono">{selectedJob.job_id}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Created</dt>
                      <dd>{fmtTime(selectedJob.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Incident</dt>
                      <dd>{selectedJob.incident_type_id ? incidentMap[selectedJob.incident_type_id]?.incident_name ?? "—" : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Vehicle</dt>
                      <dd>{[selectedJob.vehicle_year, selectedJob.vehicle_make, selectedJob.vehicle_model].filter(Boolean).join(" ") || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Pickup</dt>
                      <dd>{selectedJob.pickup_location ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">ETA</dt>
                      <dd>{selectedJob.eta_minutes ? `${selectedJob.eta_minutes} min` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Estimated Price</dt>
                      <dd>{selectedJob.estimated_price ? `$${Number(selectedJob.estimated_price).toFixed(2)}` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Assigned Driver</dt>
                      <dd>{selectedJob.assigned_driver_id ? driverMap[selectedJob.assigned_driver_id]?.driver_name ?? fmtShortId(selectedJob.assigned_driver_id) : "Unassigned"}</dd>
                {canDevBypass && (
                  <Button
                    onClick={handleDevBypass}
                    disabled={bypassLoading}
                    variant="outline"
                    className="gap-2 border-destructive text-destructive hover:bg-destructive/10"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    {bypassLoading ? "Overriding…" : "DEV: Skip Payment"}
                  </Button>
                )}
              </div>
                  </dl>
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button
                  onClick={handleMatchDrivers}
                  disabled={!canMatchDrivers || matchingLoading}
                  className="gap-2"
                >
                  <Truck className="h-4 w-4" />
                  {matchingLoading ? "Matching…" : "Match Drivers"}
                </Button>
                <Button
                  onClick={handleStartDispatch}
                  disabled={!canStartDispatch || dispatchLoading}
                  variant="secondary"
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  {dispatchLoading ? "Starting…" : "Start Dispatch"}
                </Button>
              </div>

              {/* Dispatch Offers */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Dispatch Offers ({dispatchOffers?.length ?? 0})</CardTitle>
                </CardHeader>
                <CardContent>
                  {!dispatchOffers || dispatchOffers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No data yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Driver</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Created</TableHead>
                          <TableHead className="text-xs">Expires</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dispatchOffers.map((offer) => {
                          const offerDriver = driverMap[offer.driver_id];
                          return (
                            <TableRow key={offer.offer_id}>
                              <TableCell className="text-sm">{offerDriver?.driver_name ?? fmtShortId(offer.driver_id)}</TableCell>
                              <TableCell>
                                <Badge variant={offer.offer_status === "accepted" ? "default" : "outline"} className="text-[10px]">
                                  {offer.offer_status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{fmtTime(offer.created_at)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{offer.expires_at ? fmtTime(offer.expires_at) : "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Decision Logs */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Decision Logs ({decisionLogs?.length ?? 0})</CardTitle>
                </CardHeader>
                <CardContent>
                  {!decisionLogs || decisionLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No data yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {decisionLogs.map((log) => (
                        <div key={log.id} className="rounded border border-border p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium">{log.decision_type ?? "Decision"}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{fmtTime(log.created_at)}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{log.decision_outcome ?? "—"}</p>
                          {log.factors && Object.keys(log.factors).length > 0 && (
                            <pre className="mt-2 text-[11px] bg-muted/50 rounded p-2 overflow-x-auto text-muted-foreground">
                              {JSON.stringify(log.factors, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Job Events Timeline */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Event Timeline ({jobEvents?.length ?? 0})</CardTitle>
                </CardHeader>
                <CardContent>
                  {!jobEvents || jobEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No events recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {jobEvents.map((evt) => (
                        <div key={evt.event_id} className="flex gap-3 items-start rounded border border-border p-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium">{evt.event_type}</span>
                              <Badge variant="outline" className="text-[10px]">{evt.event_category}</Badge>
                              {evt.event_status && (
                                <Badge variant="secondary" className="text-[10px]">{evt.event_status}</Badge>
                              )}
                            </div>
                            {evt.message && <p className="text-sm text-muted-foreground">{evt.message}</p>}
                            {evt.reason && <p className="text-xs text-muted-foreground italic">Reason: {evt.reason}</p>}
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                            {fmtTime(evt.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};

export default DispatchControlPanel;
