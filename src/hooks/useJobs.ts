import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import type { JobInsert, JobUpdate, Job } from "@/types/rin";

export function useJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ["jobs", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

async function createAuditLog(
  jobId: string,
  actionType: string,
  eventType: "job_created" | "job_updated" | "status_changed" | "driver_assigned" | "offer_sent" | "offer_responded" | "system_event",
  eventSource: string,
  oldValue?: Record<string, unknown> | null,
  newValue?: Record<string, unknown> | null
) {
  await supabase.from("audit_logs").insert([{
    job_id: jobId,
    action_type: actionType,
    event_type: eventType,
    event_source: eventSource,
    performed_by: "system",
    old_value: (oldValue ?? undefined) as any,
    new_value: (newValue ?? undefined) as any,
  }]);
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: JobInsert) => {
      const { data, error } = await supabase
        .from("jobs")
        .insert(job)
        .select()
        .single();
      if (error) throw error;
      await createAuditLog(data.job_id, "Job created", "job_created", "intake_screen", null, data as unknown as Record<string, unknown>);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, updates, eventSource = "system" }: { jobId: string; updates: JobUpdate; eventSource?: string }) => {
      // Fetch old value
      const { data: oldJob } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId)
        .single();

      const { data, error } = await supabase
        .from("jobs")
        .update(updates)
        .eq("job_id", jobId)
        .select()
        .single();
      if (error) throw error;

      // Determine event type
      const eventType = updates.job_status && updates.job_status !== oldJob?.job_status
        ? "status_changed" as const
        : updates.assigned_driver_id && updates.assigned_driver_id !== oldJob?.assigned_driver_id
        ? "driver_assigned" as const
        : "job_updated" as const;

      await createAuditLog(
        jobId,
        eventType === "status_changed" ? `Status: ${oldJob?.job_status} → ${updates.job_status}` : "Job updated",
        eventType,
        eventSource,
        oldJob as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );

      // --- Auto-capture payment when job reaches job_completed ---
      if (updates.job_status === "job_completed" && data.stripe_payment_intent_id) {
        try {
          const captureResult = await supabase.functions.invoke("capture-payment", {
            body: { jobId },
          });
          if (captureResult.error || !captureResult.data?.success) {
            const errMsg = captureResult.data?.error || captureResult.error?.message || "Unknown capture error";
            console.error("Auto-capture failed:", errMsg);
            // Persist failure as customer_update_message so dispatcher UI can see it
            await supabase.from("jobs").update({
              customer_update_message: `⚠ Auto-capture failed: ${errMsg}`,
            }).eq("job_id", jobId);
          }
        } catch (captureErr) {
          console.error("Auto-capture invoke error:", captureErr);
          await supabase.from("jobs").update({
            customer_update_message: `⚠ Auto-capture failed: ${(captureErr as Error).message}`,
          }).eq("job_id", jobId);
        }
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobs", data.job_id] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}
