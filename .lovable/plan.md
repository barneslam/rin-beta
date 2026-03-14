

# Add Job Selector Dropdown to Header

The system already auto-selects newly created jobs (Option A is implemented). This plan adds Option B — a job selector dropdown in the `JobHeader` so operators can switch between existing jobs.

## Changes

### 1. Update `JobHeader.tsx`
- Add a `Select` dropdown that queries all jobs via `useJobs()`
- Display jobs as `{job_id short} — {vehicle_make} {vehicle_model} ({status})`
- When a job is selected, call `setActiveJobId()` to update context
- Show the dropdown alongside existing job details when a job is active, or prominently when no job is selected

### 2. No other files need changes
The `JobContext` already persists across all 7 screens via `AppLayout`. Selecting a job from the dropdown will immediately reflect in Validation, Dispatch, Pricing, Matching, Offer, and Tracking screens.

