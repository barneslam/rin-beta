# RIN Platform — Complete Setup Guide

> Roadside Intelligence Network — Dispatcher Web + Customer Mobile + Driver Mobile
> Last updated: 2026-04-08

## Architecture Overview

```
                        ┌──────────────────────────┐
                        │      Supabase Backend     │
                        │  zyoszbmahxnfcokuzkuv     │
                        │                          │
                        │  ┌────────────────────┐  │
                        │  │   Edge Functions    │  │
                        │  │  (state machine)    │  │
                        │  └────────────────────┘  │
                        │  ┌────────────────────┐  │
                        │  │   PostgreSQL DB     │  │
                        │  │  + job_anomalies    │  │
                        │  │  + validate trigger │  │
                        │  │  + pg_cron (5min)   │  │
                        │  └────────────────────┘  │
                        │  ┌────────────────────┐  │
                        │  │   Twilio SMS        │  │
                        │  │  (fallback channel) │  │
                        │  └────────────────────┘  │
                        └────────────┬─────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     ┌────────┴────────┐   ┌────────┴────────┐   ┌────────┴────────┐
     │   Dispatcher     │   │    Customer      │   │     Driver      │
     │   Web App        │   │    Mobile App    │   │    Mobile App   │
     │                  │   │                  │   │                 │
     │  Vite + React    │   │  Expo + React    │   │  Expo + React   │
     │  TypeScript      │   │  Native + TS     │   │  Native + TS    │
     │  Port 8080       │   │  Port 8081       │   │  Port 8082      │
     │                  │   │                  │   │                 │
     │  /intake         │   │  Confirm details │   │  Accept offers  │
     │  /validation     │   │  Approve price   │   │  Report ARRIVED │
     │  /pricing        │   │  Track driver    │   │  Mark DONE      │
     │  /matching       │   │  Confirm done    │   │  Adjust price   │
     │  /offer          │   │  View receipt    │   │  Cancel at scene│
     │  /tracking       │   │                  │   │  Go online/off  │
     └─────────────────┘   └──────────────────┘   └─────────────────┘
```

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 18+ | All projects |
| npm | 9+ | Package management |
| Expo CLI | Latest | Mobile apps (`npx expo`) |
| Supabase CLI | Latest | Edge function deployment |
| Git | Any | Version control |

## Repository Structure

```
rin-beta/
├── src/                          # Dispatcher web app (Vite + React)
│   ├── pages/
│   │   ├── IntakeForm.tsx        # Step 1: Create job
│   │   ├── ValidationReview.tsx  # Step 2: Validate job
│   │   ├── PricingSetup.tsx      # Step 3: Set price
│   │   ├── DriverMatching.tsx    # Step 4: Match driver
│   │   ├── DispatchOffer.tsx     # Step 5: Send offer
│   │   └── JobTracking.tsx       # Step 6-9: Track & complete
│   ├── hooks/
│   │   └── useExceptionActions.ts  # Amendment, cancel, etc.
│   ├── lib/
│   │   ├── supabaseExternal.ts   # ⚠️ ALWAYS use this, not internal client
│   │   └── dispatchEngine.ts     # Truck matching logic
│   └── types/rin.ts              # Shared types & status labels
│
├── rin-customer/                 # Customer mobile app (Expo)
│   ├── App.tsx                   # Status-based router + deep linking
│   └── src/
│       ├── lib/supabase.ts
│       ├── hooks/useJob.ts       # Real-time job subscription
│       ├── types/job.ts
│       └── screens/
│           ├── JobConfirmScreen.tsx      # Replaces SMS "YES"
│           ├── PriceApprovalScreen.tsx   # Replaces SMS "APPROVE"
│           ├── TrackingScreen.tsx        # Live driver tracking
│           ├── CompletionScreen.tsx      # Replaces SMS "CONFIRM"
│           └── ReceiptScreen.tsx         # Post-completion receipt
│
├── rin-driver/                   # Driver mobile app (Expo)
│   ├── App.tsx                   # State machine router
│   └── src/
│       ├── lib/supabase.ts
│       ├── hooks/useDriverJob.ts # Real-time offer + active job
│       ├── types/driver.ts
│       └── screens/
│           ├── IdleScreen.tsx           # Online/offline + waiting
│           ├── OfferScreen.tsx          # Accept/decline with timer
│           └── ActiveJobScreen.tsx      # ARRIVED/DONE/adjust/cancel
│
├── supabase/
│   └── functions/                # Edge functions (state machine)
│       ├── intake-create-job/    # v10 — creates job + user
│       ├── send-customer-confirmation/  # v18 — confirmation SMS
│       ├── set-job-price/        # v2 — set price + SMS
│       ├── create-dispatch-offer/ # v7 — create offer record
│       ├── accept-driver-offer/  # v15 — driver acceptance
│       ├── send-driver-sms/      # v10 — outbound driver SMS
│       ├── complete-job/         # v2 — two-phase completion
│       ├── driver-cancel-at-scene/ # v2 — cancel at scene
│       ├── driver-adjust-amount/ # v1 — price adjustment
│       ├── send-amendment-sms/   # v1 — amendment approval SMS
│       ├── twilio-webhook/       # v10 — inbound SMS handler
│       └── _shared/phone.ts     # Phone normalization utils
│
├── CLAUDE_AUDIT_LOG.md           # Development session log
├── SETUP_GUIDE.md                # This file
└── .claude/skills/rin-test/      # Automated test skill
```

