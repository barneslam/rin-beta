# AI Voice Design & Implementation
**Project:** RIN Beta
**Phase:** Design only — no implementation, no schema changes, no dispatch logic changes
**Established:** 2026-04-02
**Status:** Design complete — ready for implementation planning

---

## Architecture Constraint

AI Voice sits entirely within the intake layer. The single crossing point into the execution layer is `finalize-intake-to-job` → `intake-create-job`. Nothing else crosses.

```
AI VOICE LAYER                         EXECUTION LAYER
─────────────────────────────          ─────────────────────────────────────────
intake_sessions                        jobs
intake_turns                           job_events
job_payload_candidates                 dispatch_offers
system_events                          audit_logs
decision_logs
                        │
                        │  finalize-intake-to-job
                        │  calls intake-create-job (existing v9)
                        ▼
                   [CROSSING POINT]
                        │
                        ▼
                   job created
                   send-customer-confirmation fires
                   stable execution workflow begins
```

---

## 1. Voice Session Lifecycle

### Overview

```
Inbound call
  → voice-webhook (TwiML)
  → start-intake-session
  → [turn loop]
      append-intake-turn
      → extract-intake-turn
      → update-payload-candidate
      → evaluate-intake-readiness
      → [if needs_clarification] → voice prompt → back to turn loop
  → [when ready_to_finalize]
      finalize-intake-to-job
      → calls intake-create-job (existing, unchanged)
      → session closed, job_id stamped on session
```

### Step-by-step

#### Step 1 — Inbound Call Start

| Field | Value |
|---|---|
| Trigger | Twilio Voice webhook fires on inbound call |
| Owning function | `voice-webhook` |
| DB reads | `users` by phone number (caller ID lookup) |
| DB writes | None yet — session not created until identity resolved or first utterance |
| Next step | Greet caller, begin session creation |

#### Step 2 — Session Creation

| Field | Value |
|---|---|
| Trigger | First utterance received OR call connected |
| Owning function | `start-intake-session` |
| DB reads | `intake_sessions` — check for open/abandoned session for same caller phone (resume detection) |
| DB writes | `intake_sessions` (new record: `session_status = active`, `channel = voice`, `call_sid`, `caller_phone`, `user_id` if resolved) |
| DB writes | `system_events` (`intake_session_started`) |
| DB writes | `job_payload_candidates` (empty draft row, `is_finalized = false`, linked to session_id) |
| Next step | Begin turn capture loop |

#### Step 3 — Turn Capture

| Field | Value |
|---|---|
| Trigger | Twilio STT returns transcript for caller utterance |
| Owning function | `append-intake-turn` |
| DB reads | `intake_sessions` (confirm active, get session_id) |
| DB writes | `intake_turns` (new row: `role = caller`, `raw_transcript`, `turn_number`, `session_id`) |
| Next step | `extract-intake-turn` |

#### Step 4 — Extraction

| Field | Value |
|---|---|
| Trigger | `append-intake-turn` completes |
| Owning function | `extract-intake-turn` |
| DB reads | `intake_turns` (current turn), `job_payload_candidates` (existing state for contradiction detection), `incident_types` (for incident name → ID mapping) |
| DB writes | `intake_turns.extracted_fields` (JSONB: field name → `{value, confidence, source_turn}` per field), `intake_turns.normalized_transcript` |
| DB writes | `system_events` (`field_extracted` or `extraction_failed`) |
| Next step | `update-payload-candidate` |

#### Step 5 — Payload Candidate Update

| Field | Value |
|---|---|
| Trigger | `extract-intake-turn` completes with extracted fields |
| Owning function | `update-payload-candidate` |
| DB reads | `job_payload_candidates` (current candidate state) |
| DB writes | `job_payload_candidates` — merge extracted values using update rules (see §2) |
| DB writes | `system_events` (`field_updated` or `contradiction_flagged`) |
| Next step | `evaluate-intake-readiness` |

#### Step 6 — Readiness Evaluation

| Field | Value |
|---|---|
| Trigger | `update-payload-candidate` completes |
| Owning function | `evaluate-intake-readiness` |
| DB reads | `job_payload_candidates` (full candidate state), `exception_library` (for known exception codes if needed) |
| DB writes | `intake_sessions.session_status` update if state changes |
| DB writes | `system_events` (`readiness_evaluated`, with state written) |
| Next step | If `needs_clarification` → `voice-webhook` issues TwiML prompt → back to Step 3. If `ready_to_finalize` → Step 7. If `manual_review_required` → Step 8 (escalation). |

