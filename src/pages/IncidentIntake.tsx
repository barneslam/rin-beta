import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveJob } from "@/context/JobContext";
import { useIncidentTypes, useTruckTypes } from "@/hooks/useReferenceData";
import { useDeviceLocation } from "@/hooks/useDeviceLocation";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { toast } from "sonner";
import { Navigation, Loader2, CheckCircle2, MapPin } from "lucide-react";

const LOCATION_TYPES = [
  { value: "roadside", label: "Roadside" },
  { value: "highway", label: "Highway" },
  { value: "residential", label: "Residential" },
  { value: "parking_lot", label: "Parking Lot" },
  { value: "underground", label: "Underground" },
  { value: "rural", label: "Rural" },
];

const IncidentIntake = () => {
  const { setActiveJobId } = useActiveJob();
  const { data: incidentTypes } = useIncidentTypes();
  const { data: truckTypes } = useTruckTypes();
  const geo = useDeviceLocation();
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    caller_phone: "",
    caller_name: "",
    incident_type_id: "",
    pickup_location: "",
    gps_lat: "",
    gps_long: "",
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: "",
    vehicle_condition: "",
    can_vehicle_roll: "" as "" | "yes" | "no",
    location_type: "roadside",
  });

  const selectedIncident = incidentTypes?.find((i) => i.incident_type_id === form.incident_type_id);

  // Sync device GPS into form
  useEffect(() => {
    if (geo.status === "success" && geo.lat != null && geo.lng != null) {
      setForm((f) => ({
        ...f,
        gps_lat: geo.lat!.toFixed(7),
        gps_long: geo.lng!.toFixed(7),
      }));
      // Reverse geocode for human-readable address
      fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${geo.lat}&lon=${geo.lng}&format=json`,
        { headers: { "User-Agent": "RIN-Roadside-Intake/1.0" } }
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.display_name) {
            setForm((f) => ({ ...f, pickup_location: data.display_name }));
          }
        })
        .catch(() => {});
    }
  }, [geo.status, geo.lat, geo.lng]);

  // Infer location_type from incident description
  useEffect(() => {
    if (selectedIncident) {
      const name = selectedIncident.incident_name.toLowerCase();
      if (name.includes("highway") || name.includes("accident") || name.includes("collision")) {
        setForm((f) => ({ ...f, location_type: f.location_type === "roadside" ? "highway" : f.location_type }));
      }
    }
  }, [selectedIncident]);

  const handleSubmit = async () => {
    if (!form.caller_phone.trim()) {
      toast.error("Phone number is required");
      return;
    }
    if (!form.incident_type_id) {
      toast.error("Please select an incident type");
      return;
    }
    const hasGps = form.gps_lat && form.gps_long;
    if (!hasGps && !form.pickup_location.trim()) {
      toast.error("Please provide a location (use device GPS or enter an address)");
      return;
    }

    setSubmitting(true);
    try {
      // Steps 1 + 2 are enforced server-side:
      //   [INTAKE-JOB] Step 1 — phone normalize + users upsert
      //   [INTAKE-JOB] Step 2 — jobs insert (only runs if Step 1 succeeds)
      // UI does not advance unless the Edge Function returns success: true.
      const { data, error } = await supabase.functions.invoke("intake-create-job", {
        body: {
          phone: form.caller_phone,
          name: form.caller_name || undefined,
          vehicleMake: form.vehicle_make || undefined,
          vehicleModel: form.vehicle_model || undefined,
          vehicleYear: form.vehicle_year ? Number(form.vehicle_year) : undefined,
          vehicleCondition: form.vehicle_condition || undefined,
          canVehicleRoll: form.can_vehicle_roll === "yes" ? true : form.can_vehicle_roll === "no" ? false : undefined,
          incidentTypeId: form.incident_type_id || undefined,
          pickupLocation: form.pickup_location || undefined,
          gpsLat: form.gps_lat ? Number(form.gps_lat) : undefined,
          gpsLong: form.gps_long ? Number(form.gps_long) : undefined,
          locationType: form.location_type || "roadside",
          requiredTruckTypeId: selectedIncident?.default_truck_type_id || undefined,
          requiredEquipment: selectedIncident?.requires_special_equipment || [],
        },
      });

      if (error || !data?.success) {
        const reason = (data?.error as string) ?? error?.message ?? "Unknown error";
        toast.error("Failed to create job", { description: reason });
        return;
      }

      setActiveJobId(data.job_id as string);
      toast.success("Job created", { description: `Job ${(data.job_id as string).slice(0, 8)} started` });
    } catch (err) {
      toast.error("Failed to create job");
    } finally {
      setSubmitting(false);
    }
  };

  const geoLabel =
    geo.status === "idle" ? "Use Device Location" :
    geo.status === "requesting" ? "Getting location..." :
    geo.status === "success" ? "Location captured ✓" :
    geo.status === "denied" ? "Access denied" :
    "Retry location";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 1 — Incident Intake</h1>
        <p className="text-sm text-muted-foreground">Capture incident details and create a new job.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Caller Info — phone-based, no user select */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Caller / Motorist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Phone Number *</Label>
              <Input
                value={form.caller_phone}
                onChange={(e) => setForm((f) => ({ ...f, caller_phone: e.target.value }))}
                placeholder="+1 555-123-4567"
                type="tel"
              />
            </div>
            <div>
              <Label className="text-xs">Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={form.caller_name}
                onChange={(e) => setForm((f) => ({ ...f, caller_name: e.target.value }))}
                placeholder="Customer name"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Incident Type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={form.incident_type_id} onValueChange={(v) => setForm((f) => ({ ...f, incident_type_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select incident..." /></SelectTrigger>
              <SelectContent>
                {incidentTypes?.map((t) => (
                  <SelectItem key={t.incident_type_id} value={t.incident_type_id}>{t.incident_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedIncident && (
              <div className="rounded bg-muted p-3 text-xs space-y-1">
                <p>{selectedIncident.description}</p>
                <p><span className="text-muted-foreground">Complexity:</span> Level {selectedIncident.complexity_level}</p>
                <p><span className="text-muted-foreground">Default Truck:</span> {truckTypes?.find((t) => t.truck_type_id === selectedIncident.default_truck_type_id)?.name || "N/A"}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vehicle Details <span className="text-xs font-normal text-muted-foreground">(year optional)</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Make</Label>
                <Input value={form.vehicle_make} onChange={(e) => setForm((f) => ({ ...f, vehicle_make: e.target.value }))} placeholder="Toyota" />
              </div>
              <div>
                <Label className="text-xs">Model</Label>
                <Input value={form.vehicle_model} onChange={(e) => setForm((f) => ({ ...f, vehicle_model: e.target.value }))} placeholder="Camry" />
              </div>
              <div>
                <Label className="text-xs">Year</Label>
                <Input value={form.vehicle_year} onChange={(e) => setForm((f) => ({ ...f, vehicle_year: e.target.value }))} placeholder="2021" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Is vehicle drivable?</Label>
                <Select value={form.can_vehicle_roll} onValueChange={(v) => setForm((f) => ({ ...f, can_vehicle_roll: v as "" | "yes" | "no" }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Vehicle condition <span className="text-muted-foreground">(optional)</span></Label>
                <Input value={form.vehicle_condition} onChange={(e) => setForm((f) => ({ ...f, vehicle_condition: e.target.value }))} placeholder="e.g. flat tire, engine off" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Device GPS button */}
            <Button
              type="button"
              variant={geo.status === "success" ? "secondary" : "outline"}
              onClick={geo.requestLocation}
              disabled={geo.status === "requesting"}
              className="w-full gap-2"
            >
              {geo.status === "requesting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : geo.status === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <Navigation className="w-4 h-4" />
              )}
              {geoLabel}
            </Button>

            <div>
              <Label className="text-xs">Pickup Location</Label>
              <Input
                value={form.pickup_location}
                onChange={(e) => setForm((f) => ({ ...f, pickup_location: e.target.value }))}
                placeholder="123 Main St, Toronto"
              />
              {geo.status === "success" && form.pickup_location && (
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  <MapPin className="w-3 h-3 inline mr-1" />Auto-filled from device GPS
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Latitude</Label>
                <Input value={form.gps_lat} onChange={(e) => setForm((f) => ({ ...f, gps_lat: e.target.value }))} placeholder="43.6532" className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">Longitude</Label>
                <Input value={form.gps_long} onChange={(e) => setForm((f) => ({ ...f, gps_long: e.target.value }))} placeholder="-79.3832" className="font-mono text-xs" />
              </div>
            </div>

            <div>
              <Label className="text-xs">Location Type</Label>
              <Select value={form.location_type} onValueChange={(v) => setForm((f) => ({ ...f, location_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCATION_TYPES.map((lt) => (
                    <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSubmit} disabled={submitting} className="w-full md:w-auto">
        {submitting ? "Creating..." : "Create Job"}
      </Button>
    </div>
  );
};

export default IncidentIntake;
