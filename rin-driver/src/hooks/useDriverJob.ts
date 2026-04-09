import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { DispatchOffer, JobForDriver, DriverProfile } from "../types/driver";

/**
 * Watches for pending dispatch offers for a specific driver.
 * Real-time subscription fires when a new offer is created.
 */
export function usePendingOffer(driverId: string | null) {
  const [offer, setOffer] = useState<DispatchOffer | null>(null);
  const [job, setJob] = useState<JobForDriver | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPendingOffer = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);

    const { data: offers } = await supabase
      .from("dispatch_offers")
      .select("*")
      .eq("driver_id", driverId)
      .eq("offer_status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);

    if (offers && offers.length > 0) {
      setOffer(offers[0]);
      // Fetch the associated job
      const { data: jobData } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", offers[0].job_id)
        .single();
      setJob(jobData);
    } else {
      setOffer(null);
      setJob(null);
    }
    setLoading(false);
  }, [driverId]);

  useEffect(() => {
    fetchPendingOffer();
  }, [fetchPendingOffer]);

  // Real-time: watch for new offers + polling fallback
  useEffect(() => {
    if (!driverId) return;

    const channel = supabase
      .channel(`driver-offers-${driverId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dispatch_offers", filter: `driver_id=eq.${driverId}` },
        () => fetchPendingOffer()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dispatch_offers", filter: `driver_id=eq.${driverId}` },
        () => fetchPendingOffer()
      )
      .subscribe();

    // Polling fallback every 5 seconds
    const poll = setInterval(fetchPendingOffer, 5000);

    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [driverId, fetchPendingOffer]);

  return { offer, job, loading, refetch: fetchPendingOffer };
}

/**
 * Watches the driver's currently active job (assigned_driver_id = driverId, not completed).
 */
export function useActiveJob(driverId: string | null) {
  const [job, setJob] = useState<JobForDriver | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchActiveJob = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);

    const { data } = await supabase
      .from("jobs")
      .select("*")
      .eq("assigned_driver_id", driverId)
      .neq("job_status", "job_completed")
      .neq("job_status", "cancelled_by_customer")
      .neq("job_status", "driver_cancelled_at_scene")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    setJob(data);
    setLoading(false);
  }, [driverId]);

  useEffect(() => {
    fetchActiveJob();
  }, [fetchActiveJob]);

  // Real-time subscription + polling fallback
  useEffect(() => {
    if (!driverId) return;

    const channel = supabase
      .channel(`driver-active-${driverId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `assigned_driver_id=eq.${driverId}` },
        (payload) => setJob(payload.new as JobForDriver)
      )
      .subscribe();

    const poll = setInterval(fetchActiveJob, 5000);

    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [driverId, fetchActiveJob]);

  return { job, loading, refetch: fetchActiveJob };
}

/**
 * Fetch driver profile.
 */
export function useDriverProfile(driverId: string | null) {
  const [profile, setProfile] = useState<DriverProfile | null>(null);

  useEffect(() => {
    if (!driverId) return;
    supabase
      .from("drivers")
      .select("driver_id, driver_name, company_name, phone, availability_status, is_active")
      .eq("driver_id", driverId)
      .single()
      .then(({ data }) => setProfile(data));
  }, [driverId]);

  return profile;
}
