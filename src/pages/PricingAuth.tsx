import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveJob } from "@/context/JobContext";
import { useJob, useUpdateJob } from "@/hooks/useJobs";
import { usePricingRules, useIncidentTypes } from "@/hooks/useReferenceData";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { toast } from "sonner";
import {
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Car,
  Wrench,
  RefreshCw,
  Send,
  Info,
} from "lucide-react";

const PricingAuth = () => {
  const { activeJobId } = useActiveJob();
  const { data: job, refetch: refetchJob } = useJob(activeJobId);
  const { data: pricingRules } = usePricingRules();
  const { data: incidentTypes } = useIncidentTypes();
  const updateJob = useUpdateJob();

  const [manualPrice, setManualPrice] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);

  const incident = useMemo(
    () => incidentTypes?.find((i) => i.incident_type_id === job?.incident_type_id),
    [incidentTypes, job?.incident_type_id]
  );

  const rule = useMemo(
    () => pricingRules?.find((r) => r.incident_type_id === job?.incident_type_id),
    [pricingRules, job?.incident_type_id]
  );

  const suggestedPrice = useMemo(() => {
    if (!rule) return null;
    return (
      Number(rule.base_fee) +
      Number(rule.equipment_surcharge ?? 0) +
      Number(rule.complexity_surcharge ?? 0)
    );
  }, [rule]);

  // Initialize manual price from existing estimated_price or suggested
  const effectivePrice = manualPrice !== "" ? manualPrice : (
    job?.estimated_price ? String(Number(job.estimated_price).toFixed(2)) :
    suggestedPrice != null ? String(suggestedPrice.toFixed(2)) : ""
  );

  const hasPricing = job?.estimated_price != null && Number(job.estimated_price) > 0;
  const isDriverAssigned = !!job?.assigned_driver_id;
  const needsPricingForPayment =
    isDriverAssigned && !hasPricing &&
    ["payment_authorization_required", "payment_failed", "driver_assigned", "driver_enroute"].includes(job?.job_status ?? "");

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const handleSavePrice = async () => {
    const price = parseFloat(effectivePrice);
    if (isNaN(price) || price <= 0) {
      toast.error("Enter a valid price greater than $0");
      return;
    }
    setIsSaving(true);
    try {
      const oldPrice = job.estimated_price;
      await updateJob.mutateAsync({
        jobId: job.job_id,
        updates: { estimated_price: price },
        eventSource: "pricing_dispatcher",
      });
      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "pricing_set",
        event_category: "pricing",
        message: `Dispatcher set price to $${price.toFixed(2)}`,
        old_value: oldPrice != null ? { estimated_price: oldPrice } : null,
        new_value: { estimated_price: price },
      });
      setPriceSaved(true);
      await refetchJob();
      toast.success(`Price saved: $${price.toFixed(2)}`);
    } catch (e) {
      toast.error("Failed to save price");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendPaymentSms = async () => {
    setIsSendingSms(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-payment-sms", {
        body: { jobId: job.job_id },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success("Payment SMS sent to customer");
      } else {
        toast.error(data?.error || "Failed to send payment SMS");
      }
    } catch (e) {
      toast.error("Failed to send payment SMS");
    } finally {
      setIsSendingSms(false);
    }
  };

  const handleUseSuggested = () => {
    if (suggestedPrice != null) {
      setManualPrice(suggestedPrice.toFixed(2));
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 4 — Dispatcher Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Review job context, set estimated price, then enable customer payment.
        </p>
      </div>

      {/* Warning banner */}
      {needsPricingForPayment && (
        <div className="flex items-start gap-3 rounded-md border border-accent bg-accent/10 p-4">
          <AlertTriangle className="h-5 w-5 text-accent shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Driver assigned — pricing missing</p>
            <p className="text-xs text-muted-foreground">
              Payment cannot proceed until you set a price below.
            </p>
          </div>
        </div>
      )}

      {/* Price saved + driver assigned success */}
      {priceSaved && isDriverAssigned && hasPricing && (
        <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/10 p-4">
          <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">Price saved — payment enabled</p>
            <p className="text-xs text-muted-foreground mb-2">
              Customer can now authorize payment. Send the payment SMS below.
            </p>
            <Button
              size="sm"
              onClick={handleSendPaymentSms}
              disabled={isSendingSms}
            >
              {isSendingSms ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Send Payment SMS
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Job Context Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" /> Job Context
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Incident:</span>
              <span>{incident?.incident_name || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Car className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Vehicle:</span>
              <span>
                {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Pickup:</span>
              <span className="truncate">{job.pickup_location || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground ml-5">Location type:</span>
              <span>{job.location_type || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground ml-5">Can roll:</span>
              <Badge variant={job.can_vehicle_roll ? "default" : "secondary"}>
                {job.can_vehicle_roll == null ? "Unknown" : job.can_vehicle_roll ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground ml-5">Status:</span>
              <Badge variant="outline">{job.job_status}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Suggested Price Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Pricing Rule
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {rule ? (
              <>
                <div className="rounded bg-muted p-3 space-y-1 font-mono text-xs">
                  <p>Base Fee: <span className="font-medium">${Number(rule.base_fee).toFixed(2)}</span></p>
                  <p>Equipment: <span className="font-medium">${Number(rule.equipment_surcharge ?? 0).toFixed(2)}</span></p>
                  <p>Complexity: <span className="font-medium">${Number(rule.complexity_surcharge ?? 0).toFixed(2)}</span></p>
                  <div className="border-t border-border pt-1 mt-1">
                    <p className="text-sm">Suggested: <span className="font-bold text-primary">${suggestedPrice?.toFixed(2)}</span></p>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded bg-muted/50 border border-dashed border-border p-3 text-center">
                <p className="text-muted-foreground text-xs">
                  No pricing rule found for this incident type.
                </p>
                <p className="text-muted-foreground text-xs mt-1">
                  Enter a price manually below.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Price Input Card */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Set Estimated Price</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <label className="text-xs text-muted-foreground mb-1 block">Price ($)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={effectivePrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  className="font-mono text-lg"
                />
              </div>
              {suggestedPrice != null && (
                <Button variant="outline" size="sm" onClick={handleUseSuggested}>
                  Use Suggested (${suggestedPrice.toFixed(2)})
                </Button>
              )}
              <Button onClick={handleSavePrice} disabled={isSaving || !effectivePrice}>
                {isSaving ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <DollarSign className="h-4 w-4 mr-1.5" />}
                Save Price
              </Button>
            </div>
            {hasPricing && (
              <p className="text-xs text-muted-foreground mt-2">
                Current saved price: <span className="font-mono font-medium">${Number(job.estimated_price).toFixed(2)}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PricingAuth;