#### Step 7 — Finalization and Handoff

| Field | Value |
|---|---|
| Trigger | `evaluate-intake-readiness` returns `ready_to_finalize` |
| Owning function | `finalize-intake-to-job` |
| DB reads | `job_payload_candidates` (all candidate fields), `intake_sessions` (confirm `job_id IS NULL`) |
| DB writes | `job_payload_candidates.is_finalized = true`, `finalized_at = now()` — record frozen |
| External call | `intake-create-job` (existing v9, unchanged) — receives mapped payload |
| DB writes | `intake_sessions.job_id` = returned job_id, `session_status = completed` |
| DB writes | `system_events` (`handoff_triggered`, with job_id) |
| DB writes | `decision_logs` (finalization decision record) |
| Next step | `intake-create-job` fires `send-customer-confirmation` — stable execution workflow takes over |

#### Step 8 — Manual Escalation (exception path)

| Field | Value |
|---|---|
| Trigger | `evaluate-intake-readiness` returns `manual_review_required` |
| Owning function | `voice-webhook` + `log-system-event` |
| DB writes | `intake_sessions.session_status = manual_review_required` |
| DB writes | `system_events` (`handoff_triggered` with `outcome = escalated_to_dispatcher`) |
| Next step | Dispatcher notified (mechanism TBD). Session preserved, candidate preserved. No job created. |

---

## 2. Turn Processing Model

### Per-turn pipeline

```
Raw STT transcript
  → normalize (strip filler words, lowercase, trim)
  → LLM extraction pass (structured prompt with field schema)
  → per-field confidence scoring
  → contradiction check against current job_payload_candidates
  → merge decision
  → write to intake_turns.extracted_fields
  → update job_payload_candidates
```

### Extraction output schema (per turn, JSONB)

```json
{
  "pickup_location": { "value": "123 King St West", "confidence": 0.91, "source_turn": 2 },
  "incident_type_id": { "value": "uuid-for-tow", "confidence": 0.87, "source_turn": 2 },
  "vehicle_make": { "value": "Honda", "confidence": 0.95, "source_turn": 1 },
  "vehicle_model": { "value": "Civic", "confidence": 0.95, "source_turn": 1 },
  "vehicle_year": { "value": "2019", "confidence": 0.80, "source_turn": 1 },
  "can_vehicle_roll": { "value": true, "confidence": 0.72, "source_turn": 3 }
}
```

### Confidence thresholds

| Level | Range | Behavior |
|---|---|---|
| High | ≥ 0.85 | Accept and write to candidate |
| Medium | 0.65 – 0.84 | Accept tentatively; flag field for confirmation if required |
| Low | < 0.65 | Do not write; trigger clarification prompt for that field |

### Contradiction handling

| Condition | Action |
|---|---|
| New confidence > existing + 0.10 | Overwrite candidate; write `contradiction_flagged` event with both values |
| New confidence ≤ existing + 0.10 | Do not overwrite; flag field as `needs_clarification`; prompt caller to confirm |
| Same value, higher confidence | Update confidence only; no prompt |
| Same value, lower confidence | No change |

Both old and new values are preserved in `intake_turns.extracted_fields` on their respective turns. The candidate holds only the current accepted value.

### Update strategy for `job_payload_candidates`

- Fields are written individually (not bulk overwrite).
- A field is only updated if the incoming confidence clears the threshold for that field's current state.
- `updated_at` is refreshed on any write.
- Once `is_finalized = true`, no writes are permitted (enforced by CHECK constraint `chk_finalized_immutable`).

---

## 3. Readiness Model

### Required fields (all scenarios)

| Field | Notes |
|---|---|
| `pickup_location_candidate` | Must be non-null and geocodeable |
| `incident_type_id_candidate` | Must resolve to a valid `incident_types` row |
| `user_id_candidate` | Caller must be identified (by phone lookup or new user creation) |

### Conditionally required fields

| Field | Required when |
|---|---|
| `can_vehicle_roll_candidate` | Incident type is Tow, Accident, Winch, or Stuck Vehicle |
| `vehicle_make_candidate` | Always (strongly preferred; low-confidence flags for confirmation) |
| `vehicle_model_candidate` | Always (strongly preferred) |

### States

#### `incomplete`
- **Conditions:** One or more required fields is null or below confidence threshold
- **Missing fields that trigger it:** Any of `pickup_location_candidate`, `incident_type_id_candidate`, `user_id_candidate`, or `can_vehicle_roll_candidate` (when required)
- **Follow-up prompt required:** Yes — voice asks specifically for the first missing required field

