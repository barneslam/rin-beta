

# Stripe MVP — End-to-End Test Sequences

## 1. Happy Path

```text
Step 1: Create a job via /get-help/form (or dispatcher intake /intake)
        → job reaches intake_completed → validation → ready_for_dispatch

Step 2: Dispatch engine sends offer to driver
        → job_status = driver_offer_sent

Step 3: Driver accepts (via SMS "YES" to twilio-webhook, or via /driver/offer/:id UI)
        → useAcceptDispatchOffer or twilio-webhook sets job_status = payment_authorization_required
        → price validation guard checks estimated_price > 0
        → payment SMS sent to customer phone

Step 4: Customer opens /pay/:jobId
        → create-payment-intent edge function returns clientSecret + publishableKey
        → Stripe Elements renders PaymentElement
        → Customer enters test card: 4242 4242 4242 4242 (any future exp, any CVC)
        → stripe.confirmPayment() → paymentIntent.status = requires_capture

Step 5: Frontend calls confirm-payment-authorization edge function
        → logs payment_authorized audit event
        → auto-advances job_status to driver_enroute
        → returns { success: true, advanced_to: "driver_enroute" }
        → frontend redirects to /track/:jobId

Step 6: Dispatcher advances through tracking stages
        → driver_enroute → driver_arrived → service_in_progress → job_completed

Step 7: On job_completed, useUpdateJob auto-invokes capture-payment edge function
        → Stripe captures the authorized hold
        → Logs payment_captured to job_events + audit_logs
        → On failure: persists "⚠ Auto-capture failed" to customer_update_message
```

**Test cards (Stripe test mode):**
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`

---

## 2. Failure Path (Payment Declined)

```text
Step 1-3: Same as happy path (job reaches payment_authorization_required)

Step 4: Customer opens /pay/:jobId, enters decline test card 4000 0000 0000 0002
        → stripe.confirmPayment() returns error
        → UI shows error message, stays on payment page

Step 5: Customer retries with valid card
        → Same create-payment-intent call (reuses existing PaymentIntent)
        → Succeeds → flow continues as happy path

Alternative: confirm-payment-authorization returns status !== requires_capture
        → Edge function sets job_status = payment_failed, authorization_status = failed
        → /pay/:jobId shows "Previous authorization failed" retry banner
```

---

## 3. Timeout Path

```text
Step 1-3: Same as happy path (job reaches payment_authorization_required)

Step 4: Customer does NOT complete payment within 30 minutes

Step 5: Dispatcher clicks "Check Timeouts" button in DispatchControlPanel
        → Invokes check-payment-timeout edge function
        → Function queries jobs with status=payment_authorization_required AND updated_at < now()-30min
        → Sets job_status = payment_failed, authorization_status = expired
        → Logs timeout event to job_events + audit_logs

UI indicators before timeout:
        → After 15 min: amber warning in JobTracking + ⏱ badge in DispatchControlPanel
        → After 30 min: auto-expired on next timeout check
```

**Note:** There is no automated cron/scheduler invoking `check-payment-timeout`. It is manual (dispatcher button) for MVP. A pg_cron or external scheduler can be added later.

---

## 4. Known Blockers / Risks

| # | Item | Status | Detail |
|---|------|--------|--------|
| 1 | `@stripe/stripe-js` dependency | **OK** | Present in package.json v5.5.0 |
| 2 | `@stripe/react-stripe-js` dependency | **OK** | Present in package.json v5.6.1 |
| 3 | `STRIPE_SECRET_KEY` secret | **OK** | Configured |
| 4 | `STRIPE_PUBLISHABLE_KEY` secret | **OK** | Configured |
| 5 | `/pay/:jobId` route | **OK** | Registered in App.tsx |
| 6 | `estimated_price` must be set | **Requires manual setup** | The intake/pricing flow must set `estimated_price > 0` on the job before driver accept. If testing manually, set it via the PricingAuth page or directly in the database. |
| 7 | Customer `user_id` + `phone` for SMS | **Requires test data** | The payment SMS path in `twilio-webhook` looks up `jobs.user_id → users.phone`. If user record has no phone, SMS silently fails (non-blocking). |
| 8 | Payment timeout is manual only | **Acceptable for MVP** | No cron. Dispatcher must click "Check Timeouts". |
| 9 | Auto-capture is frontend-triggered | **Acceptable for MVP** | Runs in `useUpdateJob` when dispatcher clicks "Advance to job_completed". Manual capture button exists as fallback in JobTracking. |
| 10 | `confirm-payment-authorization` checks for `result.status === "authorized"` | **Potential mismatch** | The edge function returns `{ status: "authorized", advanced_to: "driver_enroute" }` but `CustomerPayment.tsx` line 49 checks `result.status === "authorized"` — this matches. OK. |

**No blockers prevent testing today**, provided a job has a valid `estimated_price` and reaches `payment_authorization_required`.