---

## 1. Dispatcher Web App Setup

### Install & Run

```bash
cd rin-beta
npm install
npm run dev
# Opens at http://localhost:8080
```

### Key Configuration

**Supabase Client:** Always use `supabaseExternal` from `@/lib/supabaseExternal`:
```typescript
import { supabaseExternal } from "@/lib/supabaseExternal";
```

> ⚠️ NEVER use `supabase` from `@/integrations/supabase/client` — it has undefined env vars and silently fails.

**Vite Config:** Port is set to 8080 in `vite.config.ts`.

### Dispatcher Workflow

| Step | Page | Action | Edge Function |
|---|---|---|---|
| 1 | `/intake` | Create job | `intake-create-job` |
| 2 | `/validation` | Review details | — |
| 3 | `/pricing` | Set price | `set-job-price` |
| 4 | `/matching` | Match driver | — (client-side) |
| 5 | `/offer` | Send offer | `create-dispatch-offer` |
| 6-9 | `/tracking` | Track & complete | `complete-job` |

---

## 2. Customer Mobile App Setup

### Install & Run

```bash
cd rin-customer
npm install

# Web browser (for testing)
npx expo start --web --port 8081

# iOS Simulator
npx expo start --ios

# Android Emulator
npx expo start --android

# Physical device (scan QR with Expo Go app)
npx expo start
```

### How It Works

The app routes to the correct screen based on `job_status`:

| Status | Screen | Customer Action |
|---|---|---|
| `pending_customer_confirmation` | JobConfirmScreen | Tap "Confirm Details" |
| `pending_customer_price_approval` | PriceApprovalScreen | Tap "Approve $X" |
| `customer_reapproval_pending` | PriceApprovalScreen | Approve revised price |
| `payment_authorization_required` | PriceApprovalScreen | (Stripe TODO) |
| `ready_for_dispatch` through `service_in_progress` | TrackingScreen | Watch progress |
| `pending_completion_approval` | CompletionScreen | Tap "Confirm & Pay" |
| `job_completed` | ReceiptScreen | View receipt |

### Deep Linking

SMS messages include a link that opens the app:
```
rin-customer://job/{jobId}
```

If the app is not installed, the customer can still reply via SMS (fallback).

### SMS Fallback

Every edge function still sends SMS regardless of whether the customer has the app. The app is an upgrade path, not a replacement:

