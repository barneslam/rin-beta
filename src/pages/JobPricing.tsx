import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DollarSign, Clock } from "lucide-react";

const JobPricing = () => {
  const { activeJobId } = useActiveJob();
  const { data: job, isLoading } = useJob(activeJobId);
  const [price, setPrice] = useState("");
  const [isPending, setIsPending] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">Loading…</p></div>;
  }

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const isPricingReady = job.job_status === "pending_pricing";
  const isAwaitingApproval = job.job_status === "pending_customer_price_approval";
  const isReadyForDispatch = job.job_status === "ready_for_dispatch";

  const handleSetPrice = async () => {
    const parsedPrice = Number(price);
    if (!parsedPrice || parsedPrice <= 0) {
      toast.error("Enter a valid price greater than $0");
      return;
    }
    setIsPending(true);
    try {
      const { data, error } = await supabase.functions.invoke("set-job-price", {
        body: { jobId: job.job_id, price: parsedPrice },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "set-job-price failed");

      if (data.sms_status === "failed") {
        toast.warning("Price set but SMS failed to send. Check customer phone.");
      } else {
        toast.success(`Price set to $${parsedPrice.toFixed(2)} — approval SMS sent to customer`);
      }
      queryClient.invalidateQueries({ queryKey: ["jobs", job.job_id] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 4 — Job Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Set the estimated price. Customer must approve before dispatch begins.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Job Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Vehicle:</span> {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}</p>
          <p><span className="text-muted-foreground">Location:</span> {job.pickup_location || "—"}</p>
          <p><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{job.job_status}</Badge></p>
          {job.estimated_price && (
            <p><span className="text-muted-foreground">Current Price:</span> <span className="font-mono font-medium">${Number(job.estimated_price).toFixed(2)}</span></p>
          )}
        </CardContent>
      </Card>

      {isPricingReady && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Set Estimated Price
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="pl-7"
                />
              </div>
              <Button onClick={handleSetPrice} disabled={isPending || !price}>
                {isPending ? "Sending…" : "Set Price & Notify Customer"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Customer will receive an SMS asking them to reply APPROVE. Dispatch begins after approval and credit card authorization.
            </p>
          </CardContent>
        </Card>
      )}

      {isAwaitingApproval && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="py-6 flex items-center gap-4">
            <Clock className="h-6 w-6 text-accent shrink-0" />
            <div>
              <p className="font-medium text-sm">Waiting for customer price approval</p>
              <p className="text-xs text-muted-foreground mt-1">
                Price approval SMS sent to customer. Dispatch will begin automatically once they approve and payment is authorized.
              </p>
              {job.estimated_price && (
                <p className="text-sm font-mono font-bold mt-2">${Number(job.estimated_price).toFixed(2)}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isReadyForDispatch && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="py-6 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Price approved — ready for dispatch</p>
              <p className="text-xs text-muted-foreground mt-1">
                Customer approved {job.estimated_price ? `$${Number(job.estimated_price).toFixed(2)}` : "price"} and credit card hold placed.
              </p>
            </div>
            <Button onClick={() => navigate("/matching")}>
              Proceed to Driver Matching
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default JobPricing;
