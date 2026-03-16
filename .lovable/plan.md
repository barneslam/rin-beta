

# Fix Dispatcher Handoff for Customer-Created Jobs

## Changes

### 1. `src/context/JobContext.tsx` — Persist activeJobId in sessionStorage
- Initialize state from `sessionStorage.getItem("activeJobId")`
- On `setActiveJobId`, write to `sessionStorage`

### 2. `src/pages/DispatchControlPanel.tsx` — Source column + smart routing
- Add **"Source"** column: show "Customer" if `user_id` is set, "Dispatcher" otherwise
- Change `openJob` to route based on job status:
  - `intake_started`, `intake_completed`, `validation_required`, `ready_for_dispatch`, `dispatch_recommendation_ready` → `/dispatch`
  - `driver_offer_prepared`, `driver_offer_sent` → `/offer`
  - `driver_assigned`, `driver_enroute`, `driver_arrived`, `vehicle_loaded`, `job_completed` → `/tracking`
  - Exception statuses (`customer_reapproval_pending`, `reassignment_required`, `driver_unavailable`, `cancelled_after_dispatch`) → `/dispatch`
- Also include `intake_started` and `intake_completed` in the "All Active" filter (currently excluded since they're not in COMPLETED but should verify)

### 3. `src/components/layout/AppSidebar.tsx` — Promote Control Panel
- Move Control Panel to the top of the sidebar, above the 7-step flow
- Give it a distinct visual treatment (e.g., bold label or separator) so dispatchers see it as the primary entry point