```
notification_channel = 'sms'    → SMS only (default for all users)
notification_channel = 'app'    → Push notification (falls back to SMS on failure)
notification_channel = 'both'   → Both SMS and push
```

---

## 3. Driver Mobile App Setup

### Install & Run

```bash
cd rin-driver
npm install

# Web browser (for testing)
npx expo start --web --port 8082

# iOS/Android
npx expo start
```

### How It Works

The app has three modes:

**Idle Mode** (IdleScreen)
- Toggle online/offline availability
- Waiting for dispatch offers

**Offer Mode** (OfferScreen)
- Shows job details: incident type, vehicle, location, payout
- Countdown timer until offer expires
- Accept or Decline buttons

**Active Job Mode** (ActiveJobScreen)
- Status-dependent action buttons:

| Status | Available Actions |
|---|---|
| `driver_enroute` | "I've Arrived" |
| `driver_arrived` | "Start Service", "Adjust Price", "Can't Complete" |
| `service_in_progress` | "Mark Complete", "Adjust Price", "Can't Complete" |
| `pending_completion_approval` | Waiting for customer confirmation |

### Edge Functions Called

| Action | Edge Function | Fallback |
|---|---|---|
| Accept offer | Direct DB (JWT required on edge fn) | SMS YES |
| Report ARRIVED | Direct DB | SMS ARRIVED |
| Mark DONE | `complete-job` Phase 1 | Direct DB |
| Adjust Price | `driver-adjust-amount` | SMS ADJUST {amount} |
| Can't Complete | `driver-cancel-at-scene` | SMS CANCEL |

---

## 4. Edge Function Deployment

### Deploy a single function

```bash
cd rin-beta
npx supabase functions deploy {function-name} --project-ref zyoszbmahxnfcokuzkuv --no-verify-jwt
```

### Deploy all functions

```bash
npx supabase functions deploy --project-ref zyoszbmahxnfcokuzkuv
```

### Current versions (as of 2026-04-08)

| Function | Version | JWT Required |
|---|---|---|
| `intake-create-job` | v10 | No |
| `send-customer-confirmation` | v18 | No |
| `set-job-price` | v2 | No |
| `create-dispatch-offer` | v7 | No |
| `accept-driver-offer` | v15 | Yes |
| `complete-job` | v2 | No |
| `driver-cancel-at-scene` | v2 | No |
| `driver-adjust-amount` | v1 | No |
| `send-amendment-sms` | v1 | No |
| `twilio-webhook` | v10 | Yes |

### intake-create-job Field Names

This function accepts **both camelCase and snake_case**:

```json
{
  "name": "Peter",              // or "customer_name"
  "phone": "+16472847417",
  "vehicleMake": "Honda",       // or "vehicle_make"
  "vehicleModel": "Civic",      // or "vehicle_model"
  "vehicleYear": 2022,          // or "vehicle_year"
  "pickupLocation": "...",      // or "pickup_location"
  "incidentTypeId": "uuid",     // or "incident_type_id"
  "incidentType": "Flat Tire",  // or "incident_type" (name-based lookup)
  "canVehicleRoll": true        // or "can_vehicle_roll"
}
```

---

## 5. Production Monitoring

### Real-Time State Validation

A PostgreSQL trigger (`validate_job_state`) fires on every `job_events` INSERT and checks:

| Rule | Severity | What It Catches |
|---|---|---|
| Invalid transition | Critical | Status changes that skip required steps |
| Missing incident_type_id | Critical | Dispatch without incident type |
| Missing pickup_location | Warning | Dispatch without location |
| Missing payment intent | Critical | Payment capture without Stripe ID |
| Missing customer_phone | Warning | Completion without phone for receipts |

### Stale Job Detection

`detect_stale_jobs()` runs every 5 minutes via `pg_cron`:

| Threshold | Severity |
|---|---|
| 30-60 minutes | Info |
| 60-120 minutes | Warning |
| 120+ minutes | Critical |

### Query the Dashboard

