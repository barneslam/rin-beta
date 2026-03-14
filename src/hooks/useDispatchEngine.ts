import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useJob, useUpdateJob } from "@/hooks/useJobs";
import { useDrivers, useTrucks, useIncidentTypes, useTruckTypes, useEquipment } from "@/hooks/useReferenceData";
import {
  validateJobForDispatch,
  classifyIncident,
  matchTruckCapability,
  filterEligibleDrivers,
  rankDrivers,
  type ValidationResult,
  type IncidentClassification,
  type RankedDriver,
} from "@/lib/dispatchEngine";
import type { Driver, Truck, TruckType, Equipment } from "@/types/rin";

export function useDispatchRecommendation(jobId: string | null) {
  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: drivers, isLoading: driversLoading } = useDrivers();
  const { data: trucks, isLoading: trucksLoading } = useTrucks();
  const { data: incidentTypes, isLoading: incidentLoading } = useIncidentTypes();
  const { data: truckTypes } = useTruckTypes();
  const { data: equipment } = useEquipment();

  const isLoading = jobLoading || driversLoading || trucksLoading || incidentLoading;

  const result = useMemo(() => {
    if (!job || !drivers || !trucks || !incidentTypes) {
      return {
        validationResult: null as ValidationResult | null,
        classification: null as IncidentClassification | null,
        eligibleTrucks: [] as Truck[],
        eligibleDrivers: [] as Driver[],
        rankedDrivers: [] as RankedDriver[],
        truckTypes: (truckTypes ?? []) as TruckType[],
        equipment: (equipment ?? []) as Equipment[],
      };
    }

    const validationResult = validateJobForDispatch(job);
    const classification = classifyIncident(job, incidentTypes);

    // Fallback: if job has no required_truck_type_id, use classification result
    const effectiveJob = (!job.required_truck_type_id && classification?.truckTypeId)
      ? { ...job, required_truck_type_id: classification.truckTypeId }
      : job;

    const eligibleTrucks = matchTruckCapability(effectiveJob, trucks);
    const eligible = filterEligibleDrivers(effectiveJob, drivers, eligibleTrucks);
    const rankedDrivers = rankDrivers(eligible, effectiveJob, eligibleTrucks);

    return {
      validationResult,
      classification,
      eligibleTrucks,
      eligibleDrivers: eligible,
      rankedDrivers,
      truckTypes: (truckTypes ?? []) as TruckType[],
      equipment: (equipment ?? []) as Equipment[],
    };
  }, [job, drivers, trucks, incidentTypes, truckTypes, equipment]);

  return { ...result, job, isLoading };
}

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
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Create offer
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

      // Increment dispatch_attempt_count
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

      // Audit log
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

export function useAcceptDispatchOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      offerId,
      jobId,
      driverId,
      truckId,
    }: {
      offerId: string;
      jobId: string;
      driverId: string;
      truckId: string | null;
    }) => {
      // Get current job status
      const { data: currentJob } = await supabase
        .from("jobs")
        .select("job_status")
        .eq("job_id", jobId)
        .single();

      const oldStatus = currentJob?.job_status;

      // Accept this offer
      const { error: offerErr } = await supabase
        .from("dispatch_offers")
        .update({ offer_status: "accepted" as any })
        .eq("offer_id", offerId);
      if (offerErr) throw offerErr;

      // Expire all other pending offers for this job
      await supabase
        .from("dispatch_offers")
        .update({ offer_status: "expired" as any })
        .eq("job_id", jobId)
        .neq("offer_id", offerId)
        .eq("offer_status", "pending");

      // Assign driver and update job status
      const { error: jobErr } = await supabase
        .from("jobs")
        .update({
          assigned_driver_id: driverId,
          assigned_truck_id: truckId,
          job_status: "driver_assigned" as any,
        })
        .eq("job_id", jobId);
      if (jobErr) throw jobErr;

      // Audit log
      await supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: `Status: ${oldStatus} → driver_assigned`,
        event_type: "driver_assigned",
        event_source: "offer_screen",
        performed_by: "system",
        old_value: { job_status: oldStatus } as any,
        new_value: { job_status: "driver_assigned" } as any,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

export function useDeclineDispatchOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      offerId,
      jobId,
      driverId,
    }: {
      offerId: string;
      jobId: string;
      driverId: string;
    }) => {
      // Decline this offer
      const { error } = await supabase
        .from("dispatch_offers")
        .update({ offer_status: "declined" as any })
        .eq("offer_id", offerId);
      if (error) throw error;

      // Audit log for decline
      await supabase.from("audit_logs").insert({
        job_id: jobId,
        action_type: `Offer declined for driver ${driverId.slice(0, 8)}`,
        event_type: "offer_responded",
        event_source: "offer_screen",
        performed_by: "system",
      });

      // Check if any pending offers remain
      const { data: remaining } = await supabase
        .from("dispatch_offers")
        .select("offer_id")
        .eq("job_id", jobId)
        .eq("offer_status", "pending");

      const { data: currentJob } = await supabase
        .from("jobs")
        .select("job_status, assigned_driver_id")
        .eq("job_id", jobId)
        .single();

      // If no pending offers and no driver assigned, reset to matching
      if ((!remaining || remaining.length === 0) && !currentJob?.assigned_driver_id) {
        const oldStatus = currentJob?.job_status;
        await supabase
          .from("jobs")
          .update({ job_status: "dispatch_recommendation_ready" as any })
          .eq("job_id", jobId);

        await supabase.from("audit_logs").insert({
          job_id: jobId,
          action_type: `Status: ${oldStatus} → dispatch_recommendation_ready (all offers exhausted)`,
          event_type: "status_changed",
          event_source: "offer_screen",
          performed_by: "system",
          old_value: { job_status: oldStatus } as any,
          new_value: { job_status: "dispatch_recommendation_ready" } as any,
        });

        return { allExhausted: true };
      }

      return { allExhausted: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}
