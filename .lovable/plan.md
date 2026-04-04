

# Add `customer_phone` to Jobs Table

## Root Cause

The phone number is captured in `users.phone` and linked to jobs via `jobs.user_id`. Every SMS function (send-customer-confirmation, send-payment-sms, accept-driver-offer) must do a secondary lookup: `jobs.user_id → users.phone`. This works when the user record exists and has a valid phone, but:

1. **No canonical phone on the job itself** — if the user record is stale, updated, or the join fails, the SMS has no fallback.
2. **Dashboard/tracking has no direct access** — to show the customer phone for a job, you must join through `user_id`.
3. **The `send-customer-confirmation` function receives phone as a request parameter** (not from DB), creating inconsistency.

## Plan

### 1. Add `customer_phone` column to `jobs` table

**Migration**: Add a nullable `text` column `customer_phone` to `public.jobs`.

```sql
ALTER TABLE public.jobs ADD COLUMN customer_phone text;
```

### 2. Write phone into jobs during creation

**File: `src/pages/CustomerFormIntake.tsx`** — Add `customer_phone: processed.caller_phone` to the `createJob.mutateAsync()` call (~line 158).

**File: `supabase/functions/intake-create-job/index.ts`** — Add `customer_phone: phone` to the job insert payload (~line 133). This is the dispatcher/server-side intake path.

### 3. Update SMS functions to read from `jobs.customer_phone`

**File: `supabase/functions/send-customer-confirmation/index.ts`** — Instead of receiving `phone` as a request param, read `customer_phone` from the job row (already fetched on line 52). Fall back to `users.phone` via `user_id` if `customer_phone` is null.

**File: `supabase/functions/send-payment-sms/index.ts`** — Add `customer_phone` to the job select (line 31). Use it first; fall back to the existing `users.phone` lookup only if null.

**File: `supabase/functions/accept-driver-offer/index.ts`** — Same pattern: prefer `customer_phone` from the job row (already fetched), fall back to `users.phone` lookup.

### 4. Dashboard visibility

**File: `src/pages/DispatchControlPanel.tsx`** — Display `customer_phone` in the job detail panel (it comes for free since jobs are fetched with `select("*")`). Add a line showing the phone near the vehicle/location info.

### 5. Backfill existing jobs (one-time)

Run a data update to populate `customer_phone` on existing jobs from their linked user:

```sql
UPDATE public.jobs j
SET customer_phone = u.phone
FROM public.users u
WHERE j.user_id = u.user_id
  AND j.customer_phone IS NULL
  AND u.phone IS NOT NULL;
```

## Files Changed

| File | Change |
|---|---|
| Migration (new) | Add `customer_phone text` column to `jobs` |
| `src/pages/CustomerFormIntake.tsx` | Pass `customer_phone` in job creation |
| `supabase/functions/intake-create-job/index.ts` | Include `customer_phone` in job insert |
| `supabase/functions/send-customer-confirmation/index.ts` | Read phone from job row, fallback to users |
| `supabase/functions/send-payment-sms/index.ts` | Read phone from job row, fallback to users |
| `supabase/functions/accept-driver-offer/index.ts` | Read phone from job row, fallback to users |
| `src/pages/DispatchControlPanel.tsx` | Display customer phone in job detail |
| Data backfill (one-time) | Populate existing jobs from users table |

## Flow After Fix

```text
Intake (form/voice/chat) captures phone
  → findOrCreateUser persists phone in users.phone
  → createJob persists phone in jobs.customer_phone  ← NEW
  → SMS functions read jobs.customer_phone directly
  → Fallback: users.phone via user_id (defense-in-depth)
  → Dashboard shows customer_phone on job detail
```

