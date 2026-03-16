

# Fix: Customer Tracking Status Mapping

## Single file change: `src/pages/CustomerTracking.tsx`

### 1. Expand `CUSTOMER_STEPS` to include exception statuses

Add `reassignment_required`, `driver_unavailable`, `job_amended`, and `customer_reapproval_pending` to the "Finding a Driver" step's `statuses` array.

### 2. Add calm subtitle for reassignment states

Instead of showing the raw internal status label (e.g. "Reassignment Required"), show **"We're securing the next available driver"** when the job is in a reassignment/retry state.

### Exact changes

**Lines 7–13** — Replace `CUSTOMER_STEPS` with expanded version plus a reassignment status set:

```typescript
const CUSTOMER_STEPS = [
  { key: "requested", label: "Help Requested", statuses: ["intake_started", "intake_completed", "validation_required"] },
  {
    key: "finding",
    label: "Finding a Driver",
    statuses: [
      "ready_for_dispatch",
      "dispatch_recommendation_ready",
      "driver_offer_prepared",
      "driver_offer_sent",
      "reassignment_required",
      "driver_unavailable",
      "job_amended",
      "customer_reapproval_pending",
    ],
  },
  { key: "enroute", label: "Driver On the Way", statuses: ["driver_assigned", "driver_enroute"] },
  { key: "arrived", label: "Driver Arrived", statuses: ["driver_arrived", "vehicle_loaded"] },
  { key: "done", label: "Complete", statuses: ["job_completed"] },
];

const REASSIGNMENT_STATUSES = new Set([
  "reassignment_required",
  "driver_unavailable",
  "job_amended",
  "customer_reapproval_pending",
]);
```

**Line 94–96** — Replace the raw status subtitle with a customer-friendly message when in a reassignment state:

```typescript
<p className="text-sm text-sidebar-accent-foreground/60">
  {REASSIGNMENT_STATUSES.has(job.job_status)
    ? "We're securing the next available driver"
    : JOB_STATUS_LABELS[job.job_status] || job.job_status}
</p>
```

### Status mapping summary

| Customer-facing step | Backend statuses |
|---|---|
| Help Requested | `intake_started`, `intake_completed`, `validation_required` |
| Finding a Driver | `ready_for_dispatch`, `dispatch_recommendation_ready`, `driver_offer_prepared`, `driver_offer_sent`, `reassignment_required`, `driver_unavailable`, `job_amended`, `customer_reapproval_pending` |
| Driver On the Way | `driver_assigned`, `driver_enroute` |
| Driver Arrived | `driver_arrived`, `vehicle_loaded` |
| Complete | `job_completed` |

### Confirmations

1. All exception/retry statuses now mapped to "Finding a Driver" (step index 1)
2. `reassignment_required` displays as **Finding a Driver** with subtitle **We're securing the next available driver**
3. The tracking page will no longer fall back to step 0 for pre-assignment exception states

