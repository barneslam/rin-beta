import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useJobs } from "@/hooks/useJobs";
import { useDrivers, useIncidentTypes } from "@/hooks/useReferenceData";
import { useJobEventsForFeed } from "@/hooks/useReferenceData";
import { useActiveJob } from "@/context/JobContext";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/types/rin";
import type { JobStatus } from "@/types/rin";
import { AlertTriangle, ExternalLink, Clock, CreditCard } from "lucide-react";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { toast } from "@/hooks/use-toast";
import { PAYMENT_WARNING_MINUTES } from "@/lib/paymentConstants";

const EXCEPTION_STATUSES: string[] = [
  "customer_reapproval_pending",
  "reassignment_required",
  "driver_unavailable",
  "cancelled_after_dispatch",
];

const COMPLETED_STATUSES: string[] = [
  "job_completed",
  "cancelled_by_customer",
  "cancelled_after_dispatch",
];

const FILTER_MAP: Record<string, (status: string) => boolean> = {
  all: (s) => !COMPLETED_STATUSES.includes(s),
  awaiting: (s) => ["ready_for_dispatch", "dispatch_recommendation_ready", "driver_offer_prepared", "driver_offer_sent"].includes(s),
  payment: (s) => ["payment_authorization_required", "payment_failed", "payment_authorized"].includes(s),
  enroute: (s) => s === "driver_enroute",
  arrived: (s) => ["driver_arrived", "service_in_progress"].includes(s),
  exception: (s) => EXCEPTION_STATUSES.includes(s),
  completed: (s) => COMPLETED_STATUSES.includes(s),
};

