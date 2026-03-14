

# Driver Offer, Acceptance Simulation & Job Tracking Workflow

## Database Migration

Add two missing `job_status` enum values for tracking stages:
- `driver_arrived`
- `vehicle_loaded`

No new tables needed — `dispatch_offers` and `jobs` already have the required columns.

## Code Changes

### 1. `src/types/rin.ts`
Add `driver_arrived` and `vehicle_loaded` to `JOB_STATUS_LABELS` and `JOB_STATUS_COLORS`.

### 2. `src/pages/DriverOffer.tsx` — Full rework
Replace the placeholder page with a functional offer management screen:
- Show all offers for the active job with driver details (name, ETA, rating, reliability, offer timestamp)
- For each `pending` offer, show **Accept Offer** and **Decline Offer** buttons
- **Accept**: update `dispatch_offers.offer_status = 'accepted'`, set `jobs.assigned_driver_id`, `jobs.assigned_truck_id`, `jobs.job_status = 'driver_assigned'`, create audit log
- **Decline**: update `dispatch_offers.offer_status = 'declined'`, create audit log, show toast suggesting to return to matching
- Remove the placeholder "Offer Distribution Engine" card

### 3. `src/hooks/useDispatchEngine.ts` — Add acceptance/decline mutations
Add two new mutations:
- `useAcceptDispatchOffer()`: updates offer status, assigns driver+truck to job, sets status to `driver_assigned`, writes audit log
- `useDeclineDispatchOffer()`: updates offer status to `declined`, writes audit log

### 4. `src/pages/JobTracking.tsx` — Add manual status progression
Replace the static status display with a tracking stages UI:
- Show 5 stages as a vertical stepper: Driver Assigned → Driver En Route → Driver Arrived → Vehicle Loaded → Job Completed
- Highlight the current stage based on `job.job_status`
- Show a **Next Status** button that advances to the next stage (updates `jobs.job_status` + audit log)
- Keep the existing driver info card, ETA card, and audit timeline

### 5. `src/hooks/useReferenceData.ts`
No changes needed — `useDispatchOffers` and `useDrivers` already exist and are sufficient.

## Technical Notes
- The `useCreateDispatchOffer` in `useDispatchEngine.ts` already sets `job_status = 'driver_offer_prepared'` and creates audit logs — this stays as-is
- The DriverOffer page will join offers with drivers data client-side (same pattern already used)
- Tracking status progression array: `['driver_assigned', 'driver_enroute', 'driver_arrived', 'vehicle_loaded', 'job_completed']`