#### `needs_clarification`
- **Conditions:** All required fields present, but at least one has a contradiction or medium confidence
- **Which fields trigger it:** Any required field with confidence 0.65–0.84 OR an unresolved contradiction
- **Follow-up prompt required:** Yes — voice asks caller to confirm the specific conflicting value

#### `ready_to_finalize`
- **Conditions:**
  - All required fields present
  - All conditionally required fields present (where applicable)
  - All required fields at confidence ≥ 0.85 OR confirmed by caller in a clarification turn
  - No unresolved contradictions
  - `intake_sessions.job_id IS NULL` (not already finalized)
- **Follow-up prompt required:** No — proceed to finalization

#### `manual_review_required`
- **Conditions (any one sufficient):**
  - Same field has failed clarification 3 times
  - Caller hung up while still `incomplete` or `needs_clarification`
  - Extraction returns no fields for 3 consecutive turns
  - `pickup_location_candidate` cannot be geocoded after 2 attempts
- **Follow-up prompt required:** No — escalate to dispatcher; inform caller

---

## 4. Finalization Contract

### Minimum required field set

```
user_id_candidate          → NOT NULL
pickup_location_candidate  → NOT NULL, geocoded (gps_lat_candidate + gps_lng_candidate set)
incident_type_id_candidate → NOT NULL, valid FK to incident_types
can_vehicle_roll_candidate → NOT NULL if incident requires it
```

If any minimum field is missing, `finalize-intake-to-job` rejects with `finalization_blocked` and writes to `system_events`. No job created.

### Finalization sequence (ordered)

1. **Guard:** Read `intake_sessions.job_id` — if already set, abort with `duplicate_finalization`. No job created.
2. **Guard:** Read `job_payload_candidates.is_finalized` — if already true, abort. No job created.
3. **Map** candidate fields to `intake-create-job` payload:

```
pickup_location_candidate    → pickup_location
gps_lat_candidate            → gps_lat
gps_lng_candidate            → gps_lng
incident_type_id_candidate   → incident_type_id
vehicle_make_candidate       → vehicle_make
vehicle_model_candidate      → vehicle_model
vehicle_year_candidate       → vehicle_year
can_vehicle_roll_candidate   → can_vehicle_roll
user_id_candidate            → user_id
```

4. **Call** `intake-create-job` (existing v9, no changes). Receive `job_id` in response.
5. **Freeze:** `UPDATE job_payload_candidates SET is_finalized = true, finalized_at = now() WHERE session_id = ? AND is_finalized = false`. If 0 rows updated → race condition → abort, log `finalization_race`.
6. **Stamp:** `UPDATE intake_sessions SET job_id = ?, session_status = 'completed'`.
7. **Log:** `system_events` — `handoff_triggered`, `event_category = handoff`, payload includes `job_id`, `session_id`, `candidate_id`.
8. **Log:** `decision_logs` — `decision_type = finalization`, `decision_outcome = job_created`, `factors` = field confidence map.

### Duplicate job creation prevention

| Mechanism | Layer |
|---|---|
| `intake_sessions.job_id IS NULL` guard before calling `intake-create-job` | Application |
| `job_payload_candidates.is_finalized = false` guard + zero-row-update detection | Application |
| `chk_finalized_immutable` CHECK constraint blocks second finalization | Database |
| `intake-create-job` is idempotent per existing design | Existing edge function |

### Handoff log records

**`system_events` record:**
```
event_category = 'handoff'
event_type     = 'handoff_triggered'
session_id     = <session>
job_id         = <created job>
message        = { candidate_id, field_confidence_summary, finalized_at }
```

**`decision_logs` record:**
```
decision_type             = 'finalization'
decision_outcome          = 'job_created'
session_id                = <session>
job_id                    = <created job>
factors                   = { field: confidence } map for all required fields
alternatives_considered   = null
```

---

## 5. Function / Service Design

### `voice-webhook`

| | |
|---|---|
| Purpose | Twilio Voice inbound handler — TwiML orchestrator |
| Inputs | Twilio `CallSid`, `From` (caller phone), `SpeechResult` (per turn) |
| Outputs | TwiML response (`<Gather>` for next prompt, `<Hangup>` on completion) |
| DB reads | `intake_sessions` (resume check by caller phone) |
| DB writes | None directly — delegates to other functions |
| Idempotency | Yes — same `CallSid` must not create duplicate sessions |
| Must NOT | Write to `jobs`, `job_events`, `dispatch_offers`, or any execution layer table |

