

# RIN Prompt 2 — Dispatch Decision Engine (Adjusted)

## Database Migration

### Add columns to `jobs`
- `dispatch_priority_score` numeric, nullable
- `dispatch_attempt_count` integer, default 0

### Add GPS to `drivers`
- `gps_lat` numeric(10,7), `gps_long` numeric(10,7)
- Seed all 10 drivers with sample Toronto-area coordinates

### Add enum values to `job_status`
- `dispatch_recommendation_ready`
- `driver_offer_prepared`

## New File: `src/lib/dispatchEngine.ts`
Pure functions, no React. Six modules:

1. **`validateJobForDispatch(job)`** — checks 9 required fields (`incident_type_id`, `pickup_location`, `gps_lat`, `gps_long`, `vehicle_make`, `vehicle_model`, `vehicle_year`, `can_vehicle_roll`, `location_type`). Returns `{ valid, missingFields[] }`. Does NOT change job status — validation is display-only until operator clicks confirm.

2. **`classifyIncident(job, incidentTypes)`** — looks up `default_truck_type_id`, `requires_special_equipment`, `complexity_level` from `incident_types` by `incident_type_id`. Returns classification object. Schema already uses `truck_type_id` UUIDs consistently (jobs, trucks, incident_types all FK to `truck_types`), so no changes needed.

3. **`matchTruckCapability(job, trucks)`** — filters trucks where `truck_type_id` matches job's `required_truck_type_id` AND `status = 'available'`.

4. **`filterEligibleDrivers(job, drivers, eligibleTrucks, minReliability=60)`** — filters by `availability_status = 'available'`, Haversine distance <= `service_radius_km`, `reliability_score > minReliability`. Haversine is isolated in a single `haversineDistanceKm()` helper clearly marked as a placeholder for future Google routing API.

5. **`estimateETA(driverLat, driverLng, jobLat, jobLng)`** — `haversineDistanceKm(...) / 0.8` = ETA minutes. Marked as placeholder. Uses the same isolated Haversine helper.

6. **`rankDrivers(eligibleDrivers, job, trucks)`** — weighted score: 0.4 proximity (inverse distance normalized), 0.3 rating (normalized to 5), 0.2 reliability (normalized to 100), 0.1 workload balance. **Workload balance**: uses a flat 0.5 neutral score for all drivers (no synthetic data), clearly commented as placeholder for future job-count-based balancing. Returns sorted array with scores and ETAs, or empty array if no eligible drivers.

## New Hook: `src/hooks/useDispatchEngine.ts`
- **`useDispatchRecommendation(jobId)`** — orchestrates all 6 modules using data from existing hooks (`useJob`, `useDrivers`, `useTrucks`, `useIncidentTypes`). Returns `{ validationResult, classification, eligibleTrucks, rankedDrivers, isLoading }`.
- **`useCreateDispatchOffer()`** — mutation inserting into `dispatch_offers` with `offer_status='pending'`, `expires_at` = now + 15 min. Writes audit log with `event_type='offer_sent'`, `event_source='matching_screen'`. Increments `dispatch_attempt_count` on the job.

## Screen Updates

### `IncidentValidation.tsx`
- Auto-run `validateJobForDispatch` on load for display only
- Show validation card: missing fields in red, complete fields in green checkmarks
- "Mark for Validation" button removed — replaced with clear status indicator
- "Confirm & Ready for Dispatch" button enabled only when all 9 fields present; on click sets `job_status = 'ready_for_dispatch'` and writes audit log (`event_type='status_changed'`, `event_source='validation_screen'`, action: "Validation confirmed")

### `DispatchDecision.tsx`
- Show incident classification: required truck type name, required equipment names, complexity level
- Show eligible truck count and eligible driver count
- "Run Dispatch Recommendation" button: updates `job_status` to `dispatch_recommendation_ready`, writes audit log (`event_type='status_changed'`, `event_source='dispatch_screen'`, action: "Dispatch recommendation run")
- Replace placeholder card with live data

### `DriverMatching.tsx`
- Show ranked driver list from `rankDrivers`: name, company, rating, reliability, ETA (min), priority score
- Clear **"No eligible drivers found"** empty state when ranked list is empty — no "Prepare Offer" buttons shown
- "Prepare Offer" button per driver row (only when drivers exist): creates `dispatch_offers` row, writes audit log (`event_type='offer_sent'`), updates `job_status` to `driver_offer_prepared`
- Remove placeholder card

### `src/types/rin.ts`
- Add `dispatch_recommendation_ready` and `driver_offer_prepared` to `JOB_STATUS_LABELS` and `JOB_STATUS_COLORS`
- Add `DispatchOfferInsert` type alias

## Audit Logging Coverage
All five actions produce audit entries:
1. Validation confirmed → `status_changed` / `validation_screen`
2. Dispatch recommendation run → `status_changed` / `dispatch_screen`
3. Job status changes (existing, already works)
4. Dispatch offer created → `offer_sent` / `matching_screen`
5. All existing audit paths unchanged

## Summary
- 1 migration (jobs columns, driver GPS + seed, 2 enum values)
- 1 new file: `dispatchEngine.ts` (~120 lines, pure functions)
- 1 new hook file: `useDispatchEngine.ts`
- 3 screen rewrites: Validation, Dispatch, Matching
- Types update

