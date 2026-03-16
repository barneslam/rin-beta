

# Insert Test Driver: Barnes Lam

## What we need to insert

Two records — a driver and a truck — so the dispatch engine can match this driver to jobs requiring a `service_truck`.

### 1. Driver record (`drivers` table)

| Field | Value |
|-------|-------|
| driver_name | Barnes Lam |
| phone | +16472847417 |
| availability_status | available |
| rating | 5 |
| reliability_score | 100 |
| gps_lat | 43.6532 |
| gps_long | -79.3832 |
| service_radius_km | 50 |

GPS is set to downtown Toronto (based on the +1 647 area code) so the driver will match jobs in that area. Reliability score set to 100 to ensure eligibility (engine requires >= 60).

### 2. Truck record (`trucks` table)

| Field | Value |
|-------|-------|
| driver_id | (the new driver's ID) |
| truck_type_id | `a1000000-0000-0000-0000-000000000005` (service_truck) |
| status | available |

### Dispatch eligibility confirmation

The dispatch engine (`dispatchEngine.ts`) requires:
- Driver `availability_status = 'available'` — yes
- Driver `reliability_score >= 60` — yes (100)
- Driver has GPS coordinates — yes (Toronto)
- A truck linked to this driver with matching `truck_type_id` and `status = 'available'` — yes

This driver will be eligible for any job that classifies as needing a `service_truck`.

### Implementation

Two data inserts using the insert tool (no schema changes needed). The driver ID from the first insert will be used for the truck's `driver_id`.