### `start-intake-session`

| | |
|---|---|
| Purpose | Create or resume an intake session for an inbound call |
| Inputs | `call_sid`, `caller_phone`, `channel = "voice"` |
| Outputs | `{ session_id, candidate_id, resumed: bool }` |
| DB reads | `intake_sessions` by `caller_phone` + `session_status IN (active, abandoned)` within resume window |
| DB writes | `intake_sessions` (insert), `job_payload_candidates` (insert empty draft), `system_events` |
| Idempotency | Yes — `call_sid` must be unique per session |
| Must NOT | Create a job, touch `jobs`, resolve dispatch |

### `append-intake-turn`

| | |
|---|---|
| Purpose | Record a raw caller or system utterance as a turn |
| Inputs | `session_id`, `role` (caller/system), `raw_transcript`, `turn_number` |
| Outputs | `{ turn_id }` |
| DB reads | `intake_sessions` (confirm active, not finalized) |
| DB writes | `intake_turns` (insert) |
| Idempotency | Yes — UNIQUE(session_id, turn_number) enforced at DB |
| Must NOT | Extract fields, update candidate, evaluate readiness |

### `extract-intake-turn`

| | |
|---|---|
| Purpose | Run LLM extraction on a turn's transcript; write structured fields back to the turn |
| Inputs | `turn_id`, `session_id`, `candidate_id` |
| Outputs | `{ extracted_fields: { field: { value, confidence } } }` |
| DB reads | `intake_turns` (current turn), `job_payload_candidates` (existing state for context), `incident_types` |
| DB writes | `intake_turns.extracted_fields`, `intake_turns.normalized_transcript`, `system_events` |
| Idempotency | Yes — re-running on same turn_id must be a no-op if already extracted |
| Must NOT | Write directly to `job_payload_candidates` |

### `update-payload-candidate`

| | |
|---|---|
| Purpose | Merge extracted fields from a turn into the live job_payload_candidates draft |
| Inputs | `candidate_id`, `extracted_fields`, `session_id` |
| Outputs | `{ updated_fields: [], contradiction_flags: [] }` |
| DB reads | `job_payload_candidates` (current state, including `is_finalized`) |
| DB writes | `job_payload_candidates` (per-field updates), `system_events` |
| Idempotency | Conditional — same turn applied twice must not change accepted state if threshold already met |
| Must NOT | Write if `is_finalized = true`. Must NOT resolve contradictions unilaterally — flag them only. |

### `evaluate-intake-readiness`

| | |
|---|---|
| Purpose | Inspect current candidate state and return a readiness verdict |
| Inputs | `session_id`, `candidate_id` |
| Outputs | `{ state, missing_fields: [], clarification_fields: [] }` |
| DB reads | `job_payload_candidates`, `incident_types`, `intake_turns` (clarification attempt count per field) |
| DB writes | `intake_sessions.session_status` (if state change), `system_events` |
| Idempotency | Yes — pure evaluation; no side effects beyond status stamp and event |
| Must NOT | Finalize the job, write to `jobs`, modify candidate field values |

### `finalize-intake-to-job`

| | |
|---|---|
| Purpose | Execute the safe crossing from intake layer to execution layer |
| Inputs | `session_id`, `candidate_id` |
| Outputs | `{ job_id, success: bool }` |
| DB reads | `job_payload_candidates` (all fields), `intake_sessions` (job_id null guard) |
| DB writes | `job_payload_candidates` (`is_finalized`, `finalized_at`), `intake_sessions` (`job_id`, `session_status`), `system_events`, `decision_logs` |
| External call | `intake-create-job` (existing v9, no changes) |
| Idempotency | Yes — if `intake_sessions.job_id` already set, return existing job_id, skip all writes |
| Must NOT | Call any other execution layer function. Must NOT set `job_status`, touch `dispatch_offers`, call Twilio SMS directly. `send-customer-confirmation` is called by `intake-create-job`, not by this function. |

### `log-system-event` (shared utility)

| | |
|---|---|
| Purpose | Centralized write to `system_events` |
| Inputs | `session_id`, `event_type`, `event_category`, `job_id` (optional), `message` (JSONB) |
| Outputs | `{ event_id }` |
| DB reads | None |
| DB writes | `system_events` (insert) |
| Idempotency | No — events are append-only |
| Must NOT | Write to `job_events` — that table is execution layer only |

---

## 6. Failure / Fallback Design

### Low confidence on a field

