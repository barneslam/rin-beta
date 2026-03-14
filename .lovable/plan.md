

# Add GPS Coordinate Inputs to Incident Validation

## Change

Update the Location card in `IncidentValidation.tsx` (lines 151-161) to include two editable number inputs for GPS Latitude and GPS Longitude. Each input saves to the `jobs` table on blur via `useUpdateJob`, matching the existing pattern used for `vehicle_condition`.

### `src/pages/IncidentValidation.tsx`
- Replace the static GPS display (`{job.gps_lat}, {job.gps_long}`) with two `Input` fields
- Field 1: `GPS Latitude` — `type="number"`, `step="0.000001"`, placeholder `"e.g. 43.6532"`, saves to `gps_lat`
- Field 2: `GPS Longitude` — `type="number"`, `step="0.000001"`, placeholder `"e.g. -79.3832"`, saves to `gps_long`
- Both use `defaultValue` from job and `onBlur` to persist via `updateJob.mutate()` (same pattern as Condition Notes input)
- The existing `validateJobForDispatch` already checks `gps_lat` and `gps_long` as required fields, so the validation status card and confirm button will update automatically when these are filled

No other files need changes.

