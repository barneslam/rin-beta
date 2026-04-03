# RIN Beta — System Baseline
**Established:** 2026-04-03
**Last updated:** 2026-04-03
**Status:** Stable — Batches 1–4 (AI Voice intake pipeline) complete

---

## Deployed Edge Functions (current versions)

| Function | Version | Purpose |
|---|---|---|
| `intake-create-job` | v9 | Creates job + user, fires send-customer-confirmation |
| `send-customer-confirmation` | v19 | Confirmation SMS to customer with job summary + confirm link |
| `set-job-price` | v2 | Sets price → SMS to customer "reply APPROVE" |
| `confirm-payment-authorization` | v1 | Post-Stripe auth → `ready_for_dispatch` |
| `create-dispatch-offer` | v7 | Creates `dispatch_offers` record |
| `send-driver-sms` | v13 | Offer SMS to driver; sets `driver_offer_sent` on success |
| `accept-driver-offer` | v17 | Single acceptance path for SMS/web/dispatcher sources |
| `resolve-dispatch-offer` | v2 | Decline or expire offer |
| `twilio-webhook` | v10 | Inbound SMS handler (YES/NO/ARRIVED/DONE/CANCEL/ADJUST/CONFIRM/APPROVE) |
| `complete-job` | v2 | Phase 1: DONE → `pending_completion_approval`. Phase 2: CONFIRM → `job_completed` |
| `driver-cancel-at-scene` | v2 | CANCEL → `driver_cancelled_at_scene`, unassigns driver |
| `driver-adjust-amount` | v1 | Driver ADJUST n → updates price + SMS customer |
| `send-amendment-sms` | v1 | Customer YES/NO SMS when dispatcher amends charges |
| `send-payment-sms` | v7 | Standalone payment link SMS |
| `check-payment-timeout` | v6 | Payment timeout watchdog |
| `job-watchdog` | v6 | General job watchdog |
| `process-intake` | v6 | Legacy intake processor |
| `geocode-location` | — | Text → coordinates |
| `driver-respond` | v7 | Web link driver response |
| `start-intake-session` | v1 | Creates intake session + empty candidate draft; idempotency + resume detection |
| `append-intake-turn` | v1 | Records a single caller/agent turn; idempotency via UNIQUE(session_id, turn_number) |
| `extract-intake-turn` | v12 | LLM extraction (claude-haiku-4-5) → updates job_payload_candidates; confidence gating |
| `finalize-intake-to-job` | v1 | Readiness check → calls intake-create-job; idempotency; logs job_created/skipped/insufficient_data |
| `twilio-voice-intake` | v1 | Twilio Voice webhook; routes initial call + gather callbacks; full pipeline orchestration; JWT off |

---

## State Machine

### Job status flow (new flow — Stripe pre-authorized)

```
pending_customer_confirmation
  → (customer YES/confirm link) → pending_pricing
  → (dispatcher sets price) → pending_customer_price_approval
  → (customer APPROVE) → payment_authorization_required
  → (Stripe auth) → ready_for_dispatch
  → (send-driver-sms success) → driver_offer_sent        ← Batch C
  → (driver accepts) → driver_enroute
  → (driver ARRIVED) → driver_arrived
  → (driver DONE) → pending_completion_approval
  → (customer CONFIRM) → job_completed
```

### Exception states
- `driver_cancelled_at_scene` — driver texts CANCEL or dispatcher clicks "Driver Unable"
- `customer_reapproval_pending` — dispatcher amends charges mid-job

### Flow discriminator
`accept-driver-offer` uses `stripe_payment_intent_id` presence (not `job_status`) to discriminate new vs old flow. This is intentional — `job_status` is unreliable as a discriminator at accept time because it is `driver_offer_sent`, not `ready_for_dispatch`.

---

## Protections in place (as of this baseline)

### State guards
| Function | Guard | Rejects if |
|---|---|---|
| `send-driver-sms` | `invalid_job_state` (409) | `job_status !== ready_for_dispatch` |
| `send-driver-sms` | `offer_not_pending` (409) | `offer_status !== pending` |
| `send-driver-sms` | `duplicate_sms` (409) | `sms_sent_at` already set on offer |
| `accept-driver-offer` | `invalid_job_state` (409) | `job_status` not in `[ready_for_dispatch, driver_offer_sent]` |
| `accept-driver-offer` | `offer_not_pending` (409) | `offer_status !== pending` |
| `accept-driver-offer` | `offer_expired` (410) | `expires_at` in past |

### Phone validation coverage
| Function | Uses validatePhone? |
|---|---|
| `send-driver-sms` | Yes (blocks + logs) |
| `send-customer-confirmation` | Yes (blocks + logs `confirmation_sms_phone_invalid`) |
| `accept-driver-offer` (customer) | Yes (blocks + logs `customer_sms_blocked`) |
| `accept-driver-offer` (driver confirm) | Yes (skips SMS if invalid) |
| `twilio-webhook` | No — uses local normalizePhone() (known drift, Batch D) |

