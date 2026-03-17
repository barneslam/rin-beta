import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useJob } from "@/hooks/useJobs";
import { useDrivers, useTrucks, useIncidentTypes, useTruckTypes, useEquipment } from "@/hooks/useReferenceData";
import { createAuditAndEvent } from "@/hooks/useJobEvents";
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

// ---------------------------------------------------------------------------
// Recent offer counts (for fairness scoring)
// ---------------------------------------------------------------------------

function useRecentOfferCounts() {
  return useQuery({
    queryKey: ["recent_offer_counts"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("dispatch_offers")
        .select("driver_id")
        .gte("created_at", since);
      const counts = new Map<string, number>();
      (data ?? []).forEach((o) => {
        counts.set(o.driver_id, (counts.get(o.driver_id) || 0) + 1);
      });
      return counts;
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Excluded driver IDs (reservations + pending offers on other jobs)
// ---------------------------------------------------------------------------

function useExcludedDriverIds(currentJobId: string | null) {
  return useQuery({
    queryKey: ["excluded_drivers", currentJobId],
    queryFn: async () => {
      const exclude = new Set<string>();

      // Drivers with active reservations on other jobs
      const { data: reservedJobs } = await supabase
        .from("jobs")
        .select("reserved_driver_id")
        .not("reserved_driver_id", "is", null)
        .gte("reservation_expires_at", new Date().toISOString());

      (reservedJobs ?? []).forEach((j) => {
        if (j.reserved_driver_id && (!currentJobId || true)) {
          // We include all reserved drivers; the current job's reservation is fine to exclude
          exclude.add(j.reserved_driver_id);
        }
      });

      // Drivers with pending offers on other jobs
      const { data: pendingOffers } = await supabase
        .from("dispatch_offers")
        .select("driver_id, job_id")
        .eq("offer_status", "pending");

      (pendingOffers ?? []).forEach((o) => {
        if (o.job_id !== currentJobId) {
          exclude.add(o.driver_id);
        }
      });

      // Drivers with active assigned jobs
      const { data: activeJobs } = await supabase
        .from("jobs")
        .select("assigned_driver_id")
        .not("assigned_driver_id", "is", null)
        .in("job_status", ["driver_assigned", "driver_enroute", "driver_arrived", "vehicle_loaded", "service_in_progress"] as any);

      (activeJobs ?? []).forEach((j) => {
        if (j.assigned_driver_id) exclude.add(j.assigned_driver_id);
      });

      return exclude;
    },
    enabled: !!currentJobId,
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Dispatch Recommendation (read-only ranking)
// ---------------------------------------------------------------------------

export function useDispatchRecommendation(jobId: string | null) {
  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: drivers, isLoading: driversLoading } = useDrivers();
  const { data: trucks, isLoading: trucksLoading } = useTrucks();
  const { data: incidentTypes, isLoading: incidentLoading } = useIncidentTypes();
  const { data: truckTypes } = useTruckTypes();
  const { data: equipment } = useEquipment();
  const { data: recentOfferCounts } = useRecentOfferCounts();
  const { data: excludedDriverIds } = useExcludedDriverIds(jobId);

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

    const effectiveJob = (!job.required_truck_type_id && classification?.truckTypeId)
      ? { ...job, required_truck_type_id: classification.truckTypeId }
      : job;

    const eligibleTrucks = matchTruckCapability(effectiveJob, trucks);
    const eligible = filterEligibleDrivers(effectiveJob, drivers, eligibleTrucks, 60, {
      excludeDriverIds: excludedDriverIds,
    });
    const rankedDrivers = rankDrivers(eligible, effectiveJob, eligibleTrucks, {
      recentOfferCounts: recentOfferCounts ?? new Map(),
      requiredTruckTypeId: effectiveJob.required_truck_type_id ?? undefined,
    });

    return {
      validationResult,
      classification,
      eligibleTrucks,
      eligibleDrivers: eligible,
      rankedDrivers,
      truckTypes: (truckTypes ?? []) as TruckType[],
      equipment: (equipment ?? []) as Equipment[],
    };
  }, [job, drivers, trucks, incidentTypes, truckTypes, equipment, recentOfferCounts, excludedDriverIds]);

  return { ...result, job, isLoading };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WAVE_SIZE = 5;
const MAX_WAVES = 2;
const COOLDOWN_MINUTES = 5;
const OFFER_EXPIRY_SECONDS = 60;

// ---------------------------------------------------------------------------
// Auto Dispatch Offer — sends to next eligible driver
// ---------------------------------------------------------------------------

export function useAutoDispatchOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      drivers,
      trucks,
      incidentTypes,
      truckTypes,
    }: {
      jobId: string;
      drivers: Driver[];
      trucks: Truck[];
      incidentTypes: any[];
      truckTypes: TruckType[];
    }) => {
      // 1. Get job
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .select("*")
        .eq("job_id", jobId)
        .single();
      if (jobErr || !job) throw new Error("Job not found");

      // 2. Get all existing offers for this job (attempted drivers)
      const { data: existingOffers } = await supabase
        .from("dispatch_offers")
        .select("*")
        .eq("job_id", jobId);

      const attemptedDriverIds = new Set((existingOffers ?? []).map((o) => o.driver_id));
      const attemptCount = attemptedDriverIds.size;
      const currentWave = attemptCount < WAVE_SIZE ? 1 : 2;
      const waveAttempt = currentWave === 1 ? attemptCount + 1 : attemptCount - WAVE_SIZE + 1;

      // Safety: abort if there's already a pending offer for this job
      const activePending = (existingOffers ?? []).find((o) => o.offer_status === "pending");
      if (activePending) {
        return {
          escalated: false,
          offer: activePending,
          wave: currentWave,
          waveAttempt,
          totalAttempts: attemptCount,
          driverName: null,
          alreadyPending: true,
        };
      }

      // Check if max attempts reached
      if (attemptCount >= WAVE_SIZE * MAX_WAVES) {
        return await escalateJob(jobId, job);
      }

      // 3. Get cooldown drivers (declined/expired in last 5 min across all jobs)
      const cooldownTime = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();
      const { data: recentOffers } = await supabase
        .from("dispatch_offers")
        .select("driver_id")
        .in("offer_status", ["declined", "expired"] as any)
        .gte("created_at", cooldownTime);

      const cooldownDriverIds = new Set((recentOffers ?? []).map((o) => o.driver_id));

      // 4. Rank eligible drivers using existing engine
      const classification = classifyIncident(job as any, incidentTypes);
      const effectiveJob = (!job.required_truck_type_id && classification?.truckTypeId)
        ? { ...job, required_truck_type_id: classification.truckTypeId }
        : job;

      const eligibleTrucks = matchTruckCapability(effectiveJob as any, trucks);
      const eligible = filterEligibleDrivers(effectiveJob as any, drivers, eligibleTrucks);
      const ranked = rankDrivers(eligible, effectiveJob as any, eligibleTrucks);

      // 5. Filter out attempted + cooldown drivers
      const available = ranked.filter(
        (r) => !attemptedDriverIds.has(r.driver.driver_id) && !cooldownDriverIds.has(r.driver.driver_id)
      );

      if (available.length === 0) {
        // If we're in wave 1 and no more drivers, check if wave 2 is possible
        if (currentWave === 1 && attemptCount < WAVE_SIZE) {
          // No eligible drivers at all — escalate
          return await escalateJob(jobId, job);
        }
        // Wave boundary or exhaustion
        if (attemptCount >= WAVE_SIZE * MAX_WAVES || available.length === 0) {
          return await escalateJob(jobId, job);
        }
      }

      // 6. Pick top driver
      const pick = available[0];
      const expiresAt = new Date(Date.now() + OFFER_EXPIRY_SECONDS * 1000).toISOString();

      // 7. Create offer
      const { data: offer, error: offerErr } = await supabase
        .from("dispatch_offers")
        .insert({
          job_id: jobId,
          driver_id: pick.driver.driver_id,
          truck_id: pick.truck.truck_id,
          offer_status: "pending",
          expires_at: expiresAt,
        })
        .select()
        .single();
      if (offerErr) throw offerErr;

      // 8. Update job — set reservation + status
      await supabase
        .from("jobs")
        .update({
          job_status: "driver_offer_sent" as any,
          dispatch_attempt_count: attemptCount + 1,
          reserved_driver_id: pick.driver.driver_id,
          reservation_expires_at: expiresAt,
        } as any)
        .eq("job_id", jobId);

      // 9. Create events
      await createAuditAndEvent(jobId, {
        auditActionType: `Offer sent to driver ${pick.driver.driver_name} (Wave ${currentWave}, attempt ${waveAttempt})`,
        auditEventType: "offer_sent",
        auditEventSource: "dispatch_engine",
        eventType: "offer_sent",
        eventCategory: "dispatch",
        message: `Offer sent to driver ${pick.driver.driver_name}`,
        newValue: { driver_id: pick.driver.driver_id, wave: currentWave, attempt: waveAttempt },
      });

      // 10. Fire-and-forget SMS notification to driver
      supabase.functions
        .invoke("send-driver-sms", {
          body: { offerId: offer.offer_id, jobId, driverId: pick.driver.driver_id },
        })
        .then((res) => {
          if (res.error) console.error("SMS send failed:", res.error);
          else console.log("SMS sent to driver", pick.driver.driver_name);
        })
        .catch((err) => console.error("SMS invoke error:", err));

      return {
        escalated: false,
        offer,
        wave: currentWave,
        waveAttempt,
        totalAttempts: attemptCount + 1,
        driverName: pick.driver.driver_name,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

async function escalateJob(jobId: string, job: any) {
  await supabase
    .from("jobs")
    .update({ job_status: "reassignment_required" as any })
    .eq("job_id", jobId);

  await createAuditAndEvent(jobId, {
    auditActionType: "Automatic driver offer attempts exhausted after two waves",
    auditEventType: "reassignment_requested",
    auditEventSource: "dispatch_engine",
    eventType: "offers_exhausted",
    eventCategory: "exception",
    message: "Automatic driver offer attempts exhausted after two waves. Administrator review required.",
    oldValue: { job_status: job.job_status, dispatch_attempt_count: job.dispatch_attempt_count },
    newValue: { job_status: "reassignment_required" },
  });

  await supabase.from("job_events" as any).insert([{
    job_id: jobId,
    event_type: "customer_update",
    event_category: "customer_update",
    message: "We are working to assign a driver to your job. Please stand by.",
  }] as any);

  return { escalated: true, offer: null, wave: 2, waveAttempt: 5, totalAttempts: 10, driverName: null };
}

// ---------------------------------------------------------------------------
// Accept Dispatch Offer
// ---------------------------------------------------------------------------

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

      // Expire all other pending offers
      await supabase
        .from("dispatch_offers")
        .update({ offer_status: "expired" as any })
        .eq("job_id", jobId)
        .neq("offer_id", offerId)
        .eq("offer_status", "pending");

      // Assign driver — move to payment_authorization_required
      const { error: jobErr } = await supabase
        .from("jobs")
        .update({
          assigned_driver_id: driverId,
          assigned_truck_id: truckId,
          job_status: "payment_authorization_required" as any,
        })
        .eq("job_id", jobId);
      if (jobErr) throw jobErr;

      await createAuditAndEvent(jobId, {
        auditActionType: `Status: ${oldStatus} → payment_authorization_required`,
        auditEventType: "driver_assigned",
        auditEventSource: "offer_screen",
        eventType: "driver_accepted",
        eventCategory: "dispatch",
        message: "Driver accepted job — payment authorization required",
        oldValue: { job_status: oldStatus },
        newValue: { job_status: "payment_authorization_required", assigned_driver_id: driverId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Decline Dispatch Offer — then auto-advance
// ---------------------------------------------------------------------------

export function useDeclineDispatchOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      offerId,
      jobId,
      driverId,
      driverName,
      autoAdvanceFn,
    }: {
      offerId: string;
      jobId: string;
      driverId: string;
      driverName?: string;
      autoAdvanceFn?: () => Promise<any>;
    }) => {
      // Decline this offer
      const { error } = await supabase
        .from("dispatch_offers")
        .update({ offer_status: "declined" as any })
        .eq("offer_id", offerId);
      if (error) throw error;

      // Clear reservation
      await supabase
        .from("jobs")
        .update({ reserved_driver_id: null, reservation_expires_at: null } as any)
        .eq("job_id", jobId);

      await createAuditAndEvent(jobId, {
        auditActionType: `Offer declined by driver ${driverName || driverId.slice(0, 8)}`,
        auditEventType: "offer_responded",
        auditEventSource: "offer_screen",
        eventType: "offer_declined",
        eventCategory: "dispatch",
        message: `Driver ${driverName || "unknown"} declined job offer`,
      });

      // Auto-advance to next driver
      if (autoAdvanceFn) {
        return await autoAdvanceFn();
      }

      return { autoAdvanced: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Expire Dispatch Offer — then auto-advance
// ---------------------------------------------------------------------------

export function useExpireDispatchOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      offerId,
      jobId,
      driverId,
      driverName,
      autoAdvanceFn,
    }: {
      offerId: string;
      jobId: string;
      driverId: string;
      driverName?: string;
      autoAdvanceFn?: () => Promise<any>;
    }) => {
      const { error } = await supabase
        .from("dispatch_offers")
        .update({ offer_status: "expired" as any })
        .eq("offer_id", offerId);
      if (error) throw error;

      // Clear reservation
      await supabase
        .from("jobs")
        .update({ reserved_driver_id: null, reservation_expires_at: null } as any)
        .eq("job_id", jobId);

      await createAuditAndEvent(jobId, {
        auditActionType: `Offer expired for driver ${driverName || driverId.slice(0, 8)}`,
        auditEventType: "offer_responded",
        auditEventSource: "offer_screen",
        eventType: "offer_expired",
        eventCategory: "dispatch",
        message: `Driver ${driverName || "unknown"} offer expired`,
      });

      // Auto-advance to next driver
      if (autoAdvanceFn) {
        return await autoAdvanceFn();
      }

      return { autoAdvanced: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_offers"] });
      queryClient.invalidateQueries({ queryKey: ["job_events"] });
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
    },
  });
}

// Re-export for backward compatibility
export { useCreateDispatchOffer } from "@/hooks/useDispatchEngineCompat";
