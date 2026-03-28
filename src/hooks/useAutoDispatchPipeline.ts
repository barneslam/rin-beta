import { useMutation } from "@tanstack/react-query";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { useAutoDispatchOffer } from "@/hooks/useDispatchEngine";
import { classifyIncident } from "@/lib/dispatchEngine";
import { createAuditAndEvent } from "@/hooks/useJobEvents";

/**
 * Thin orchestration hook: after a customer creates a job,
 * classify the incident, advance to ready_for_dispatch,
 * then invoke the existing useAutoDispatchOffer pipeline.
 */
export function useAutoDispatchPipeline() {
  const autoDispatch = useAutoDispatchOffer();

  return useMutation({
    mutationFn: async (jobId: string) => {
      // 1. Fetch job + reference data in parallel
      const [jobRes, driversRes, trucksRes, incidentTypesRes, truckTypesRes] = await Promise.all([
        supabase.from("jobs").select("*").eq("job_id", jobId).single(),
        supabase.from("drivers").select("*"),
        supabase.from("trucks").select("*"),
        supabase.from("incident_types").select("*"),
        supabase.from("truck_types").select("*"),
      ]);

      if (jobRes.error || !jobRes.data) throw new Error("Job not found");
      const job = jobRes.data;

      // Check job-level SMS confirmation gate
      if (!(job as any).sms_confirmed) {
        console.log("Job not yet confirmed by customer — dispatch deferred");
        return { deferred: true, reason: "awaiting_customer_confirmation" };
      }
      const drivers = driversRes.data ?? [];
      const trucks = trucksRes.data ?? [];
      const incidentTypes = incidentTypesRes.data ?? [];
      const truckTypes = truckTypesRes.data ?? [];

      // 2. Classify incident → get required truck type
      const classification = classifyIncident(job as any, incidentTypes as any);
      const requiredTruckTypeId = classification?.truckTypeId ?? null;
      const requiredEquipment = classification?.requiredEquipment ?? [];

      // 3. Update job: set truck type + advance to ready_for_dispatch
      await supabase
        .from("jobs")
        .update({
          required_truck_type_id: requiredTruckTypeId,
          required_equipment: requiredEquipment as any,
          job_status: "ready_for_dispatch" as any,
        })
        .eq("job_id", jobId);

      await createAuditAndEvent(jobId, {
        auditActionType: "Auto-dispatch: classified and ready for dispatch",
        auditEventType: "status_changed",
        auditEventSource: "auto_dispatch",
        eventType: "status_changed",
        eventCategory: "dispatch",
        message: "Job classified and ready for dispatch",
        oldValue: { job_status: job.job_status },
        newValue: { job_status: "ready_for_dispatch", required_truck_type_id: requiredTruckTypeId },
      });

      // 4. Invoke the existing dispatch offer pipeline
      const result = await autoDispatch.mutateAsync({
        jobId,
        drivers: drivers as any,
        trucks: trucks as any,
        incidentTypes: incidentTypes as any,
        truckTypes: truckTypes as any,
      });

      return result;
    },
  });
}