const DispatchControlPanel = () => {
  const { data: jobs } = useJobs();
  const { data: drivers } = useDrivers();
  const { data: incidentTypes } = useIncidentTypes();
  const { data: feedEvents } = useJobEventsForFeed();
  const { setActiveJobId } = useActiveJob();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [checkingTimeouts, setCheckingTimeouts] = useState(false);
  const [bypassingJobId, setBypassingJobId] = useState<string | null>(null);

  const handleCheckTimeouts = async () => {
    setCheckingTimeouts(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-payment-timeout");
      if (error) throw error;
      if (data?.expired > 0) {
        toast({ title: "Timeouts Processed", description: `${data.expired} job(s) expired for payment timeout.` });
      } else {
        toast({ title: "No Timeouts", description: "No stale payment jobs found." });
      }
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCheckingTimeouts(false);
    }
  };

  const handleBypassPayment = async (jobId: string) => {
    setBypassingJobId(jobId);
    try {
      // Mirror what confirm-payment-authorization does: log payment_authorized event,
      // then immediately advance to ready_for_dispatch so DriverMatching can proceed.
      await supabase.from("jobs").update({
        job_status: "ready_for_dispatch",
        authorization_status: "authorized",
        stripe_payment_intent_id: `bypass_test_${Date.now()}`,
      } as any).eq("job_id", jobId);
      await supabase.from("job_events" as any).insert([
        {
          job_id: jobId,
          event_type: "payment_bypassed",
          event_category: "payment",
          message: "Pricing & payment authorization bypassed by dispatcher (TEST — Stripe not yet integrated)",
          new_value: { job_status: "ready_for_dispatch", authorization_status: "authorized" },
        },
      ] as any);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setActiveJobId(jobId);
      toast({ title: "Payment Bypassed", description: "Job is now ready for driver dispatch." });
      navigate("/matching");
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBypassingJobId(null);
    }
  };

  const driverMap = Object.fromEntries((drivers ?? []).map((d) => [d.driver_id, d]));
  const incidentMap = Object.fromEntries((incidentTypes ?? []).map((i) => [i.incident_type_id, i]));

  const filteredJobs = (jobs ?? []).filter((j) => {
    const fn = FILTER_MAP[filter];
    return fn ? fn(j.job_status) : true;
  });

  const exceptionJobs = (jobs ?? []).filter((j) => EXCEPTION_STATUSES.includes(j.job_status));
  const paymentPendingJobs = (jobs ?? []).filter((j) =>
    ["pending_customer_price_approval", "payment_authorization_required", "payment_failed"].includes(j.job_status)
  );
  const paymentPendingNoPriceJobs = paymentPendingJobs.filter((j) => !j.estimated_price || Number(j.estimated_price) <= 0);
  const paymentPendingWithPriceJobs = paymentPendingJobs.filter((j) => j.estimated_price && Number(j.estimated_price) > 0);

  const getRouteForStatus = (status: string): string => {
    if (["intake_started", "intake_completed", "validation_required", "ready_for_dispatch", "dispatch_recommendation_ready"].includes(status)) return "/dispatch";
    if (["driver_offer_prepared", "driver_offer_sent"].includes(status)) return "/offer";
    if (["payment_authorization_required", "payment_failed", "payment_authorized"].includes(status)) return "/tracking";
    if (["driver_assigned", "driver_enroute", "driver_arrived", "service_in_progress", "vehicle_loaded", "job_completed"].includes(status)) return "/tracking";
    if (EXCEPTION_STATUSES.includes(status)) return "/dispatch";
    return "/tracking";
  };

  const openJob = (jobId: string, status: string) => {
    setActiveJobId(jobId);
    navigate(getRouteForStatus(status));
  };

  const isException = (status: string) => EXCEPTION_STATUSES.includes(status);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Dispatch Control Panel</h1>
        <p className="text-sm text-muted-foreground">Monitor active jobs, exceptions, and customer updates.</p>
      </div>

      {/* Section 1: Active Jobs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="mb-4">
              <TabsTrigger value="all">All Active</TabsTrigger>
              <TabsTrigger value="awaiting">Awaiting Driver</TabsTrigger>
              <TabsTrigger value="payment">Payment</TabsTrigger>
              <TabsTrigger value="enroute">En Route</TabsTrigger>
              <TabsTrigger value="arrived">On Site</TabsTrigger>
              <TabsTrigger value="exception">
                Exception Queue
                {exceptionJobs.length > 0 && (
                  <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">
                    {exceptionJobs.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>

            <div className="rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead className="w-28">Job ID</TableHead>
                     <TableHead className="w-20">Source</TableHead>
                     <TableHead>Incident</TableHead>
                     <TableHead>Vehicle</TableHead>
                     <TableHead>Driver</TableHead>
                     <TableHead className="w-20">ETA</TableHead>
                     <TableHead>Status</TableHead>
                     <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.length === 0 ? (
                    <TableRow>
                       <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No jobs in this category.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredJobs.map((job) => {
                      const driver = job.assigned_driver_id ? driverMap[job.assigned_driver_id] : null;
                      const incident = job.incident_type_id ? incidentMap[job.incident_type_id] : null;
                      return (
                        <TableRow
                          key={job.job_id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => openJob(job.job_id, job.job_status)}
                        >
                          <TableCell className="font-mono text-xs">
                            {job.job_id.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={job.user_id ? "default" : "outline"} className="text-[10px]">
                              {job.user_id ? "Customer" : "Dispatcher"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {incident?.incident_name ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {driver?.driver_name ?? "Unassigned"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {job.eta_minutes ? `${job.eta_minutes}m` : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {isException(job.job_status) && (
                                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                              )}
                              {job.job_status === "payment_authorization_required" &&
                                job.updated_at &&
                                (Date.now() - new Date(job.updated_at).getTime()) > PAYMENT_WARNING_MINUTES * 60000 && (
                                <Clock className="h-3.5 w-3.5 text-amber-500" />
                              )}
                              {job.job_status === "job_completed" &&
                                job.customer_update_message?.startsWith("⚠ Auto-capture") && (
                                <CreditCard className="h-3.5 w-3.5 text-destructive" />
                              )}
                              <Badge className={`${JOB_STATUS_COLORS[job.job_status as JobStatus] ?? "bg-muted text-muted-foreground"} text-[10px]`}>
                                {JOB_STATUS_LABELS[job.job_status as JobStatus] ?? job.job_status}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Tabs>
        </CardContent>
      </Card>

      {/* Payment Timeout Control */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            Payment Timeout Check
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Expire jobs stuck in payment authorization for more than 30 minutes.
            </p>
            <Button size="sm" variant="outline" onClick={handleCheckTimeouts} disabled={checkingTimeouts}>
              {checkingTimeouts ? "Checking…" : "Check Timeouts"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* DEV: Payment Authorization Bypass */}
      <Card className="border-amber-500/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-amber-500" />
            Pricing &amp; Payment Bypass
            <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600 ml-1">TEST ONLY</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Stripe is not yet integrated. Bypass pricing approval and/or payment authorization to continue testing the workflow.
          </p>
          {paymentPendingJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">No jobs awaiting payment authorization.</p>
          ) : (
            <div className="space-y-3">
              {/* Jobs missing price — show warning, bypass blocked */}
              {paymentPendingNoPriceJobs.map((job) => {
                const incident = job.incident_type_id ? incidentMap[job.incident_type_id] : null;
                return (
                  <div key={job.job_id} className="flex items-center justify-between rounded border border-destructive/30 bg-destructive/5 p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      <span className="font-mono text-xs">{job.job_id.slice(0, 8)}</span>
                      <Badge className={`${JOB_STATUS_COLORS[job.job_status as JobStatus] ?? "bg-muted text-muted-foreground"} text-[10px]`}>
                        {JOB_STATUS_LABELS[job.job_status as JobStatus] ?? job.job_status}
                      </Badge>
                      <span className="text-sm">{incident?.incident_name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">
                        {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
                      </span>
                      <span className="text-xs text-destructive font-medium">No price set — set pricing first</span>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 ml-3" onClick={() => openJob(job.job_id, job.job_status)}>
                      Open
                    </Button>
                  </div>
                );
              })}
              {/* Jobs with price — bypass allowed */}
              {paymentPendingWithPriceJobs.map((job) => {
                const incident = job.incident_type_id ? incidentMap[job.incident_type_id] : null;
                return (
                  <div key={job.job_id} className="flex items-center justify-between rounded border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-xs">{job.job_id.slice(0, 8)}</span>
                      <Badge className={`${JOB_STATUS_COLORS[job.job_status as JobStatus] ?? "bg-muted text-muted-foreground"} text-[10px]`}>
                        {JOB_STATUS_LABELS[job.job_status as JobStatus] ?? job.job_status}
                      </Badge>
                      <span className="text-sm">{incident?.incident_name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">
                        {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
                      </span>
                      <Badge variant="outline">${Number(job.estimated_price).toFixed(2)}</Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500 text-amber-600 hover:bg-amber-50 shrink-0 ml-3"
                      onClick={() => handleBypassPayment(job.job_id)}
                      disabled={bypassingJobId === job.job_id}
                    >
                      {bypassingJobId === job.job_id ? "Bypassing…" : "Bypass"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Exception Queue ({exceptionJobs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {exceptionJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No exceptions.</p>
          ) : (
            <div className="space-y-2">
              {exceptionJobs.map((job) => {
                const driver = job.assigned_driver_id ? driverMap[job.assigned_driver_id] : null;
                const reason = (job as any).amendment_reason || (job as any).reassignment_reason || (job as any).cancelled_reason || "";
                return (
                  <div key={job.job_id} className="flex items-center justify-between rounded border p-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs">{job.job_id.slice(0, 8)}</span>
                      <Badge className={`${JOB_STATUS_COLORS[job.job_status as JobStatus] ?? ""} text-[10px]`}>
                        {JOB_STATUS_LABELS[job.job_status as JobStatus] ?? job.job_status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {driver?.driver_name ?? "No driver"}
                      </span>
                      {reason && (
                        <span className="text-xs text-muted-foreground truncate max-w-48">
                          — {reason}
                        </span>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openJob(job.job_id, job.job_status)}>
                      Open
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Customer Update Feed */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Customer Update Feed</CardTitle>
        </CardHeader>
        <CardContent>
          {!feedEvents || feedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No customer updates yet.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {feedEvents.map((evt: any) => (
                <div key={evt.event_id} className="flex items-start justify-between rounded border p-3">
                  <div>
                    <p className="text-sm">{evt.message}</p>
                    <span
                      className="text-xs text-primary cursor-pointer hover:underline"
                      onClick={() => openJob(evt.job_id, evt.event_type ?? "intake_started")}
                    >
                      Job {evt.job_id?.slice(0, 8)}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap ml-3">
                    {new Date(evt.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DispatchControlPanel;
