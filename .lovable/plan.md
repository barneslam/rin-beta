

# Fix: Auto-Dispatch Handoff for Customer-Created Jobs

## Problem
Customer intake creates jobs with `intake_started` status. The dispatch pipeline (`useAutoDispatchOffer`) only runs when a dispatcher manually triggers it from the dispatcher UI. No automatic handoff exists.

## Root Cause
`useAutoDispatchOffer` is the existing shared dispatch function. It already handles classification, truck matching, driver ranking, and offer creation. But customer intake pages never call it — they just create the job and navigate away.

## Solution

### 1. New: `src/hooks/useAutoDispatchPipeline.ts`
A thin wrapper hook that:
- Accepts a `jobId`
- Fetches reference data (drivers, trucks, incidentTypes, truckTypes) from Supabase directly (not via React Query hooks, since this runs inside a mutation)
- Classifies the incident and updates the job with `required_truck_type_id` + status `ready_for_dispatch`
- Calls the same `useAutoDispatchOffer` mutation with the fetched data
- Returns the dispatch result

This reuses the **exact same** `useAutoDispatchOffer` logic already used by the dispatcher UI.

### 2. Modify: `src/pages/CustomerChatIntake.tsx`
In `handleToolCall`, after `createJob.mutateAsync`:
- Call `autoDispatch.mutateAsync(job.job_id)` 
- Then navigate to `/track/:jobId`

### 3. Modify: `src/pages/CustomerFormIntake.tsx`  
In `handleSubmit`, after `createJob.mutateAsync`:
- Call `autoDispatch.mutateAsync(job.job_id)`
- Then navigate to `/track/:jobId`

### 4. Modify: `src/pages/CustomerTracking.tsx`
- Add `refetchInterval: 5000` to the `useJob` query so the stepper auto-advances as dispatch progresses
- Show assigned driver name when available (fetch from drivers table)

## Flow After Fix
```text
Customer submits → createJob(intake_started) → autoDispatch:
  1. classify incident → set required_truck_type_id
  2. update job → ready_for_dispatch  
  3. useAutoDispatchOffer → rank drivers → send offer → driver_offer_sent
  4. navigate to /track/:jobId (stepper shows "Finding a Driver")
  
Timer expires / driver responds → existing dispatcher pipeline continues
```

## Files
| File | Action |
|------|--------|
| `src/hooks/useAutoDispatchPipeline.ts` | New — thin orchestration hook |
| `src/pages/CustomerChatIntake.tsx` | Add autoDispatch call after job creation |
| `src/pages/CustomerFormIntake.tsx` | Add autoDispatch call after job creation |
| `src/pages/CustomerTracking.tsx` | Add polling + driver info display |

No database changes needed.

