# RIN — Claude Code Audit Log

Roadside Intelligence Network (RIN) — Development session log maintained for audit and traceability purposes.
Supabase Project: `zyoszbmahxnfcokuzkuv`
GitHub Repo: `https://github.com/barneslam/rin-beta`

---

## Session: 2026-03-29

### Summary
Multi-session development sprint covering dispatch flow fixes, SMS notification gaps, and job completion lifecycle.

---

### Changes Made

#### 1. `accept-driver-offer` — Redeployed as v15
**Problem:** Function was running v13 in production. v14 was never deployed, so driver confirmation SMS (Section 7) never fired after offer acceptance.
**Fix:** Redeployed with explicit phone logging, phone validity check, and full driver confirmation SMS (service, vehicle, pickup, payout, ARRIVED/DONE instructions).

---

#### 2. `send-customer-confirmation` — Redeployed as v18
**File:** `supabase/functions/send-customer-confirmation/index.ts`
**Problem:** First customer confirmation SMS was missing `can_vehicle_roll` field and had no web confirmation link.
**Fix:** Added `can_vehicle_roll` to DB select, added `/confirm/:jobId` web link, updated SMS body:
```
RIN: We received your roadside request.
Vehicle: {vehicle}
Location: {location}
Issue: {incident}
Can vehicle roll? {Yes/No/Not answered}

Please confirm your details using this link: https://rin-beta.lovable.app/confirm/{jobId}

Or reply YES to confirm as-is, or CANCEL to cancel.
```

---

#### 3. `driver-cancel-at-scene` — Redeployed as v2
**File:** `supabase/functions/driver-cancel-at-scene/index.ts`
**Problems:**
- Hard-failed (500) if Twilio credentials not configured, preventing job status update entirely
- Referenced non-existent `driver_assigned_at` column in DB update
**Fix:**
- Removed hard-fail on missing Twilio creds (graceful skip)
- Removed `driver_assigned_at` from update payload
- Sets `exception_code: "driver_cancelled_at_scene"`, `exception_message: reason`
- Logs `no_compensation: true` in both `job_events` and `audit_logs`
- Customer SMS confirms no charge for the interruption

---

#### 4. `send-amendment-sms` — New function, deployed as v1
**File:** `supabase/functions/send-amendment-sms/index.ts`
**Purpose:** Sends customer SMS requesting approval when dispatcher submits a job amendment.
**Behaviour:**
- Looks up customer phone via `user_id` on the job
- Gracefully skips for dispatcher test jobs (no `user_id`) or invalid phones
- SMS body includes original quote, revised quote, reason, YES/NO instructions
- Called automatically by `useAmendJob` hook after job set to `customer_reapproval_pending`

---

#### 5. DB Migration: `add_pending_completion_approval_status`
**Problem:** `pending_completion_approval` was missing from the `job_status` DB enum. `complete-job` Phase 1 was silently failing on every driver DONE SMS — the status update was rejected by Postgres.
**Fix:** `ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'pending_completion_approval';`

---

#### 6. DB Migration: `add_completed_at_to_jobs`
**Problem:** `complete-job` Phase 2 tried to write `completed_at` on job completion, but the column didn't exist. The DB update failed before any receipt SMS was sent.
**Fix:** `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`

---

#### 7. `src/pages/DriverMatching.tsx`
**Problem:** Jobs in `payment_authorized` status were blocked by the "Pricing must be completed first" gate — `payment_authorized` was not in the allowed status list.
**Fix:** Added `payment_authorized` to `dispatchReadyStatuses`:
```typescript
const dispatchReadyStatuses = ["ready_for_dispatch", "payment_authorized", "driver_offer_sent", "no_driver_candidates"];
```
**Commit:** `c72259d`

---

#### 8. `src/pages/DispatchControlPanel.tsx`
**Problem:** The "Pricing & Payment Bypass" card only showed jobs in `pending_customer_price_approval`, `payment_authorization_required`, and `payment_failed`. Jobs stuck in `payment_authorized` were invisible to the bypass tool.
**Fix:** Added `payment_authorized` to `paymentPendingJobs` filter.
**Also added:** `queryClient.invalidateQueries({ queryKey: ["jobs"] })` + `navigate("/matching")` after bypass so the UI reflects the new status immediately.
**Commit:** `c72259d`

---

