import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createAuditAndEvent } from "./useJobEvents";

export function useAmendJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      updates,
      amendmentReason,
    }: {
      jobId: string;
      updates: {
        required_truck_type_id?: string;
        required_equipment?: unknown[];
        estimated_price?: number;
      };
      amendmentReason: string;
    }) => {
      const { data: oldJob } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId)
        .single();

      const { data, error } = await supabase
        .from("jobs")
        .update({
          ...updates,
          amendment_reason: amendmentReason,
          job_status: "customer_reapproval_pending" as any,
        } as any)
        .eq("job_id", jobId)
        .select()
        .single();
      if (error) throw error;

      await createAuditAndEvent(jobId, {
        auditActionType: `Amendment: ${amendmentReason}`,
        auditEventType: "amendment_requested",
        auditEventSource: "control_panel",
        eventType: "amendment_requested",
        eventCategory: "exception",
        message: "Revised quote pending your approval",
        reason: amendmentReason,
        oldValue: oldJob as any,
        newValue: data as any,
      });

      await supabase.from("job_events" as any).insert([{
        job_id: jobId,
        event_type: "customer_update",
        event_category: "customer_update",
        message: "Revised quote pending your approval",
      }] as any);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

export function useCustomerReapproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      approved,
    }: {
      jobId: string;
      approved: boolean;
    }) => {
      const { data: job } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId)
        .single();

      if (approved) {
        const restoreStatus = job?.assigned_driver_id
          ? "driver_assigned"
          : "dispatch_recommendation_ready";

        const { data, error } = await supabase
          .from("jobs")
          .update({
            job_status: restoreStatus as any,
          } as any)
          .eq("job_id", jobId)
          .select()
          .single();
        if (error) throw error;

        await createAuditAndEvent(jobId, {
          auditActionType: "Customer approved amendment",
          auditEventType: "customer_update",
          auditEventSource: "control_panel",
          eventType: "customer_approved",
          eventCategory: "customer_update",
          message: "Customer approved revised quote",
          oldValue: job as any,
          newValue: data as any,
        });

        return data;
      } else {
        const { data, error } = await supabase
          .from("jobs")
          .update({
            job_status: "cancelled_by_customer" as any,
            cancelled_reason: "Customer declined revised quote",
            cancelled_by: "customer",
            cancellation_fee: 0,
          } as any)
          .eq("job_id", jobId)
          .select()
          .single();
        if (error) throw error;

        await createAuditAndEvent(jobId, {
          auditActionType: "Customer declined amendment — job cancelled",
          auditEventType: "job_cancelled",
          auditEventSource: "control_panel",
          eventType: "job_cancelled",
          eventCategory: "customer_update",
          message: "Cancellation confirmed",
          reason: "Customer declined revised quote",
          oldValue: job as any,
          newValue: data as any,
        });

        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

export function useRequestReassignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      reason,
    }: {
      jobId: string;
      reason: string;
    }) => {
      const { data: oldJob } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId)
        .single();

      const { data, error } = await supabase
        .from("jobs")
        .update({
          job_status: "reassignment_required" as any,
          reassignment_reason: reason,
          assigned_driver_id: null,
          assigned_truck_id: null,
        } as any)
        .eq("job_id", jobId)
        .select()
        .single();
      if (error) throw error;

      await createAuditAndEvent(jobId, {
        auditActionType: `Reassignment requested: ${reason}`,
        auditEventType: "reassignment_requested",
        auditEventSource: "control_panel",
        eventType: "job_reassigned",
        eventCategory: "exception",
        message: "Job is being reassigned to another driver",
        reason,
        oldValue: {
          assigned_driver_id: oldJob?.assigned_driver_id,
          assigned_truck_id: oldJob?.assigned_truck_id,
          job_status: oldJob?.job_status,
        },
        newValue: data as any,
      });

      await supabase.from("job_events" as any).insert([{
        job_id: jobId,
        event_type: "customer_update",
        event_category: "customer_update",
        message: "Job is being reassigned to another driver",
      }] as any);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

export function useMarkDriverUnavailable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      reason,
    }: {
      jobId: string;
      reason: string;
    }) => {
      const { data: oldJob } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId)
        .single();

      const { data, error } = await supabase
        .from("jobs")
        .update({
          job_status: "driver_unavailable" as any,
          assigned_driver_id: null,
          assigned_truck_id: null,
        } as any)
        .eq("job_id", jobId)
        .select()
        .single();
      if (error) throw error;

      await createAuditAndEvent(jobId, {
        auditActionType: `Driver unavailable: ${reason}`,
        auditEventType: "driver_unavailable" as any,
        auditEventSource: "control_panel",
        eventType: "driver_unavailable",
        eventCategory: "exception",
        message: "Assigned driver is unavailable and your job is being reviewed",
        reason,
        oldValue: {
          assigned_driver_id: oldJob?.assigned_driver_id,
          assigned_truck_id: oldJob?.assigned_truck_id,
          job_status: oldJob?.job_status,
        },
        newValue: data as any,
      });

      await supabase.from("job_events" as any).insert([{
        job_id: jobId,
        event_type: "customer_update",
        event_category: "customer_update",
        message: "Assigned driver is unavailable and your job is being reviewed",
      }] as any);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

const PRE_DISPATCH_STATUSES = [
  "intake_started", "intake_completed", "validation_required",
  "ready_for_dispatch", "dispatch_recommendation_ready",
  "driver_offer_prepared", "driver_offer_sent", "driver_assigned",
];

export function useCancelJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      reason,
      cancelledBy = "dispatcher",
    }: {
      jobId: string;
      reason: string;
      cancelledBy?: string;
    }) => {
      const { data: job } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId)
        .single();

      if (!job) throw new Error("Job not found");

      const status = job.job_status;
      if (status === "vehicle_loaded" || status === "job_completed") {
        throw new Error("Cancellation is not allowed after vehicle load or completion.");
      }

      const isPreDispatch = PRE_DISPATCH_STATUSES.includes(status);
      let fee = 0;
      if (!isPreDispatch && (status === "driver_enroute" || status === "driver_arrived")) {
        fee = job.estimated_price
          ? Math.round(Number(job.estimated_price) * 0.02 * 100) / 100
          : 0;
      }

      const newStatus = isPreDispatch ? "cancelled_by_customer" : "cancelled_after_dispatch";

      const { data, error } = await supabase
        .from("jobs")
        .update({
          job_status: newStatus as any,
          cancellation_fee: fee,
          cancelled_reason: reason,
          cancelled_by: cancelledBy,
        } as any)
        .eq("job_id", jobId)
        .select()
        .single();
      if (error) throw error;

      await createAuditAndEvent(jobId, {
        auditActionType: `Job cancelled: ${reason} (fee: $${fee})`,
        auditEventType: "job_cancelled",
        auditEventSource: "control_panel",
        eventType: "job_cancelled",
        eventCategory: "exception",
        message: "Cancellation confirmed",
        reason,
        oldValue: {
          assigned_driver_id: job.assigned_driver_id,
          assigned_truck_id: job.assigned_truck_id,
          job_status: job.job_status,
          estimated_price: job.estimated_price,
        },
        newValue: { cancellation_fee: fee, job_status: newStatus },
      });

      await supabase.from("job_events" as any).insert([{
        job_id: jobId,
        event_type: "customer_update",
        event_category: "customer_update",
        message: "Cancellation confirmed",
      }] as any);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}
