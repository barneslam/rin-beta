import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useCreateJob } from "@/hooks/useJobs";
import { useIncidentTypes } from "@/hooks/useReferenceData";
import { useAutoDispatchPipeline } from "@/hooks/useAutoDispatchPipeline";
import { createCustomerUser } from "@/hooks/useCreateCustomerUser";
import { toast } from "sonner";
import { createBlankPayload } from "@/types/intake";
import { processIntakePayload, matchIncidentTypeId } from "@/lib/intakeProcessor";

const COMMON_ISSUES = [
  { label: "Flat tire", keyword: "flat tire" },
  { label: "Won't start / Dead battery", keyword: "battery" },
  { label: "Locked out", keyword: "lockout" },
  { label: "Accident / Collision", keyword: "accident" },
  { label: "Stuck / Off road", keyword: "stuck" },
  { label: "Other", keyword: "" },
];

export default function CustomerFormIntake() {
  const navigate = useNavigate();
  const createJob = useCreateJob();
  const autoDispatch = useAutoDispatchPipeline();
  const { data: incidentTypes } = useIncidentTypes();

  const [issue, setIssue] = useState("");
  const [otherIssue, setOtherIssue] = useState("");
  const [location, setLocation] = useState("");
  const [gettingLocation, setGettingLocation] = useState(false);
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLong, setGpsLong] = useState<number | null>(null);
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [callerName, setCallerName] = useState("");
  const [callerPhone, setCallerPhone] = useState("");
  const [drivable, setDrivable] = useState<boolean | null>(null);
  const [towRequired, setTowRequired] = useState(false);
  const [destination, setDestination] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Location not available on this device");
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(pos.coords.latitude);
        setGpsLong(pos.coords.longitude);
        setLocation(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
        setGettingLocation(false);
      },
      () => {
        toast.error("Could not get your location");
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const incidentDesc = issue === "Other" ? otherIssue : issue;

    // Build canonical IntakePayload
    const payload = {
      ...createBlankPayload("form" as const),
      incident_description: incidentDesc,
      location_text: location,
      location_lat: gpsLat,
      location_lng: gpsLong,
      location_confidence: gpsLat != null ? ("high" as const) : ("low" as const),
      vehicle_make: vehicleMake,
      vehicle_model: vehicleModel,
      vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
      drivable,
      tow_required: towRequired,
      destination_text: towRequired ? destination : null,
      caller_name: callerName,
      caller_phone: callerPhone,
      field_confidence: {
        location: gpsLat != null ? ("high" as const) : ("medium" as const),
        incident: incidentDesc ? ("high" as const) : ("low" as const),
        vehicle: vehicleMake ? ("high" as const) : ("low" as const),
        drivable: drivable != null ? ("high" as const) : ("low" as const),
      },
    };

    const result = await processIntakePayload(payload);

    if (!result.ready) {
      toast.error(`Please provide: ${result.missingFieldLabels.join(", ")}`);
      return;
    }

    setSubmitting(true);
    try {
      const processed = result.payload;
      const incidentTypeId = matchIncidentTypeId(
        processed.incident_description,
        incidentTypes || []
      );

      const userId = await createCustomerUser({
        name: processed.caller_name || "Customer",
        phone: processed.caller_phone || undefined,
        vehicleMake: processed.vehicle_make || undefined,
        vehicleModel: processed.vehicle_model || undefined,
        vehicleYear: processed.vehicle_year ?? undefined,
      });

      const job = await createJob.mutateAsync({
        job_status: "intake_started",
        pickup_location: processed.location_text,
        gps_lat: processed.location_lat,
        gps_long: processed.location_lng,
        vehicle_make: processed.vehicle_make || null,
        vehicle_model: processed.vehicle_model || null,
        vehicle_year: processed.vehicle_year,
        vehicle_condition: processed.incident_description,
        can_vehicle_roll: processed.drivable,
        incident_type_id: incidentTypeId,
        user_id: userId,
        language: processed.language,
      } as any);

      try {
        await autoDispatch.mutateAsync(job.job_id);
      } catch (e) {
        console.warn("Auto-dispatch failed, job created but needs manual dispatch:", e);
      }
      navigate(`/track/${job.job_id}`);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-sidebar-background flex flex-col">
      <div className="p-4 flex items-center gap-3">
        <button onClick={() => navigate("/get-help")} className="text-sidebar-accent-foreground/50 hover:text-sidebar-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-sidebar-foreground">Request Help</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 px-5 pb-8 space-y-6 max-w-md mx-auto w-full">
        {/* What happened */}
        <div className="space-y-2">
          <Label className="text-sidebar-foreground">What happened?</Label>
          <Select value={issue} onValueChange={setIssue}>
            <SelectTrigger className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl">
              <SelectValue placeholder="Select an issue" />
            </SelectTrigger>
            <SelectContent>
              {COMMON_ISSUES.map((i) => (
                <SelectItem key={i.label} value={i.label}>{i.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {issue === "Other" && (
            <Textarea
              placeholder="Describe what happened..."
              value={otherIssue}
              onChange={(e) => setOtherIssue(e.target.value)}
              className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground rounded-xl resize-none"
            />
          )}
        </div>

        {/* Location */}
        <div className="space-y-2">
          <Label className="text-sidebar-foreground">Where are you?</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Address or intersection"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={useMyLocation}
              disabled={gettingLocation}
              className="h-12 rounded-xl border-sidebar-border text-sidebar-foreground shrink-0"
            >
              {gettingLocation ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Vehicle */}
        <div className="space-y-2">
          <Label className="text-sidebar-foreground">Vehicle</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Make" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
            <Input placeholder="Model" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
            <Input placeholder="Year" value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} type="number" className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
          </div>
        </div>

        {/* Drivable */}
        <div className="space-y-3">
          <Label className="text-sidebar-foreground">Can your vehicle still drive?</Label>
          <div className="flex gap-3">
            <Button
              type="button"
              variant={drivable === true ? "default" : "outline"}
              onClick={() => { setDrivable(true); setTowRequired(false); }}
              className="flex-1 h-12 rounded-xl border-sidebar-border"
            >
              Yes
            </Button>
            <Button
              type="button"
              variant={drivable === false ? "default" : "outline"}
              onClick={() => { setDrivable(false); setTowRequired(true); }}
              className="flex-1 h-12 rounded-xl border-sidebar-border"
            >
              No
            </Button>
          </div>
        </div>

        {/* Tow destination */}
        {(towRequired || drivable === false) && (
          <div className="space-y-2">
            <Label className="text-sidebar-foreground">Where should we tow your vehicle?</Label>
            <Input
              placeholder="Mechanic, home address, etc."
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl"
            />
          </div>
        )}

        {/* Contact */}
        <div className="space-y-2">
          <Label className="text-sidebar-foreground">Your info</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={callerName} onChange={(e) => setCallerName(e.target.value)} className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
            <Input placeholder="Phone *" value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} type="tel" className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
          </div>
        </div>

        {/* Submit */}
        <Button
          type="submit"
          disabled={submitting}
          className="w-full h-14 text-lg font-semibold rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 active:scale-[0.98] transition-all"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
          {submitting ? "Connecting..." : "Get Help"}
        </Button>
      </form>
    </div>
  );
}
