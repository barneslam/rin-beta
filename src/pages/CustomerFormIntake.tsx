import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateJob } from "@/hooks/useJobs";
import { useIncidentTypes } from "@/hooks/useReferenceData";
import { useAutoDispatchPipeline } from "@/hooks/useAutoDispatchPipeline";
import { toast } from "sonner";

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

  function matchIncidentType(): string | null {
    if (!incidentTypes?.length) return null;
    const keyword = COMMON_ISSUES.find((i) => i.label === issue)?.keyword || otherIssue;
    if (!keyword) return null;
    const lower = keyword.toLowerCase();
    const match = incidentTypes.find(
      (t) =>
        t.incident_name.toLowerCase().includes(lower) ||
        (t.description && t.description.toLowerCase().includes(lower))
    );
    return match?.incident_type_id ?? incidentTypes[0]?.incident_type_id ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!issue || !location) {
      toast.error("Please tell us what happened and where you are");
      return;
    }
    setSubmitting(true);
    try {
      const incidentTypeId = matchIncidentType();
      const job = await createJob.mutateAsync({
        job_status: "intake_started",
        pickup_location: location,
        gps_lat: gpsLat,
        gps_long: gpsLong,
        vehicle_make: vehicleMake || null,
        vehicle_model: vehicleModel || null,
        vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
        vehicle_condition: issue === "Other" ? otherIssue : issue,
        incident_type_id: incidentTypeId,
      });
      // Auto-dispatch: classify + send driver offer via existing pipeline
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
      {/* Header */}
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
          <Label className="text-sidebar-foreground">Vehicle <span className="text-sidebar-accent-foreground/40">(optional)</span></Label>
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Make" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
            <Input placeholder="Model" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
            <Input placeholder="Year" value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} type="number" className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-2">
          <Label className="text-sidebar-foreground">Your info <span className="text-sidebar-accent-foreground/40">(optional)</span></Label>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={callerName} onChange={(e) => setCallerName(e.target.value)} className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
            <Input placeholder="Phone" value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} type="tel" className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
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
