import { useQuery } from "@tanstack/react-query";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import type { JobEvent } from "@/types/rin";

const POLL_INTERVAL = 10_000;

export function useJobEventsForJob(jobId?: string | null) {
  return useQuery({
    queryKey: ["job_events", jobId],
    enabled: !!jobId,
    refetchInterval: POLL_INTERVAL,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_events" as any)
        .select("*")
        .eq("job_id", jobId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as JobEvent[];
    },
  });
}
