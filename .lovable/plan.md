

# Regenerate Supabase Types

## Problem

`src/integrations/supabase/types.ts` is stale — it's missing `pending_completion_approval` from the `job_status` enum, causing a build error in `JobTracking.tsx`.

## Fix

This is a single-step fix:

1. **Trigger types regeneration** — Lovable auto-generates `src/integrations/supabase/types.ts` from the live database. Any code change that touches a Supabase integration file or migration will trigger regeneration. The simplest approach: make a no-op migration (e.g., a SQL comment) which forces the types file to refresh from the current DB schema.

2. **Verify** — After regeneration, confirm:
   - `job_status` enum in types includes all 23 values (including `pending_completion_approval`)
   - `JobTracking.tsx` builds without errors
   - No other stale type references remain

No manual edits to `types.ts`. No code changes needed beyond triggering the refresh.

