import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { AlertTriangle, ExternalLink } from "lucide-react";

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
  enroute: (s) => s === "driver_enroute",
  arrived: (s) => s === "driver_arrived",
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
  const [filter, setFilter] = useState("all");

  const driverMap = Object.fromEntries((drivers ?? []).map((d) => [d.driver_id, d]));
  const incidentMap = Object.fromEntries((incidentTypes ?? []).map((i) => [i.incident_type_id, i]));

  const filteredJobs = (jobs ?? []).filter((j) => {
    const fn = FILTER_MAP[filter];
    return fn ? fn(j.job_status) : true;
  });

  const exceptionJobs = (jobs ?? []).filter((j) => EXCEPTION_STATUSES.includes(j.job_status));

  const openJob = (jobId: string) => {
    setActiveJobId(jobId);
    navigate("/tracking");
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
              <TabsTrigger value="enroute">En Route</TabsTrigger>
              <TabsTrigger value="arrived">Arrived</TabsTrigger>
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
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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
                          onClick={() => openJob(job.job_id)}
                        >
                          <TableCell className="font-mono text-xs">
                            {job.job_id.slice(0, 8)}
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

      {/* Section 2: Exception Queue */}
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
                    <Button size="sm" variant="outline" onClick={() => openJob(job.job_id)}>
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
                      onClick={() => openJob(evt.job_id)}
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
