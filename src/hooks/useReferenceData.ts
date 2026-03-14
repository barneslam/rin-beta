import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useDrivers() {
  return useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useTrucks() {
  return useQuery({
    queryKey: ["trucks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trucks").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useTruckTypes() {
  return useQuery({
    queryKey: ["truck_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("truck_types").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useEquipment() {
  return useQuery({
    queryKey: ["equipment"],
    queryFn: async () => {
      const { data, error } = await supabase.from("equipment").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useIncidentTypes() {
  return useQuery({
    queryKey: ["incident_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("incident_types").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function usePricingRules() {
  return useQuery({
    queryKey: ["pricing_rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pricing_rules").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useDispatchOffers(jobId?: string) {
  return useQuery({
    queryKey: ["dispatch_offers", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispatch_offers")
        .select("*")
        .eq("job_id", jobId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAuditLogs(jobId?: string) {
  return useQuery({
    queryKey: ["audit_logs", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("job_id", jobId!)
        .order("timestamp", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}
