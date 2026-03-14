

# Updated RIN Phase 1 Plan — With 6 Adjustments

All six requested adjustments are incorporated into the foundation build.

---

## Adjustment Summary

### 1. Database Indexes
Add indexes on high-frequency query columns:
- **jobs**: `job_status`, `assigned_driver_id`, `user_id`, `incident_type_id`, `created_at`
- **drivers**: `availability_status`
- **trucks**: `status`, `driver_id`, `truck_type_id`
- **dispatch_offers**: `job_id`, `driver_id`, `offer_status`, `expires_at`
- **audit_logs**: `job_id`, `timestamp`

### 2. GPS Precision
Use `numeric(10, 7)` for `gps_lat` and `gps_long` on the jobs table — provides ~1cm precision, suitable for mapping APIs.

### 3. Truck Types Reference Table
New **truck_types** table:
- `truck_type_id` (PK)
- `name` (e.g. flatbed, wheel_lift, heavy_duty, low_clearance_flatbed, service_truck)
- `description`
- `max_weight_capacity`
- `created_at`

All references to truck type in `trucks`, `jobs`, and `incident_types` become foreign keys to this table (`truck_type_id`) instead of free text.

### 4. Structured Equipment
New **equipment** reference table:
- `equipment_id` (PK)
- `name` (e.g. winch, dollies, lockout_kit, jump_pack, fuel_can, go_jacks)
- `description`

New **truck_equipment** junction table:
- `truck_id` FK → trucks
- `equipment_id` FK → equipment

On `jobs`, `required_equipment` becomes a `jsonb` array field (storing equipment IDs) for flexible per-job requirements without a junction table on the hot path.

On `incident_types`, `requires_special_equipment` becomes a `jsonb` array of equipment IDs.

### 5. Dispatch Offer Expiry
Add `expires_at` (timestamptz) to `dispatch_offers`. Indexed for expiry-scan queries.

### 6. Extended Audit Logs
Add two fields to `audit_logs`:
- `event_type` — enum: `job_created`, `job_updated`, `status_changed`, `driver_assigned`, `offer_sent`, `offer_responded`, `system_event`
- `event_source` — text field indicating origin (e.g. `intake_screen`, `dispatch_engine`, `driver_app`, `system`, `api`)

These support timeline rendering on the Job Tracking screen.

---

## Full Build Scope (unchanged items + adjustments)

### Database (11 tables total)
1. users
2. drivers
3. **truck_types** *(new)*
4. trucks (with `truck_type_id` FK)
5. **equipment** *(new)*
6. **truck_equipment** *(new junction)*
7. incident_types (with `truck_type_id` FK, `requires_special_equipment` jsonb)
8. pricing_rules
9. jobs (with `numeric(10,7)` GPS, `truck_type_id` FK, `required_equipment` jsonb)
10. dispatch_offers (with `expires_at`)
11. audit_logs (with `event_type`, `event_source`)
12. reviews

Plus all indexes listed in adjustment 1.

### Seed Data
- 5 truck types, ~10 equipment items, 10 drivers, 10 trucks with equipment assignments, 10 incident types, pricing rules, 2+ sample users

### Application Screens (7-step shell)
Unchanged from prior plan — Intake, Validation, Decision, Pricing, Matching, Offer, Tracking — with sidebar nav, Job Header, and step indicator. Design tokens: Trust Blue (#2563EB), Caution Amber (#F59E0B), Cool Gray (#F9FAFB), Deep Slate (#111827), Go Green (#10B981).

### Core Functionality
- Create/update jobs with automatic audit logging (now including `event_type` and `event_source`)
- Read all seed data from Supabase
- Job Tracking screen renders audit_logs as a timeline

