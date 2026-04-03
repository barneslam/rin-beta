import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
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
        .in("job_status", ["payment_authorization_required", "driver_enroute", "driver_arrived", "vehicle_loaded", "service_in_progress"] as any);

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
const OFFER_EXPIRY_SECONDS = 120;

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

      // Guard: validate job is ready for dispatch before attempting any offers
      const preValidation = validateJobForDispatch(job as any);
      if (!preValidation.valid) {
        throw new Error(`Job failed dispatch validation — missing: ${preValidation.missingFields.join(", ")}`);
      }

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
        // No attempts yet and no eligible drivers at all — this is a candidate shortage,
        // not an exhaustion. Use no_driver_candidates, not reassignment_required.
        if (attemptCount === 0 && eligible.length === 0) {
          return await noDriverCandidatesJob(jobId, job);
        }
        // All eligible drivers have been attempted or are in cooldown — true exhaustion.
        return await escalateJob(jobId, job);
      }

      // 6. Pick top driver
      const pick = available[0];
      const expiresAt = new Date(Date.now() + OFFER_EXPIRY_SECONDS * 1000).toISOString();

      // 7. Create offer — via server-side Edge Function for audit trail + confirmed persistence
      const { data: createResp, error: createFnErr } = await supabase.functions.invoke(
        "create-dispatch-offer",
        { body: { jobId, driverId: pick.driver.driver_id, truckId: pick.truck.truck_id, expiresAt } }
      );
      if (createFnErr) throw new Error(`create-dispatch-offer failed: ${createFnErr.message}`);
      if (!createResp?.success) throw new Error(`create-dispatch-offer returned error: ${createResp?.error ?? "unknown"} (code: ${createResp?.code ?? "?"})`);

      const offer = createResp.offer;
      console.log(`[DISPATCH] Offer confirmed in DB — offer_id=${offer.offer_id} job_id=${offer.job_id} driver_id=${offer.driver_id} offer_status=${offer.offer_status}`);

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

      // 10. Fire-and-forget SMS notification to driver (offer insert already confirmed above)
      supabase.functions
        .invoke("send-driver-sms", {
          body: { offerId: offer.offer_id, jobId, driverId: pick.driver.driver_id },
        })
        .then((res) => {
          if (res.error) {
            console.error(`[DISPATCH] SMS failed — job_id=${jobId} offer_id=${offer.offer_id} driver_id=${pick.driver.driver_id} error=${res.error.message}`);
          } else {
            console.log(`[DISPATCH] SMS sent — job_id=${jobId} offer_id=${offer.offer_id} driver_id=${pick.driver.driver_id} driver=${pick.driver.driver_name} sid=${res.data?.sid ?? "unknown"}`);
          }
        })
        .catch((err) => console.error(`[DISPATCH] SMS invoke threw — job_id=${jobId} offer_id=${offer.offer_id} error=${err}`));

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

async function noDriverCandidatesJob(jobId: string, job: any) {
  await supabase
    .from("jobs")
    .update({ job_status: "no_driver_candidates" as any })
    .eq("job_id", jobId);

  await createAuditAndEvent(jobId, {
    auditActionType: "No eligible drivers found for this job — no offers sent",
    auditEventType: "reassignment_requested",
    auditEventSource: "dispatch_engine",
    eventType: "no_driver_candidates",
    eventCategory: "exception",
    message: "No eligible drivers exist for this job. Review truck type, equipment, or driver availability.",
    oldValue: { job_status: job.job_status },
    newValue: { job_status: "no_driver_candidates" },
  });

  return { escalated: true, offer: null, wave: 1, waveAttempt: 0, totalAttempts: 0, driverName: null, noDriverCandidates: true };
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
// Accept Dispatch Offer — delegates to shared accept-driver-offer edge function
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
      const { data, error } = await supabase.functions.invoke("accept-driver-offer", {
        body: { offerId, source: "dispatcher" },
      });

      if (error) throw new Error(error.message || "Acceptance failed");
      if (!data?.success) throw new Error(data?.error || "Acceptance failed");

      return data;
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
      // Server-side: offer status update, reservation clear, and audit event
      const { data, error } = await supabase.functions.invoke("resolve-dispatch-offer", {
        body: { offerId, jobId, driverId, resolution: "declined", driverName },
      });
      if (error) throw new Error(error.message || "resolve-dispatch-offer failed");
      if (!data?.success) throw new Error(data?.error || "resolve-dispatch-offer failed");

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
      // Server-side: offer expiry, no_response_count increment, reservation clear, and audit event
      const { data, error } = await supabase.functions.invoke("resolve-dispatch-offer", {
        body: { offerId, jobId, driverId, resolution: "expired", driverName },
      });
      if (error) throw new Error(error.message || "resolve-dispatch-offer failed");
      if (!data?.success) throw new Error(data?.error || "resolve-dispatch-offer failed");

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