- Confidence < 0.65 on a required field: do not write to candidate; voice prompts specifically for that field.
- Confidence 0.65–0.84 on a required field: write tentatively; readiness evaluation flags `needs_clarification`; voice asks caller to confirm.
- After 3 clarification attempts on the same field with no improvement: escalate to `manual_review_required`.
- `system_events` logs `clarification_attempt` each time with attempt count.

### Conflicting values

- Contradiction detected in `update-payload-candidate` → write `contradiction_flagged` event with both values.
- Voice prompt: "I heard [new value]. You previously said [old value]. Which is correct?"
- Caller confirms one → confirmed value written with `confidence = 1.0`, source_turn updated.
- If caller confirms neither or is unclear → escalate.

### Caller hangs up

- Twilio fires `StatusCallback` with `CallStatus = completed` or `no-answer`.
- `voice-webhook` receives callback → marks session.
- If session is `active` or `needs_clarification`: set `session_status = abandoned`.
- `job_payload_candidates` preserved (not deleted, not finalized).
- `system_events` logs `session_abandoned`.
- No job created.

### Repeated caller (resume)

- On new inbound call from same phone: `start-intake-session` queries for `session_status = abandoned` within 30-minute resume window.
- If found: resume existing session, return existing `session_id` and `candidate_id`.
- Voice greets: "Welcome back. You called earlier about a [incident type] on [street]. Would you like to continue?"
- If caller says no: mark old session `expired`, create new session.
- `system_events` logs `session_resumed` or `session_expired`.

### Duplicate session

- Two calls from same `CallSid` (Twilio retry): `start-intake-session` guards on UNIQUE(call_sid).
- If session for `call_sid` already exists: return existing session without creating a new one.
- Two simultaneous calls from same phone: first INSERT wins; second gets existing session returned.

### Manual escalation

- Triggered by: `manual_review_required` state from `evaluate-intake-readiness`.
- Voice plays: "I'm connecting you with a dispatcher who can complete your request."
- `intake_sessions.session_status = manual_review_required`.
- `system_events` logs `handoff_triggered` with `outcome = escalated_to_dispatcher`.
- Dispatcher notification mechanism: TBD (flagged for next design phase).
- Session and candidate remain intact for dispatcher review.
- Dispatcher-created job should set `intake_sessions.job_id` to close the loop.

### Retry / resume of abandoned session

| Case | Handling |
|---|---|
| Caller calls back within 30 min | Resume session — same candidate, continue turn loop |
| Caller calls back after 30 min | New session, old session marked `expired` |
| Dispatcher resumes manually | Set `session_status = active`, continue via dispatcher interface (out of scope) |
| Finalization failed (intake-create-job error) | Session stays `active`, `is_finalized` remains false, error written to `system_events`, retry permitted |

---

## 7. Integration Boundary

### Explicit confirmations

| Statement | Confirmed |
|---|---|
| `jobs` is the final operational truth | Yes — no execution decision is made against any intake layer table |
| Voice writes to intake layer only during collection | Yes — `intake_turns`, `job_payload_candidates`, `system_events`, `intake_sessions` only |
| Execution begins only after finalized handoff via `intake-create-job` | Yes — `finalize-intake-to-job` calls `intake-create-job` as the single crossing point |
| AI Voice does not control dispatch | Yes — after `job_id` is returned, voice has no further role |
| `job_events` is not written by any voice function | Yes — all voice observability goes to `system_events` |
| `send-customer-confirmation` is not called by voice directly | Yes — fired by `intake-create-job` as today |
| Dispatch logic is not changed | Yes — `create-dispatch-offer`, `send-driver-sms`, `accept-driver-offer` untouched |
| SMS workflow is not changed | Yes — `twilio-webhook`, `send-customer-confirmation`, `send-payment-sms` untouched |

---

## Deferred Items (not in this design scope)

| ID | Item |
|---|---|
| Voice-D-1 | Dispatcher notification mechanism for `manual_review_required` sessions |
| Voice-D-2 | Dispatcher UI for reviewing and completing abandoned sessions |
| Voice-D-3 | Resume window duration (30 min assumed — confirm with product) |
| Voice-D-4 | LLM prompt design for `extract-intake-turn` (field schema, few-shot examples) |
| Voice-D-5 | TwiML script / voice persona for all prompt states |
| Voice-D-6 | Geocoding integration inside `evaluate-intake-readiness` (uses existing `geocode-location` edge function) |

---

*Next phase: Implementation planning — function stubs, deploy order, test harness design.*
