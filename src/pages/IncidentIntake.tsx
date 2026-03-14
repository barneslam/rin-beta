import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveJob } from "@/context/JobContext";
import { useCreateJob } from "@/hooks/useJobs";
import { useUsers, useIncidentTypes, useTruckTypes } from "@/hooks/useReferenceData";
import { toast } from "sonner";

const IncidentIntake = () => {
  const { setActiveJobId } = useActiveJob();
  const createJob = useCreateJob();
  const { data: users } = useUsers();
  const { data: incidentTypes } = useIncidentTypes();
  const { data: truckTypes } = useTruckTypes();

  const [form, setForm] = useState({
    user_id: "",
    incident_type_id: "",
    pickup_location: "",
    gps_lat: "",
    gps_long: "",
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: "",
  });

  const selectedUser = users?.find((u) => u.user_id === form.user_id);
  const selectedIncident = incidentTypes?.find((i) => i.incident_type_id === form.incident_type_id);

  const handleUserSelect = (userId: string) => {
    const user = users?.find((u) => u.user_id === userId);
    if (user) {
      setForm((f) => ({
        ...f,
        user_id: userId,
        vehicle_make: user.vehicle_make || "",
        vehicle_model: user.vehicle_model || "",
        vehicle_year: user.vehicle_year?.toString() || "",
      }));
    }
  };

  const handleSubmit = async () => {
    try {
      const job = await createJob.mutateAsync({
        user_id: form.user_id || undefined,
        incident_type_id: form.incident_type_id || undefined,
        pickup_location: form.pickup_location || undefined,
        gps_lat: form.gps_lat ? Number(form.gps_lat) : undefined,
        gps_long: form.gps_long ? Number(form.gps_long) : undefined,
        vehicle_make: form.vehicle_make || undefined,
        vehicle_model: form.vehicle_model || undefined,
        vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : undefined,
        required_truck_type_id: selectedIncident?.default_truck_type_id || undefined,
        required_equipment: selectedIncident?.requires_special_equipment || [],
        job_status: "intake_started",
      });
      setActiveJobId(job.job_id);
      toast.success("Job created", { description: `Job ${job.job_id.slice(0, 8)} started` });
    } catch (err) {
      toast.error("Failed to create job");
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 1 — Incident Intake</h1>
        <p className="text-sm text-muted-foreground">Capture incident details and create a new job.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Caller / Motorist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Select User</Label>
              <Select value={form.user_id} onValueChange={handleUserSelect}>
                <SelectTrigger><SelectValue placeholder="Select motorist..." /></SelectTrigger>
                <SelectContent>
                  {users?.map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedUser && (
              <div className="rounded bg-muted p-3 text-xs space-y-1">
                <p><span className="text-muted-foreground">Phone:</span> {selectedUser.phone}</p>
                <p><span className="text-muted-foreground">Email:</span> {selectedUser.email}</p>
              </div>
            )}
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
            <CardTitle className="text-base">Vehicle Details</CardTitle>
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
              <Label className="text-xs">Pickup Location</Label>
              <Input value={form.pickup_location} onChange={(e) => setForm((f) => ({ ...f, pickup_location: e.target.value }))} placeholder="123 Main St, Toronto" />
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
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSubmit} disabled={createJob.isPending} className="w-full md:w-auto">
        {createJob.isPending ? "Creating..." : "Create Job"}
      </Button>
    </div>
  );
};

export default IncidentIntake;
