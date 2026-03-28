import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";

export function useJobEvents(jobId?: string) {
  return useQuery({
    queryKey: ["job_events", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_events" as any)
        .select("*")
        .eq("job_id", jobId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useAllJobEvents() {
  return useQuery({
    queryKey: ["job_events", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_events" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useCreateJobEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (event: {
      job_id: string;
      event_type: string;
      event_category: string;
      event_status?: string;
      actor_type?: string;
      actor_id?: string;
      message?: string;
      reason?: string;
      old_value?: Record<string, unknown>;
      new_value?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase
        .from("job_events" as any)
        .insert([event] as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
    },
  });
}

export async function createAuditAndEvent(
  jobId: string,
  opts: {
    auditActionType: string;
    auditEventType: string;
    auditEventSource: string;
    eventType: string;
    eventCategory: string;
    eventStatus?: string;
    message?: string;
    reason?: string;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
  }
) {
  const auditPromise = supabase.from("audit_logs").insert([{
    job_id: jobId,
    action_type: opts.auditActionType,
    event_type: opts.auditEventType as any,
    event_source: opts.auditEventSource,
    performed_by: "dispatcher",
    old_value: (opts.oldValue ?? undefined) as any,
    new_value: (opts.newValue ?? undefined) as any,
  }]);

  const eventPromise = supabase.from("job_events" as any).insert([{
    job_id: jobId,
    event_type: opts.eventType,
    event_category: opts.eventCategory,
    event_status: opts.eventStatus ?? null,
    actor_type: "dispatcher",
    message: opts.message ?? null,
    reason: opts.reason ?? null,
    old_value: opts.oldValue ?? null,
    new_value: opts.newValue ?? null,
  }] as any);

  await Promise.all([auditPromise, eventPromise]);
}