#### 9. `src/hooks/useExceptionActions.ts`
**Problem:** `useAmendJob` hook only updated the DB and logged an event — no SMS was sent to the customer about the revised charge.
**Fix:** After the amendment is saved, invokes `send-amendment-sms` edge function with `oldPrice`, `newPrice`, and `reason`.
**Commit:** `d7cb03e`

---

#### 10. `src/pages/JobTracking.tsx` — Multiple fixes
**a) Retry Capture button removed**
Was calling a non-existent `capture-payment` function. Removed all references.

**b) `driver_cancelled_at_scene` alert banner added**
Shows when job status is `driver_cancelled_at_scene`.

**c) `pending_completion_approval` added to `TRACKING_STAGES`**
Ensures the two-phase completion stepper is visible in the UI.

**d) `driver_assigned` added to `TRACKING_STAGES`**
Without this, jobs at `driver_assigned` showed no "Advance to" button, blocking progression.

**e) `handleAdvanceStatus` — Phase 2 routing**
When advancing from `pending_completion_approval` → `job_completed`, the button now calls `complete-job` Phase 2 instead of a direct DB update. This ensures:
- Stripe capture runs (or bypass log for test jobs)
- Customer receives receipt SMS
- Driver receives receipt SMS
**Commit:** `3e63fb4`

**f) Rules of Hooks fix**
`confirmingCompletion` useState was placed after the `if (!job) return` early return, causing a React hooks violation and white screen on all Job Tracking pages.
**Fix:** Moved `useState` declaration above the early return.
**Commit:** `3bfb79c`

---

#### 11. `src/types/rin.ts`
- Added `driver_cancelled_at_scene: "Driver Cancelled at Scene"` to `JOB_STATUS_LABELS`
- Added `driver_cancelled_at_scene: "bg-destructive/25 text-destructive"` to `JOB_STATUS_COLORS`
- `pending_completion_approval: "Awaiting Customer Confirmation"` (added in prior session)

---

### Edge Functions — Current Deployed Versions (as of 2026-03-29)

| Function | Version | Notes |
|---|---|---|
| `accept-driver-offer` | v15 | Driver confirmation SMS with full job details |
| `send-customer-confirmation` | v18 | Includes can_vehicle_roll + confirm web link |
| `driver-cancel-at-scene` | v2 | No hard-fail on Twilio, no driver compensation |
| `send-amendment-sms` | v1 | New — amendment approval SMS to customer |
| `complete-job` | v2 | Two-phase completion with Stripe + receipt SMS |
| `twilio-webhook` | — | Handles DONE, ARRIVED, CANCEL, ADJUST, YES, NO, CONFIRM |
| `driver-adjust-amount` | — | Driver price adjustment on scene |
| `driver-respond` | — | Driver offer response |
| `send-driver-sms` | — | Outbound driver SMS |
| `send-payment-sms` | — | Payment authorization SMS |
| `confirm-payment-authorization` | — | Stripe payment intent confirmation |
| `check-payment-timeout` | — | Expires stale payment jobs |
| `create-dispatch-offer` | — | Creates offer record + sends driver SMS |
| `resolve-dispatch-offer` | — | Resolves offer after accept/decline |
| `set-job-price` | — | Sets estimated price on job |
| `process-intake` | — | Processes voice/chat intake |
| `intake-create-job` | — | Creates job from intake data |

---

### Key Architectural Notes

- **Two-phase job completion:** Driver sends DONE → `pending_completion_approval` → Customer replies CONFIRM → `job_completed` + Stripe capture + receipts
- **`supabaseExternal`** must always be used in frontend code (never internal Supabase client)
- **Twilio trial account restriction:** SMS is queued and returns a SID but will only deliver to verified numbers
- **Dispatcher test jobs** (no `user_id`): customer SMS functions gracefully skip when `user_id` is null
- **Payment bypass:** Sets `stripe_payment_intent_id: bypass_test_{timestamp}` — `complete-job` detects this prefix and skips Stripe capture

---

### Git Commits This Session

| Commit | Description |
|---|---|
| `c72259d` | fix: unblock Driver Matching for payment_authorized jobs |
| `d7cb03e` | feat: send customer SMS on job amendment requesting approval |
| `3e63fb4` | fix: send driver receipt SMS when dispatcher confirms job completion |
| `3bfb79c` | fix: move confirmingCompletion useState above early return (Rules of Hooks) |
| `0b3ca19` | fix: add driver_assigned to tracking stages + completed_at column |
