

# Fix Driver Matching — Truck Type Fallback + Debug Info

## Root Cause
`matchTruckCapability(job, trucks)` returns empty when `job.required_truck_type_id` is null. While intake sets this from `selectedIncident.default_truck_type_id`, if it wasn't set (or job was created before that logic existed), matching fails silently. The classification module correctly resolves the UUID but it's never used as a fallback for truck matching.

## Changes

### 1. `src/hooks/useDispatchEngine.ts`
Before calling `matchTruckCapability`, check if `job.required_truck_type_id` is null. If so, use `classification?.truckTypeId` as a fallback by creating a patched job object:

```ts
const effectiveJob = (!job.required_truck_type_id && classification?.truckTypeId)
  ? { ...job, required_truck_type_id: classification.truckTypeId }
  : job;
const eligibleTrucks = matchTruckCapability(effectiveJob, trucks);
```

This keeps `dispatchEngine.ts` pure — the fallback logic lives in the hook.

### 2. `src/pages/DriverMatching.tsx`
Add a temporary debug card at the top showing:
- `required_truck_type_id` from job (raw UUID)
- Resolved truck type name from `truckTypes`
- Classification `truckTypeId` (if different)
- Eligible trucks count
- Eligible drivers count (before ranking)

Styled as a muted/outline card with monospace text, labeled "Debug — Dispatch Pipeline".

No database changes needed.

