

# Voice Intake + Dispatch Intelligence + Diagnostics — Implementation Plan

## Current State

- **Intake**: Chat + Form both produce `IntakePayload` via `processIntakePayload()` → job creation → auto-dispatch
- **Dispatch ranking**: 4-factor (proximity 0.40, rating 0.30, reliability 0.20, workload 0.10 static placeholder)
- **ElevenLabs connector**: Not connected. Must be connected before voice works.
- **No diagnostics page** exists yet
- **No `/get-help/voice` route** exists

---

## 1. Voice Intake Layer

### Connect ElevenLabs
Use the ElevenLabs connector (`connector_id: elevenlabs`) to get the API key. Create an edge function to generate conversation tokens.

### New Files

**`supabase/functions/elevenlabs-conversation-token/index.ts`**
- Reads `ELEVENLABS_API_KEY` from env
- Accepts `agent_id` in request body
- Calls ElevenLabs token endpoint, returns `{ token }`
- Standard CORS headers, `verify_jwt = false`

**`src/pages/CustomerVoiceIntake.tsx`**
- Uses `@elevenlabs/react` `useConversation` hook
- UI: microphone permission request → "Call RIN" button → speaking/listening indicator → transcript display
- `clientTools.create_roadside_job` receives structured data from the ElevenLabs agent
- Builds `IntakePayload` with `intake_source: "voice"`, runs `processIntakePayload()`, then creates job via existing pipeline (same as chat)
- On completion, navigates to `/track/:jobId`

### Updated Files

**`src/pages/GetHelpChoice.tsx`** — Add third "Call RIN" button (Phone icon) linking to `/get-help/voice`

**`src/App.tsx`** — Add route `<Route path="/get-help/voice" element={<CustomerVoiceIntake />} />`

**`supabase/config.toml`** — Add `[functions.elevenlabs-conversation-token]` with `verify_jwt = false`

---

## 2. Dispatch Intelligence Ranking

### Updated File: `src/lib/dispatchEngine.ts`

**New exported type:**
```typescript
interface DispatchScoreBreakdown {
  etaScore: number;
  distanceScore: number;
  capabilityScore: number;
  reliabilityScore: number;
  fairnessScore: number;
  totalScore: number;
}
```

**Update `RankedDriver`** to include `scoreBreakdown: DispatchScoreBreakdown`

**Update `rankDrivers()` signature** to accept additional context:
```typescript
rankDrivers(
  eligibleDrivers, job, eligibleTrucks,
  options?: { recentOfferCounts?: Map<string, number>, requiredTruckTypeId?: string }
)
```

**New weights:**
- ETA: 0.30 (normalize — shortest ETA = 1.0)
- Distance: 0.25 (normalize — closest = 1.0)
- Capability: 0.20 (1.0 exact truck match, 0.5 compatible, filtered if unsafe)
- Reliability: 0.15 (driver.reliability_score / 100)
- Fairness: 0.10 (fewer recent offers = higher score, replaces static 0.5)

**Update `filterEligibleDrivers()` signature** to accept exclusion sets:
```typescript
filterEligibleDrivers(
  job, drivers, eligibleTrucks, minReliability?,
  options?: { excludeDriverIds?: Set<string> }
)
```

### Updated File: `src/hooks/useDispatchEngine.ts`

In `useDispatchRecommendation`: query `dispatch_offers` for recent 24h offer counts per driver, and `jobs` for active reservations/assignments. Build exclusion set and `recentOfferCounts` map. Pass into `filterEligibleDrivers` and `rankDrivers`.

---

## 3. Dispatcher Diagnostics Panel

### New File: `src/pages/DispatchDiagnostics.tsx`

Route: `/diagnostics/:jobId` (dispatcher layout)

Shows for a selected job:
- **Job requirements** card: incident type, truck type, equipment, location
- **All drivers** table with filter/exclusion reasons (wrong truck, outside radius, low reliability, reserved, pending offer)
- **Ranked eligible drivers** with full score breakdown columns (ETA, distance, capability, reliability, fairness, total)
- **Offer history** from `dispatch_offers` table for this job

### Updated File: `src/pages/DriverMatching.tsx`

- Add score breakdown columns to ranked driver rows (ETA, Distance, Capability, Reliability, Fairness)
- Add "View Diagnostics" button linking to `/diagnostics/${job.job_id}`

### Updated File: `src/App.tsx`

Add route: `<Route path="/diagnostics/:jobId" element={<DispatcherLayout><DispatchDiagnostics /></DispatcherLayout>} />`

---

## Implementation Order

1. Connect ElevenLabs connector (requires user action)
2. Create `elevenlabs-conversation-token` edge function
3. Create `CustomerVoiceIntake.tsx` + update routes + GetHelpChoice
4. Update `dispatchEngine.ts` with 5-factor ranking + `DispatchScoreBreakdown`
5. Update `useDispatchEngine.ts` with reservation-aware filtering + fairness data
6. Update `DriverMatching.tsx` with score breakdown columns
7. Create `DispatchDiagnostics.tsx` page + route

No database changes needed — all tables and statuses already exist.

---

## Files Summary

| File | Action |
|------|--------|
| `supabase/functions/elevenlabs-conversation-token/index.ts` | New |
| `src/pages/CustomerVoiceIntake.tsx` | New |
| `src/pages/DispatchDiagnostics.tsx` | New |
| `src/lib/dispatchEngine.ts` | Update ranking to 5-factor + export breakdown type |
| `src/hooks/useDispatchEngine.ts` | Add reservation/fairness queries, pass to engine |
| `src/pages/DriverMatching.tsx` | Add score columns + diagnostics link |
| `src/pages/GetHelpChoice.tsx` | Add voice option |
| `src/App.tsx` | Add `/get-help/voice` + `/diagnostics/:jobId` routes |

