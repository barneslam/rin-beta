

# Driver Offer, Acceptance & Job Tracking — Adjusted Plan

## Database Migration

Add `driver_arrived` and `vehicle_loaded` to the `job_status` enum. No new tables needed. The `offer_status` enum already has `expired`.

```sql
ALTER TYPE job_status ADD VALUE 'driver_arrived';
ALTER TYPE job_status ADD VALUE 'vehicle_loaded';
```

## Code Changes

### 1. `src/types/rin.ts`
Add `driver_arrived` and `vehicle_loaded` to `JOB_STATUS_LABELS` and `JOB_STATUS_COLORS`.

### 2. `src/hooks/useDispatchEngine.ts` — Add 2 mutations

**`useAcceptDispatchOffer()`**:
- Update offer to `accepted`
- Set `jobs.assigned_driver_id`, `assigned_truck_id`, `job_status = 'driver_assigned'`
- **Expire all other pending offers** for the same job (`UPDATE dispatch_offers SET offer_status = 'expired' WHERE job_id = X AND offer_id != Y AND offer_status = 'pending'`)
- Audit log with explicit `old_value: { job_status: old }` and `new_value: { job_status: 'driver_assigned' }`

**`useDeclineDispatchOffer()`**:
- Update offer to `declined`
- Audit log
- **Check if any pending offers remain** for the job. If none remain and no driver is assigned, reset `job_status` to `dispatch_recommendation_ready` with an audit log recording the transition

### 3. `src/pages/DriverOffer.tsx` — Full rework
- Show all offers for the active job with driver name, ETA, rating, reliability, offer timestamp
- For `pending` offers: show **Accept** and **Decline** buttons
- **Disable Accept** on all offers if `job.assigned_driver_id` is already set (adjustment #6)
- On Accept: call `useAcceptDispatchOffer`
- On Decline: call `useDeclineDispatchOffer`, toast suggesting return to matching if all offers exhausted

### 4. `src/pages/JobTracking.tsx` — Conditional stepper
- **Before driver assigned**: show message "Tracking begins once a driver offer is accepted" (adjustment #4)
- **After driver assigned**: show vertical stepper with 5 stages: `driver_assigned` → `driver_enroute` → `driver_arrived` → `vehicle_loaded` → `job_completed`
- **Next Status** button advances to next stage, updates `job_status` with audit log recording `old_value: { job_status: X }` and `new_value: { job_status: Y }` (adjustment #5)
- Keep existing driver info, ETA card, and audit timeline

### 5. Audit log format (adjustment #5)
All status transitions will record:
```ts
old_value: { job_status: previousStatus }
new_value: { job_status: newStatus }
```

## No changes needed
- `src/hooks/useReferenceData.ts` — existing hooks sufficient
- `src/lib/dispatchEngine.ts` — pure logic unchanged
- `src/pages/DriverMatching.tsx` — already has Prepare Offer button

