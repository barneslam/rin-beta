import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Loader2, CheckCircle2, MessageSquare, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateJob } from "@/hooks/useJobs";
import { useIncidentTypes } from "@/hooks/useReferenceData";
import { useAutoDispatchPipeline } from "@/hooks/useAutoDispatchPipeline";
import { findOrCreateUserByPhone } from "@/hooks/useCreateCustomerUser";
import { useDeviceLocation } from "@/hooks/useDeviceLocation";
import { toast } from "sonner";
import { createBlankPayload } from "@/types/intake";
import { processIntakePayload, matchIncidentTypeId } from "@/lib/intakeProcessor";
import { supabase } from "@/integrations/supabase/client";

const COMMON_ISSUES = [
  { label: "Flat tire", keyword: "flat tire" },
  { label: "Won't start / Dead battery", keyword: "battery" },
  { label: "Locked out", keyword: "lockout" },
  { label: "Accident / Collision", keyword: "accident" },
  { label: "Stuck / Off road", keyword: "stuck" },
  { label: "Other", keyword: "" },
];

type FormStep = "form" | "confirming" | "confirmed";

export default function CustomerFormIntake() {
  const navigate = useNavigate();
  const createJob = useCreateJob();
  const autoDispatch = useAutoDispatchPipeline();
  const { data: incidentTypes } = useIncidentTypes();
  const geo = useDeviceLocation();

  const [issue, setIssue] = useState("");
  const [otherIssue, setOtherIssue] = useState("");
  const [location, setLocation] = useState("");
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

  // Confirmation gate state
  const [step, setStep] = useState<FormStep>("form");
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [confirmingWeb, setConfirmingWeb] = useState(false);

  // Sync device location into form when captured
  useEffect(() => {
    if (geo.status === "success" && geo.lat != null && geo.lng != null) {
      setGpsLat(geo.lat);
      setGpsLong(geo.lng);
      // Attempt reverse geocode for human-readable address
      reverseGeocode(geo.lat, geo.lng).then((addr) => {
        if (addr) setLocation(addr);
        else setLocation(`${geo.lat!.toFixed(5)}, ${geo.lng!.toFixed(5)}`);
      });
    }
  }, [geo.status, geo.lat, geo.lng]);

  async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { "User-Agent": "RIN-Roadside-Intake/1.0" } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.display_name || null;
    } catch {
      return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!callerPhone.trim()) {
      toast.error("Phone number is required");
      return;
    }

    const incidentDesc = issue === "Other" ? otherIssue : issue;

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

      // Find or create user by phone
      const userId = await findOrCreateUserByPhone({
        phone: processed.caller_phone,
        name: processed.caller_name || undefined,
        vehicleMake: processed.vehicle_make || undefined,
        vehicleModel: processed.vehicle_model || undefined,
        vehicleYear: processed.vehicle_year ?? undefined,
      });

      const job = await createJob.mutateAsync({
        job_status: "intake_completed",
        pickup_location: processed.location_text || null,
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
        location_type: "roadside",
        sms_confirmed: false,
      } as any);

      setCreatedJobId(job.job_id);

      // Send confirmation SMS (fire-and-forget)
      supabase.functions.invoke("send-customer-confirmation", {
        body: {
          phone: processed.caller_phone,
          jobId: job.job_id,
          userName: processed.caller_name,
          channel: "form",
        },
      }).catch((err) => console.error("Confirmation SMS error:", err));

      setStep("confirming");
      setSubmitting(false);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleWebConfirm() {
    if (!createdJobId) return;
    setConfirmingWeb(true);
    try {
      await supabase.from("jobs").update({
        sms_confirmed: true,
        sms_confirmed_at: new Date().toISOString(),
        confirmation_channel: "web",
      } as any).eq("job_id", createdJobId);

      await supabase.from("job_events" as any).insert([{
        job_id: createdJobId,
        event_type: "customer_confirmed_web",
        event_category: "communication",
        message: "Customer confirmed request via web button",
      }] as any);

      setStep("confirmed");

      try {
        await autoDispatch.mutateAsync(createdJobId);
      } catch (e) {
        console.warn("Auto-dispatch failed, job confirmed but needs manual dispatch:", e);
      }

      navigate(`/track/${createdJobId}`);
    } catch {
      toast.error("Could not confirm. Please try again.");
      setConfirmingWeb(false);
    }
  }

  // Confirmation waiting screen
  if (step === "confirming" || step === "confirmed") {
    return (
      <div className="min-h-screen bg-sidebar-background flex flex-col items-center justify-center px-5">
        <div className="max-w-sm w-full text-center space-y-6">
          {step === "confirming" ? (
            <>
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-sidebar-foreground">Confirm your request</h2>
              <p className="text-sidebar-foreground/70 text-sm">
                We sent a confirmation SMS to <span className="font-medium text-sidebar-foreground">{callerPhone}</span>.
                Reply <span className="font-bold">YES</span> to confirm, or tap the button below.
              </p>
              <Button
                onClick={handleWebConfirm}
                disabled={confirmingWeb}
                className="w-full h-14 text-lg font-semibold rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"
              >
                {confirmingWeb ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
                Confirm Now
              </Button>
              <p className="text-xs text-sidebar-foreground/40">
                Dispatch will begin after confirmation.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-sidebar-foreground">Confirmed!</h2>
              <p className="text-sidebar-foreground/70 text-sm">Finding you a driver now...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const geoLabel =
    geo.status === "idle" ? "Use my location" :
    geo.status === "requesting" ? "Getting location..." :
    geo.status === "success" ? "Location captured ✓" :
    geo.status === "denied" ? "Access denied — enter below" :
    "Retry location";

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

        {/* Location — device-first */}
        <div className="space-y-2">
          <Label className="text-sidebar-foreground">Where are you?</Label>
          <Button
            type="button"
            variant={geo.status === "success" ? "secondary" : "outline"}
            onClick={geo.requestLocation}
            disabled={geo.status === "requesting"}
            className="w-full h-12 rounded-xl border-sidebar-border text-sidebar-foreground gap-2"
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
          {(geo.status !== "success" || !gpsLat) && (
            <Input
              placeholder="Address, intersection, or landmark"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl"
            />
          )}
          {geo.status === "success" && location && (
            <p className="text-xs text-muted-foreground truncate px-1">
              <MapPin className="w-3 h-3 inline mr-1" />{location}
            </p>
          )}
        </div>

        {/* Vehicle */}
        <div className="space-y-2">
          <Label className="text-sidebar-foreground">Vehicle <span className="text-muted-foreground text-xs font-normal">(year optional)</span></Label>
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
            <Input placeholder="Name (optional)" value={callerName} onChange={(e) => setCallerName(e.target.value)} className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-12 rounded-xl" />
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
