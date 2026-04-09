import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { Job, Driver } from "../types/job";

/**
 * Real-time job subscription. Watches a single job by ID and
 * updates automatically when the row changes in Supabase.
 */
export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch job + driver
  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from("jobs")
      .select("*")
      .eq("job_id", jobId)
      .single();

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setJob(data);
    setError(null);

    // Fetch driver if assigned
    if (data.assigned_driver_id) {
      const { data: driverData } = await supabase
        .from("drivers")
        .select("driver_id, driver_name, company_name, phone, rating, gps_lat, gps_long")
        .eq("driver_id", data.assigned_driver_id)
        .single();
      setDriver(driverData);
    } else {
      setDriver(null);
    }
    setLoading(false);
  }, [jobId]);

  // Initial fetch
  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Real-time subscription + polling fallback
  useEffect(() => {
    if (!jobId) return;

    // Try real-time first
    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `job_id=eq.${jobId}` },
        (payload) => {
          setJob(payload.new as Job);
          if (payload.new.assigned_driver_id !== payload.old?.assigned_driver_id) {
            fetchJob();
          }
        }
      )
      .subscribe();

    // Polling fallback: check every 5 seconds in case WebSocket fails
    const poll = setInterval(fetchJob, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [jobId, fetchJob]);

  return { job, driver, loading, error, refetch: fetchJob };
}

/**
 * Fetch active jobs for a customer by phone number.
 */
export function useCustomerJobs(phone: string | null) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!phone) return;

    const fetchJobs = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("*")
        .eq("customer_phone", phone)
        .not("job_status", "in", '("job_completed","cancelled_by_customer")')
        .order("created_at", { ascending: false })
        .limit(10);

      setJobs(data || []);
      setLoading(false);
    };

    fetchJobs();

    // Subscribe to all job changes for this phone
    const channel = supabase
      .channel(`customer-jobs-${phone}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `customer_phone=eq.${phone}` },
        () => fetchJobs()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [phone]);

  return { jobs, loading };
}
