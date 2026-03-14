

# Dispatch Control Panel + Exception Management

## Database Migration (single migration)

**1. New job_status enum values** (5):
- `customer_reapproval_pending`, `reassignment_required`, `driver_unavailable`, `cancelled_by_customer`, `cancelled_after_dispatch`

**2. New columns on jobs table** (6):
- `cancellation_fee numeric`, `cancelled_reason text`, `cancelled_by text`, `amendment_reason text`, `reassignment_reason text`, `customer_update_message text`

**3. New table: job_events**
- Columns: `event_id uuid PK`, `job_id uuid FK→jobs(job_id)`, `event_type text`, `event_category text`, `event_status text`, `actor_type text`, `actor_id text`, `message text`, `reason text`, `old_value jsonb`, `new_value jsonb`, `created_at timestamptz default now()`
- Indexes on `job_id`, `created_at desc`, `event_category`
- RLS: permissive select + insert for public

**4. New audit_event_type enum values** (5):
- `amendment_requested`, `reassignment_requested`, `driver_unavailable`, `job_cancelled`, `customer_update`

## New Files

### `src/hooks/useJobEvents.ts`
- `useJobEvents(jobId?)` — query by job_id, ordered desc
- `useAllJobEvents()` — recent 50 across all jobs
- `useCreateJobEvent()` — insert mutation
- `createAuditAndEvent()` helper — writes both audit_log + job_event in one call

### `src/hooks/useExceptionActions.ts`
Five hooks, all using `as any` for new enum values:

- **`useAmendJob()`** — updates job fields + sets status to `customer_reapproval_pending` + event + audit + customer update message
- **`useCustomerReapproval()`** — approve: restore to `driver_assigned` if driver exists, else `dispatch_recommendation_ready`; decline: cancel with `cancelled_by_customer`
- **`useRequestReassignment()`** — status `reassignment_required`, preserve old assignment in event old_value, clear driver/truck
- **`useMarkDriverUnavailable()`** — status `driver_unavailable`, preserve old assignment, clear driver/truck
- **`useCancelJob()`** — fee logic (0 before enroute, 2% after, blocked if vehicle_loaded/job_completed), stores fee/reason/by, preserves context in event

### `src/pages/DispatchControlPanel.tsx`
Three-section operations console:
- **Active Jobs Table** with filter tabs (All Active, Awaiting Driver, Driver En Route, Driver Arrived, Exception Queue, Completed). Click row → set activeJobId + navigate to `/tracking`
- **Exception Queue** — jobs with status in `[customer_reapproval_pending, reassignment_required, driver_unavailable, cancelled_after_dispatch]`
- **Customer Update Feed** — recent job_events with `event_category = 'customer_update'`

### `src/components/dispatch/AmendJobDialog.tsx`
Modal: revised truck type (select from truck_types), revised equipment, revised price, amendment reason. After submit, shows approve/decline simulation buttons calling `useCustomerReapproval()`.

### `src/components/dispatch/ReassignmentDialog.tsx`
Modal: reason textarea + confirm. Calls `useRequestReassignment()`.

### `src/components/dispatch/DriverUnavailableDialog.tsx`
Modal: reason textarea + confirm. Calls `useMarkDriverUnavailable()`.

### `src/components/dispatch/CancelJobDialog.tsx`
Modal: reason textarea, shows calculated fee, blocks if vehicle_loaded/job_completed. Calls `useCancelJob()`.

## Modified Files

### `src/types/rin.ts`
- Add 5 new statuses to `JOB_STATUS_LABELS` and `JOB_STATUS_COLORS`
- Add `JobEvent` interface matching job_events table

### `src/pages/JobTracking.tsx`
- Add Operational Controls section below stepper, visible when status is `driver_assigned | driver_enroute | driver_arrived`
- Hidden when `vehicle_loaded | job_completed | cancelled_*`
- Four buttons: Amend Job, Request Reassignment, Mark Driver Unavailable, Cancel Job — each opens its dialog

### `src/App.tsx`
- Add route `/control-panel` → `DispatchControlPanel`

### `src/components/layout/AppSidebar.tsx`
- Add "Control Panel" nav item with `LayoutDashboard` icon in a new sidebar group below Job Flow

### `src/hooks/useReferenceData.ts`
- Add `useJobEventsForFeed()` — recent events where `event_category = 'customer_update'`, limit 50

## What is NOT included
- No dispatch scoring, automated reassignment, driver ranking, or fairness logic
- No SMS/WhatsApp
- No map/ETA integrations