### Observability events logged per dispatch cycle (new flow, clean run)
```
intake_created
confirmation_sms_triggered
confirmation_sms_function_started
confirmation_sms_job_fetched
confirmation_sms_twilio_attempt
confirmation_sms_sent
confirmation_sms_trigger_success
offer_created
driver_sms_attempt                  ← added Stabilization
offer_sent                          ← added Batch B
driver_sms_sent
job_status_updated (→ driver_offer_sent)  ← added Batch C
driver_accepted
driver_confirmed_sms_sent
driver_confirmation_sms_sent
```

### Silent failures eliminated
| Location | Was | Now |
|---|---|---|
| `accept-driver-offer` new-flow customer SMS catch | `console.error` only | `driver_confirmed_sms_failed` event |
| `accept-driver-offer` driver confirm SMS non-ok | `console.error` only | `driver_confirmation_sms_failed` event with status + body |
| `accept-driver-offer` driver confirm SMS catch | `console.error` only | `driver_confirmation_sms_failed` event |
| `twilio-webhook` ARRIVED customer SMS | `.catch()` swallow | `customer_arrival_sms_attempt/sent/failed` events (Batch B) |

### Error response format (all three functions)
```json
{
  "success": false,
  "error_code": "invalid_job_state",
  "error": "Human-readable message",
  "context": { "jobId": "...", "offerId": "...", "current_status": "..." }
}
```

---

## AI Voice Intake Pipeline (Batches 1–4)

### Architecture
```
Twilio inbound call
  → start-intake-session        (creates intake_sessions + job_payload_candidates)
  → [for each turn]
      append-intake-turn        (writes intake_turns)
      extract-intake-turn       (LLM → updates job_payload_candidates fields)
  → finalize-intake-to-job      (readiness check → intake-create-job → job created)
```

### Readiness criteria (finalize-intake-to-job)
All three required:
- `pickup_location_candidate IS NOT NULL`
- `incident_type_id_candidate IS NOT NULL`
- `session.channel_identifier IS NOT NULL` (phone for confirmation SMS)

### LLM extraction — confidence thresholds (extract-intake-turn)
- HIGH ≥ 0.85 → overwrite existing value
- MED 0.65–0.84 → write only if null
- LOW < 0.65 → skip (no write)

Model: `claude-haiku-4-5-20251001` via direct Anthropic API (`x-api-key` header).
Secret: `ANTHROPIC_API_KEY` (set on project `zyoszbmahxnfcokuzkuv`).

### Voice intake events (clean run, end-to-end)
```
intake_session_started
turn_appended              (per turn)
extraction_completed       (per turn, after LLM extraction)
job_created                (handoff — finalize success)
```

### Batch 3 test results (extract-intake-turn v12) — 2026-04-03
| Test | Result |
|---|---|
| Valid extraction (Honda Civic, King & Bathurst, tow) | PASS |
| Idempotency (re-run same turn_id) | PASS |

### Batch 5 test results (twilio-voice-intake v1) — 2026-04-03
| Test | Result |
|---|---|
| Initial call POST → greeting TwiML + Gather action URL with session_id/candidate_id/turn=1 | PASS |
| Gather with full utterance → extract ran, finalized in 1 exchange, hangup TwiML returned | PASS |
| DB state: session_status=completed, candidate is_finalized=true, job_id set on both | PASS |
| system_events: intake_session_started → voice_call_started → turn_appended → extraction_attempted → extraction_succeeded → job_created (6 events, correct order) | PASS |

### Batch 4 test results (finalize-intake-to-job v1) — 2026-04-03
| Test | Result |
|---|---|
| A: insufficient_data (empty candidate) → 422 | PASS |
| B: job creation trigger (fully extracted candidate) → job_id returned, candidate finalized, session completed | PASS |
| C: idempotency (re-run) → job_skipped, same job_id returned | PASS |

---

## Changes made across sessions (summary)

### Batch A — Dead code removal
- `accept-driver-offer`: removed dead `GATEWAY_URL` constant (Lovable gateway — never used in active paths)

### Batch B — Observability
- `send-driver-sms`: added `offer_sent` dispatch event on successful SMS send
- `twilio-webhook`: ARRIVED handler customer SMS converted from fire-and-forget `.catch()` to explicit `.then().catch()` with `customer_arrival_sms_attempt/sent/failed` events
- `accept-driver-offer`: old-flow payment SMS catch now writes `payment_sms_failed` event

### Batch C — State correction (DEF-002)
- `send-driver-sms`: after successful Twilio send, updates `job_status → driver_offer_sent` if current status is `ready_for_dispatch`; writes `job_status_updated` event