```sql
-- All unresolved anomalies
SELECT * FROM job_anomalies WHERE NOT resolved ORDER BY created_at DESC;

-- Summary by type
SELECT anomaly_type, severity, COUNT(*) FROM job_anomalies
WHERE NOT resolved GROUP BY anomaly_type, severity;

-- Run stale detection manually
SELECT detect_stale_jobs();
```

---

## 6. Automated Testing (Claude Code Skill)

The `/rin-test` skill runs the complete test suite autonomously:

```
/rin-test full        # All tests (happy + exceptions)
/rin-test happy       # Happy paths only
/rin-test exceptions  # Exception paths only
```

### What It Tests

**Happy Path:**
1. Intake → customer confirmation SMS → customer YES
2. Set price → price SMS → customer APPROVE
3. Payment bypass → ready for dispatch
4. Create offer → driver accepts → driver en route
5. Driver ARRIVED → service in progress
6. Driver DONE (Phase 1) → customer CONFIRM (Phase 2)
7. Job completed → Stripe capture → receipt SMS to both

**Exception Paths:**
- Driver cancel at scene
- Amendment flow (price revision + customer re-approval)
- Driver adjust amount on scene
- Offer expiry and re-offer

### Test Data

| Role | Name | ID | Phone |
|---|---|---|---|
| Customer | Peter | `a5f0d336-8575-4117-b223-ebf5110b15ed` | +16472847417 |
| Driver | Test Tow Driver | `0ecf6a1e-6109-494c-aff8-66451ea63f41` | +16474731338 |
| Truck | Standard Flatbed | `4c373ce3-8082-479c-a28b-0355d2f4c920` | — |

---

## 7. Database Schema (Key Tables)

### jobs
Core job table — tracks the entire lifecycle.

Key columns: `job_id`, `job_status` (enum), `user_id`, `incident_type_id`, `pickup_location`, `vehicle_make/model/year`, `estimated_price`, `assigned_driver_id`, `stripe_payment_intent_id`, `completed_at`, `customer_phone`, `exception_code`

### job_events
Audit trail — every state change and SMS is logged.

Key columns: `event_id`, `job_id`, `event_type`, `event_category`, `message`, `old_value` (jsonb), `new_value` (jsonb)

### job_anomalies
Production monitoring — anomalies detected by the trigger.

Key columns: `anomaly_id`, `job_id`, `anomaly_type`, `severity`, `message`, `resolved`

### dispatch_offers
Driver offer lifecycle.

Key columns: `offer_id`, `job_id`, `driver_id`, `truck_id`, `offer_status`, `expires_at`, `response_time`

### notification_log
Tracks notification delivery and SMS fallback.

Key columns: `notification_id`, `job_id`, `user_id`, `channel`, `notification_type`, `status`, `fallback_channel`

### users
Customer records.

Key columns: `user_id`, `name`, `phone`, `notification_channel` (default 'sms'), `push_token`

---

## 8. Supabase Connection

```
Project ID:   zyoszbmahxnfcokuzkuv
URL:          https://zyoszbmahxnfcokuzkuv.supabase.co
Dashboard:    https://supabase.com/dashboard/project/zyoszbmahxnfcokuzkuv
Functions:    https://zyoszbmahxnfcokuzkuv.supabase.co/functions/v1/{name}
```

---

## 9. Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| Edge function returns 401 | JWT verification enabled | Deploy with `--no-verify-jwt` or use service role key |
| Confirmation SMS says "Not specified" | snake_case field names | Use camelCase (`vehicleMake`) or both (v10 supports both) |
| Dispatch blocked "missing incident_type_id" | No incident type on job | Pass `incidentTypeId` or `incidentType` name at intake |
| `supabaseExternal` not found | Wrong import | Import from `@/lib/supabaseExternal`, not `@/integrations/...` |
| Web app blank white screen | React hooks violation | Check for useState after early return in component |
| Payment capture fails | No Stripe key configured | Use bypass: `stripe_payment_intent_id = 'bypass_test_{ts}'` |
