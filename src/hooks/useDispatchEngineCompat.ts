// Legacy export — kept for any remaining references
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createAuditAndEvent } from "@/hooks/useJobEvents";

export function useCreateDispatchOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      driverId,
      truckId,
    }: {
      jobId: string;
      driverId: string;
      truckId: string;
    }) => {
      const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

      const { data: offer, error } = await supabase
        .from("dispatch_offers")
        .insert({
          job_id: jobId,
          driver_id: driverId,
          truck_id: truckId,
          offer_status: "pending",
          expires_at: expiresAt,
        })
        .select()
        .single();
      if (error) throw error;

      const { data: currentJob } = await supabase
        .from("jobs")
        .select("dispatch_attempt_count")
        .eq("job_id", jobId)
        .single();

      await supabase
        .from("jobs")
        .update({
          job_status: "driver_offer_prepared" as any,
          dispatch_attempt_count: ((currentJob?.dispatch_attempt_count as number) ?? 0) + 1,
        })
        .eq("job_id", jobId);

      await supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: `Offer prepared for driver ${driverId.slice(0, 8)}`,
        event_type: "offer_sent",
        event_source: "matching_screen",
        performed_by: "system",
        new_value: offer as any,
      });

      return offer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}