### Batch 1 — AI Voice: Session + Turn management
- `start-intake-session`: Creates `intake_sessions` + empty `job_payload_candidates` draft. Handles call_sid idempotency and 30-min resume window for abandoned sessions.
- `append-intake-turn`: Records turns to `intake_turns` with role/category validation, UNIQUE(session_id, turn_number) idempotency, session status guard.

### Batch 2 — AI Voice: (no separate Batch 2 entry — merged into pipeline)

### Batch 3 — AI Voice: LLM extraction
- `extract-intake-turn` (v12): Direct Anthropic API call (claude-haiku-4-5-20251001). Strict JSON system prompt with CRITICAL OUTPUT RULES. 3-pass `extractJson()` fallback parser (direct → strip fences → regex). Confidence-gated writes to `job_payload_candidates`. Idempotency via `extracted_fields IS NOT NULL` on turn. Raw LLM response logged before parsing.

### Batch 5 — AI Voice: Twilio Voice webhook
- `twilio-voice-intake` (v1, JWT off): Single function handles initial call and all gather callbacks. State passed in Gather action URL (session_id, candidate_id, turn). Turn numbering: user turns odd (1,3,5...), agent turns even (2,4,6...). MAX_EXCHANGES=5. Rule-based follow-up questions (no extra LLM call). Calls full pipeline: start-intake-session → append-intake-turn → extract-intake-turn → finalize-intake-to-job. All errors return TwiML (never JSON). XML-escapes all Say content.

### Batch 4 — AI Voice: Finalization bridge
- `finalize-intake-to-job` (v1): Readiness check on candidate + session. Delegates to `intake-create-job` v9 via internal fetch (no direct jobs table writes). Marks candidate `is_finalized`, updates session to `completed`. Logs `job_created` / `job_skipped` / `insufficient_data` to `system_events`.

### Stabilization — Hardening
- `send-driver-sms` (v13): state guard, offer idempotency, pre-send event, structured errors
- `send-customer-confirmation` (v19): `validatePhone` added, structured errors
- `accept-driver-offer` (v17): job state guard, 3 silent failure paths fixed, all error returns standardized with `error_code` + `context`

---

## Known deferred items

| ID | Item | File | Status |
|---|---|---|---|
| Batch D-1 | Deduplicate payment SMS (old-flow in accept-driver-offer vs send-payment-sms) | `accept-driver-offer`, `send-payment-sms` | Deferred |
| Batch D-2 | Import `normalizePhone` from `_shared` in `twilio-webhook` (currently uses local copy) | `twilio-webhook` | Deferred |
| Batch E-1 | `validatePhone` in `twilio-webhook` ARRIVED handler | `twilio-webhook` | Deferred |
| Batch E-2 | `dispatchEngine.ts` `isLikelyDeliverableSmsPhone()` diverges from `_shared/phone.ts` | `src/lib/dispatchEngine.ts` | Deferred |
| **Batch 6-S1** | Twilio request signature validation not implemented in `twilio-voice-intake`. Add `X-Twilio-Signature` HMAC verification using `TWILIO_AUTH_TOKEN` secret before production. | `twilio-voice-intake` | Deferred |
| **B1-F1** | ~~BLOCKING~~ **RESOLVED 2026-04-03** — Dropped FK `intake_sessions_voice_call_sid_fkey`. `voice_call_sid` is now plain `text` (nullable). Migration: `drop_voice_call_sid_fk`. | `intake_sessions` schema | **Closed** |

---

## Test data

| Entity | Value |
|---|---|
| Customer | Peter, `user_id=a5f0d336-8575-4117-b223-ebf5110b15ed`, phone=+16472847417 |
| Driver | Test Tow Driver (Mike Chen / FastTow Toronto), `driver_id=0ecf6a1e-6109-494c-aff8-66451ea63f41`, phone=+16474731338 |
| Truck | Standard Flatbed, `truck_type_id=65e4cdc1-0b83-41ec-aa99-a28ae990eaa3` |
| Supabase project | `zyoszbmahxnfcokuzkuv` |
| App URL | `https://rin-beta.lovable.app` |

---

## Regression test — last verified 2026-04-03

| Test | Result |
|---|---|
| Happy path: send-driver-sms → SMS sent, `driver_offer_sent` | PASS |
| Duplicate call: `duplicate_sms` 409 | PASS |
| State guard (job already `driver_enroute`): `invalid_job_state` 409 in accept | PASS |
| Offer not pending guard: `offer_not_pending` 409 | PASS |
| Accept from `driver_offer_sent` → `driver_enroute` | PASS |
| `offer_accept_blocked` event written on blocked accept | PASS |
| No duplicate events, no exception_code on clean run | PASS |
| Event count (new flow clean job): 15 events in correct order | PASS |
