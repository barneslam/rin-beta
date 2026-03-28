import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, MapPin } from "lucide-react";

const LOCATION_TYPES = [
  { value: "roadside", label: "Roadside" },
  { value: "highway", label: "Highway" },
  { value: "residential", label: "Residential" },
  { value: "parking_lot", label: "Parking Lot" },
  { value: "underground", label: "Underground" },
  { value: "rural", label: "Rural" },
];

type JobData = {
  job_id: string;
  job_status: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  pickup_location: string | null;
  gps_lat: number | null;
  gps_long: number | null;
  location_type: string | null;
  incident_type_id: string | null;
  sms_confirmed: boolean;
};

type IncidentType = {
  incident_type_id: string;
  incident_name: string;
};

const CustomerJobConfirm = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<JobData | null>(null);
  const [incidentTypes, setIncidentTypes] = useState<IncidentType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"confirmed" | "cancelled" | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [form, setForm] = useState({
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: "",
    pickup_location: "",
    gps_lat: "",
    gps_long: "",
    location_type: "roadside",
    incident_type_id: "",
  });

  useEffect(() => {
    if (!jobId) return;
    const load = async () => {
      console.log(`[CHECKPOINT_CONFIRM_PAGE_LOAD] route jobId=${jobId}`);

      const [{ data: jobData, error }, { data: types }] = await Promise.all([
        supabase
          .from("jobs")
          .select("job_id, job_status, vehicle_make, vehicle_model, vehicle_year, pickup_location, gps_lat, gps_long, location_type, incident_type_id, sms_confirmed")
          .eq("job_id", jobId)
          .single(),
        supabase.from("incident_types").select("incident_type_id, incident_name").order("incident_name"),
      ]);

      if (error || !jobData) {
        console.error(`[CHECKPOINT_CONFIRM_PAGE_LOAD] fetch FAILED — jobId=${jobId} error=${error?.message ?? "not found"}`);
        setNotFound(true);
        setLoading(false);
        return;
      }

      console.log(`[CHECKPOINT_CONFIRM_PAGE_LOAD] job fetched — job_id=${jobData.job_id} job_status=${jobData.job_status} vehicle_make=${jobData.vehicle_make ?? "null"} vehicle_model=${jobData.vehicle_model ?? "null"} vehicle_year=${jobData.vehicle_year ?? "null"} pickup_location=${jobData.pickup_location ?? "null"} incident_type_id=${jobData.incident_type_id ?? "null"} sms_confirmed=${jobData.sms_confirmed}`);

      setJob(jobData);
      setIncidentTypes(types ?? []);

      // If already confirmed or cancelled, show the terminal state
      if (jobData.job_status === "ready_for_dispatch" || jobData.sms_confirmed) {
        setDone("confirmed");
      } else if (jobData.job_status === "cancelled_by_customer") {
        setDone("cancelled");
      }

      setForm({
        vehicle_make: jobData.vehicle_make ?? "",
        vehicle_model: jobData.vehicle_model ?? "",
        vehicle_year: jobData.vehicle_year ? String(jobData.vehicle_year) : "",
        pickup_location: jobData.pickup_location ?? "",
        gps_lat: jobData.gps_lat != null ? String(jobData.gps_lat) : "",
        gps_long: jobData.gps_long != null ? String(jobData.gps_long) : "",
        location_type: jobData.location_type ?? "roadside",
        incident_type_id: jobData.incident_type_id ?? "",
      });

      setLoading(false);
    };

    load();
  }, [jobId]);

  const handleConfirm = async () => {
    if (!jobId) return;
    setSubmitting(true);
    try {
      const updates: Record<string, unknown> = {
        job_status: "ready_for_dispatch",
        sms_confirmed: true,
        sms_confirmed_at: new Date().toISOString(),
        confirmation_channel: "web_link",
        vehicle_make: form.vehicle_make || null,
        vehicle_model: form.vehicle_model || null,
        vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null,
        pickup_location: form.pickup_location || null,
        gps_lat: form.gps_lat ? Number(form.gps_lat) : null,
        gps_long: form.gps_long ? Number(form.gps_long) : null,
        location_type: form.location_type || "roadside",
        incident_type_id: form.incident_type_id || null,
      };

      const { error } = await supabase.from("jobs").update(updates).eq("job_id", jobId);
      if (error) {
        toast.error("Could not confirm your request", { description: error.message });
        return;
      }

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "customer_confirmed",
        event_category: "lifecycle",
        message: "Customer confirmed job details via web link",
        new_value: { job_status: "ready_for_dispatch", confirmation_channel: "web_link" },
      });

      setDone("confirmed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("jobs").update({
        job_status: "cancelled_by_customer",
        cancelled_by: "customer",
        cancelled_reason: "Customer cancelled via confirmation link",
      }).eq("job_id", jobId);

      if (error) {
        toast.error("Could not cancel", { description: error.message });
        return;
      }

      await supabase.from("job_events").insert({
        job_id: jobId,
        event_type: "job_cancelled",
        event_category: "lifecycle",
        message: "Customer cancelled via confirmation link",
        new_value: { job_status: "cancelled_by_customer", cancelled_by: "customer" },
      });

      setDone("cancelled");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-6">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Request not found</h2>
            <p className="text-sm text-muted-foreground">This link may have expired or is invalid. Please call us if you need roadside assistance.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done === "confirmed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-6">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">You're confirmed</h2>
            <p className="text-sm text-muted-foreground">Your roadside request is confirmed and a dispatcher is assigning help. You'll receive a text when a driver is on the way.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done === "cancelled") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-6">
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Request cancelled</h2>
            <p className="text-sm text-muted-foreground">Your roadside request has been cancelled. No charges will be applied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold">Review your request</h1>
          <p className="text-sm text-muted-foreground mt-1">Confirm or correct the details below, then tap Confirm to dispatch help.</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Incident Type</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={form.incident_type_id} onValueChange={(v) => setForm((f) => ({ ...f, incident_type_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select incident type..." /></SelectTrigger>
              <SelectContent>
                {incidentTypes.map((t) => (
                  <SelectItem key={t.incident_type_id} value={t.incident_type_id}>{t.incident_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vehicle</CardTitle>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Address / Description</Label>
              <div className="flex gap-2 items-start">
                <MapPin className="w-4 h-4 mt-2.5 text-muted-foreground flex-shrink-0" />
                <Input
                  value={form.pickup_location}
                  onChange={(e) => setForm((f) => ({ ...f, pickup_location: e.target.value }))}
                  placeholder="123 Main St, Toronto"
                />
              </div>
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

        <div className="flex flex-col gap-3 pb-8">
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            className="w-full"
            size="lg"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Confirm — dispatch help
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={submitting}
            className="w-full text-muted-foreground"
          >
            Cancel my request
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CustomerJobConfirm;
