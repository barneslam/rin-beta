

# Automatic Driver-Offer Routing + Two-Wave Retry

## What's New vs. Existing

The exception management, cancellation logic, control panel, and job events already exist and work correctly. The **only major new feature** is the automatic driver-offer engine with two-wave retry. Minor cleanup: stop writing `customer_update_message` to the jobs table (use job_events instead).

## Architecture

The automatic routing runs entirely client-side in hooks. No edge function needed for MVP — the offer cycle advances when the dispatcher clicks Decline or when an offer is manually expired.

```text
DriverMatching → "Start Automatic Dispatch" button
        ↓
useAutoDispatchCycle() kicks off Wave 1
        ↓
Sends offer to driver #1 (top-ranked)
        ↓
DriverOffer page shows current offer + history
        ↓
Accept → assign driver, stop cycle
Decline/Expire → auto-send to next driver in wave
        ↓
Wave 1 exhausted (5 drivers) → auto-start Wave 2
        ↓
Wave 2 exhausted (5 more) → escalate to reassignment_required
```

## No Database Migration Needed

All required enum values and columns already exist. The `dispatch_offers` table already tracks which drivers have been attempted per job. No new tables or columns needed.

## Code Changes

### 1. `src/hooks/useDispatchEngine.ts` — Major rework

**New: `useAutoDispatchOffer()`** — core mutation that:
- Queries all existing `dispatch_offers` for the job to get attempted driver IDs
- Determines current wave (attempts 1-5 = Wave 1, 6-10 = Wave 2)
- Calls `rankDrivers()` from `dispatchEngine.ts`, filters out already-attempted drivers and drivers with a decline/expire in the last 5 minutes (cooldown)
- Picks the top-ranked remaining driver
- Creates the offer (`offer_status = pending`, `expires_at = now + 15min`)
- Creates job_event: "Offer sent to driver [name]"
- Updates `dispatch_attempt_count` on the job
- If no eligible drivers remain in the current wave AND wave < 2, logs wave completion and continues to wave 2
- If both waves exhausted (10 attempts or no more eligible drivers), sets `job_status = reassignment_required`, creates escalation job_event + audit_log, returns `{ escalated: true }`

**Rework: `useDeclineDispatchOffer()`**:
- After declining the current offer, automatically calls the auto-dispatch logic to send to the next driver
- Creates job_event: "Driver declined job offer"
- If auto-dispatch returns `escalated: true`, surface that in the UI

**New: `useExpireDispatchOffer()`**:
- Marks offer as `expired`
- Creates job_event: "Driver offer expired"
- Triggers auto-dispatch to next driver (same logic as decline)

**Keep existing**: `useAcceptDispatchOffer()` stays mostly the same — accept, expire others, assign driver, create events. Add a job_event for "Driver accepted job".

### 2. `src/pages/DriverMatching.tsx` — Add "Start Automatic Dispatch" button

Replace individual "Prepare Offer" buttons with a single **"Start Automatic Dispatch"** button at the top of the ranked drivers list. This button:
- Creates the first offer to the #1 ranked driver
- Sets `job_status = driver_offer_sent`
- Navigates to `/offer` to monitor the cycle

Keep the ranked drivers list as read-only for visibility.

### 3. `src/pages/DriverOffer.tsx` — Rework as monitoring + action page

Show:
- **Current active offer** (the pending one) prominently at top with driver info, ETA, timer showing time remaining until expiry
- **Offer history** below — all past offers for this job with status badges (declined, expired, accepted)
- **Wave indicator**: "Wave 1 — Attempt 3 of 5" or "Wave 2 — Attempt 2 of 5"
- **Actions on current pending offer**: Accept, Decline, Mark Expired
- On Decline/Expire: auto-advance fires, page refreshes to show next offer
- If escalated: show message "All automatic attempts exhausted. Job moved to Exception Queue." with link to control panel

### 4. `src/hooks/useExceptionActions.ts` — Minor cleanup

Remove all `customer_update_message` field writes from the job update calls (lines writing to `customer_update_message`). Customer messaging is already handled by job_events.

### 5. `src/types/rin.ts` — No changes needed

All statuses already defined.

## Cooldown Implementation

The 5-minute cooldown is derived from `dispatch_offers` — when selecting the next driver, filter out any driver who has a `declined` or `expired` offer with `created_at` within the last 5 minutes across ALL jobs (not just this one). This prevents driver spam without new schema.

## Fair Rotation

One attempt per driver per dispatch cycle is enforced by querying `dispatch_offers WHERE job_id = X` and excluding those `driver_id` values from the eligible pool.

## Files Summary

| File | Action |
|------|--------|
| `src/hooks/useDispatchEngine.ts` | Major rework — add auto-dispatch cycle, rework decline/expire |
| `src/pages/DriverMatching.tsx` | Replace per-driver "Prepare Offer" with "Start Automatic Dispatch" |
| `src/pages/DriverOffer.tsx` | Rework as monitoring page with wave indicator + auto-advance |
| `src/hooks/useExceptionActions.ts` | Remove `customer_update_message` writes |

## What is NOT included
- No real-time offer expiry timer (would need a backend cron/scheduled function)
- No SMS/push notifications to drivers
- No automated driver response simulation
- No dispatch scoring or ranking changes
- Offer expiry is manual (dispatcher clicks "Mark Expired") for MVP

