import { useQuery } from "@tanstack/react-query";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";

const POLL_INTERVAL = 10_000;

/** Temporary type for decision_logs rows until generated types include this table */
export interface DecisionLog {
  id: string;
  job_id: string;
  decision_type: string | null;
  decision_outcome: string | null;
  factors: Record<string, unknown> | null;
  created_at: string;
}

export function useDecisionLogsForJob(jobId?: string | null) {
  return useQuery({
    queryKey: ["decision_logs", jobId],
    enabled: !!jobId,
    refetchInterval: POLL_INTERVAL,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("decision_logs" as any)
        .select("*")
        .eq("job_id", jobId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DecisionLog[];
    },
  });
}
