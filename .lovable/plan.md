

# End-to-End Lifecycle Validation Plan

## Lifecycle Steps and Expected Behavior

```text
Step  Status Flow                              Trigger
───── ──────────────────────────────────────── ─────────────────────────────
  1   ready_for_dispatch                       (precondition — use dev bypass or existing job)
  2   dispatch_recommendation_ready            Match Drivers button → match-drivers-for-job
  3   driver_offer_sent                        Start Dispatch → start-dispatch-offers → create-next-dispatch-offer → send-driver-offer
  4   dispatch_offers record created           (created in step 3, visible in dashboard)
  5   Driver offer page loads                  /driver/offer/:offerId?token=xxx
  6   Accept before expiry                     driver-respond → accept-driver-offer
  7   payment_authorization_required           (set by accept-driver-offer)
  8   Customer tracking updates                /track/:jobId shows new status + events
  9   Completion path                          complete-job (two-phase)
```

## Known Blocker: SMS Failure Breaks Status Transition

**Critical finding**: The `send-driver-offer` function only updates `job_status → driver_offer_sent` **after successful Twilio SMS delivery** (line 229-238). If SMS fails (invalid phone, Twilio error, missing creds), the function returns early and the job stays in `dispatch_recommendation_ready`.

Later, when a driver accepts via the web link, `accept-driver-offer` checks `VALID_ACCEPT_STATES = ["ready_for_dispatch", "driver_offer_sent"]` (line 122). Since `dispatch_recommendation_ready` is not in this list, **acceptance is blocked with a 409 error**.

This means: if Twilio SMS fails for any reason, the entire dispatch flow is dead-ended.

### Fix Required (in `send-driver-offer/index.ts`)

Move the `job_status → driver_offer_sent` transition to happen **after the offer is created but before SMS send**, or at minimum after SMS failure too. The status should reflect that an offer exists, regardless of SMS delivery. The offer record already exists in `dispatch_offers` — the status should track the offer lifecycle, not the SMS delivery.

**Specific change**: Move the status transition block (lines 229-238) to execute right after the SMS attempt logging (line 164), before the Twilio call. This way, the job status reflects "an offer has been sent to a driver" regardless of how the driver receives it (SMS or web link).

Alternatively, add `dispatch_recommendation_ready` to `VALID_ACCEPT_STATES` in `accept-driver-offer`. But the cleaner fix is in `send-driver-offer` since it should reflect the dispatch state accurately.

## Predicted PASS/FAIL by Step

| # | Step | Status |
|---|------|--------|
| 1 | Job in ready_for_dispatch | PASS — dev bypass or existing data |
| 2 | Match Drivers → dispatch_recommendation_ready | PASS — confirmed working |
| 3 | Start Dispatch → offer created | PASS — offer record created |
| 3b | job_status → driver_offer_sent | **FAIL if SMS fails** — blocker above |
| 4 | dispatch_offers visible in dashboard | PASS — polling shows offers |
| 5 | Driver offer page loads | PASS — uses token-based auth, no SMS needed |
| 6 | Accept works before expiry | **FAIL if step 3b failed** — 409 invalid_job_state |
| 7 | Job → payment_authorization_required | BLOCKED by step 6 |
| 8 | Customer tracking updates | PASS for status display, BLOCKED for post-accept |
| 9 | Completion path | BLOCKED by step 7 |

## Recommended Fix (Single Change, No New Logic)

**File: `supabase/functions/send-driver-offer/index.ts`**

Move the status transition to happen unconditionally after offer validation, before the Twilio SMS call. The offer exists, the driver can access it via web link — the job status should reflect this.

```text
Current order:                    Fixed order:
  1. Validate offer                 1. Validate offer
  2. Fetch driver/job               2. Fetch driver/job
  3. Build SMS                      3. Update job_status → driver_offer_sent  ← moved here
  4. Send via Twilio                4. Build SMS
  5. If success → update status     5. Send via Twilio (best-effort)
                                    6. Log SMS result
```

This ensures the driver can accept via the web link (`/driver/offer/:offerId`) even if SMS delivery fails.

## Hardening Plan (Post-Fix Priority Order)

After the blocker fix, implement in this order:

### 1. Offer Timeout / Retry Cascade
- `job-watchdog` already handles expired offers for `driver_offer_sent` jobs
- Verify `create-next-dispatch-offer` correctly picks the next untried candidate after decline/expire
- Validate the full retry sequence: offer → expire → next candidate → exhaust → `no_driver_candidates`

### 2. `dispatch_recommendation_ready` Accept Guard
- Add `dispatch_recommendation_ready` to `VALID_ACCEPT_STATES` in `accept-driver-offer` as a safety net
- This is defense-in-depth — the primary fix is in `send-driver-offer`

### 3. Invalid Action Disabling in UI
- Already done for Match Drivers and Start Dispatch buttons
- Extend to disable Accept/Decline on expired offers in the dispatcher dashboard
- Disable completion actions when job is not in a completable state

### 4. Longer Expiry in Testing Mode
- `create-next-dispatch-offer` uses `OFFER_TTL_SECONDS = 300` (5 min)
- Add a dev-mode override (e.g., 30 min) to allow manual testing without time pressure
- Gate behind `import.meta.env.DEV` or a URL param

## Summary

**One blocker must be fixed before validation can proceed**: `send-driver-offer` must update `job_status → driver_offer_sent` regardless of SMS delivery outcome. This is a single-file change in `supabase/functions/send-driver-offer/index.ts` with no new business logic — just moving an existing status transition earlier in the function.

