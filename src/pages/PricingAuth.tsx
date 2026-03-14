import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { usePricingRules, useIncidentTypes } from "@/hooks/useReferenceData";

const PricingAuth = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: pricingRules } = usePricingRules();
  const { data: incidentTypes } = useIncidentTypes();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const incident = incidentTypes?.find((i) => i.incident_type_id === job.incident_type_id);
  const rule = pricingRules?.find((r) => r.incident_type_id === job.incident_type_id);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 4 — Pricing & Authorization</h1>
        <p className="text-sm text-muted-foreground">View pricing rules and authorization status. Pricing engine will plug in here.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pricing Rule</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {rule ? (
              <>
                <p><span className="text-muted-foreground">Incident:</span> {incident?.incident_name}</p>
                <div className="rounded bg-muted p-3 space-y-1 font-mono text-xs">
                  <p>Base Fee: <span className="font-medium">${Number(rule.base_fee).toFixed(2)}</span></p>
                  <p>Distance Rate: <span className="font-medium">${Number(rule.distance_rate_per_km).toFixed(2)}/km</span></p>
                  <p>Equipment Surcharge: <span className="font-medium">${Number(rule.equipment_surcharge).toFixed(2)}</span></p>
                  <p>Complexity Surcharge: <span className="font-medium">${Number(rule.complexity_surcharge).toFixed(2)}</span></p>
                  <div className="border-t pt-1 mt-1">
                    <p>Min Authorization: <span className="font-bold">${Number(rule.minimum_authorization).toFixed(2)}</span></p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No pricing rule found for this incident type.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Authorization</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div>
              <span className="text-muted-foreground text-xs">Estimated Price</span>
              <p className="text-2xl font-bold font-mono">
                {job.estimated_price ? `$${Number(job.estimated_price).toFixed(2)}` : "—"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Authorization Status</span>
              <div className="mt-1">
                <Badge variant={job.authorization_status === "approved" ? "default" : "secondary"}>
                  {job.authorization_status || "pending"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-dashed border-2">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">
              🔌 Pricing Engine will plug in here.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This module will calculate estimated price based on distance, equipment, complexity, and authorize payment.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PricingAuth;
