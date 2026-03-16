

# Customer-Facing Intake: "Get Help Now" + Chat/Form Paths

## Summary

Add four new customer-facing pages and one edge function. Customer routes render full-screen without the dispatcher sidebar. Both intake paths (chat and form) create jobs via the existing `useCreateJob` hook and navigate to a new lightweight customer tracking page.

## Architecture

```text
/              → Landing ("Get Help Now")
/get-help      → Choice (Chat with RIN / Type instead)
/get-help/chat → AI chat intake (streaming via edge function)
/get-help/form → Simple form intake
/track/:jobId  → Customer tracking (read-only job status)

Dispatcher routes (/intake, /validation, etc.) unchanged, wrapped in AppLayout
```

## Changes

### 1. `src/App.tsx` — Route restructure

Move `AppLayout` wrapper to only cover dispatcher routes. Customer routes render outside it:

```text
<BrowserRouter>
  <Routes>
    {/* Customer routes — no sidebar */}
    <Route path="/" element={<Landing />} />
    <Route path="/get-help" element={<GetHelpChoice />} />
    <Route path="/get-help/chat" element={<CustomerChatIntake />} />
    <Route path="/get-help/form" element={<CustomerFormIntake />} />
    <Route path="/track/:jobId" element={<CustomerTracking />} />

    {/* Dispatcher routes — with sidebar */}
    <Route path="/intake" element={<AppLayout><IncidentIntake /></AppLayout>} />
    ...
  </Routes>
</BrowserRouter>
```

AppLayout must be updated to not require being a parent of Routes — each dispatcher route wraps individually, or use a layout route pattern.

### 2. `src/pages/Landing.tsx` — New

- Full-screen, dark background (`bg-slate-900`), centered content
- RIN wordmark/logo
- Tagline: "Roadside assistance, fast."
- Large "Get Help Now" button — full-width on mobile, primary blue, large touch target
- Links to `/get-help`

### 3. `src/pages/GetHelpChoice.tsx` — New

- Dark calm background consistent with Landing
- "How would you like to get help?"
- Two large cards/buttons:
  - **Chat with RIN** — primary, message-circle icon, routes to `/get-help/chat`
  - **Type instead** — secondary/outline, keyboard icon, routes to `/get-help/form`
- Back link to `/`

### 4. `src/pages/CustomerFormIntake.tsx` — New

- Simple mobile-first form:
  - What happened? (select from common issues + "Other" with free text)
  - Where are you? (text input + "Use my location" GPS button)
  - Vehicle: make, model, year (simple inputs)
  - Your name, phone (simple inputs)
- On submit:
  - Fuzzy-match incident description to `incident_types` table
  - Call `useCreateJob` with `job_status: "intake_started"`
  - Navigate to `/track/:jobId`
- Does NOT use `useActiveJob` context (that's dispatcher-only)

### 5. `src/pages/CustomerChatIntake.tsx` — New

- Streaming AI chat interface
- Messages state, auto-scroll, mobile-optimized bubbles
- Calls `roadside-chat` edge function with SSE streaming
- When AI calls the `create_roadside_job` tool, the client extracts structured data, creates the job, navigates to `/track/:jobId`
- Shows "Connecting you to help..." transition after job creation
- Handles 429/402 errors with user-friendly messages

### 6. `src/pages/CustomerTracking.tsx` — New

- Reads `jobId` from URL params
- Fetches job via `useJob(jobId)`
- Shows: status badge, ETA, assigned driver name (if any), simple progress stepper
- Read-only — no dispatcher controls
- Calm mobile-first UI

### 7. `supabase/functions/roadside-chat/index.ts` — New edge function

- CORS headers
- System prompt: calm roadside assistant named RIN, collects incident info, location, vehicle details
- Uses `google/gemini-3-flash-preview` via Lovable AI gateway
- Tool definition for `create_roadside_job` with structured params
- Streams SSE response back to client
- Handles 429/402 from gateway

### 8. `supabase/config.toml` — Add function config

```toml
[functions.roadside-chat]
verify_jwt = false
```

## Files

| File | Action |
|------|--------|
| `src/App.tsx` | Modified — split customer/dispatcher routes |
| `src/components/layout/AppLayout.tsx` | Minor update if needed for non-wrapping pattern |
| `src/pages/Landing.tsx` | New |
| `src/pages/GetHelpChoice.tsx` | New |
| `src/pages/CustomerChatIntake.tsx` | New |
| `src/pages/CustomerFormIntake.tsx` | New |
| `src/pages/CustomerTracking.tsx` | New |
| `supabase/functions/roadside-chat/index.ts` | New |
| `supabase/config.toml` | Modified |

## No database changes required

Both paths use the existing `jobs` table with `job_status: "intake_started"` which already exists in the enum.

