import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCancelJob } from "@/hooks/useExceptionActions";
import { toast } from "@/hooks/use-toast";
import type { Job } from "@/types/rin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
}

const PRE_DISPATCH_STATUSES = [
  "intake_started", "intake_completed", "validation_required",
  "ready_for_dispatch", "dispatch_recommendation_ready",
  "driver_offer_prepared", "driver_offer_sent",
];

export function CancelJobDialog({ open, onOpenChange, job }: Props) {
  const [reason, setReason] = useState("");
  const cancelJob = useCancelJob();

  const blocked = job.job_status === "vehicle_loaded" || job.job_status === "job_completed";
  const isPreDispatch = PRE_DISPATCH_STATUSES.includes(job.job_status);
  
  let fee = 0;
  let feeLabel = "";
  if (!isPreDispatch) {
    const price = Number(job.estimated_price ?? 0);
    if (["driver_assigned", "payment_authorization_required", "payment_authorized", "payment_failed"].includes(job.job_status)) {
      fee = Math.round(price * 0.01 * 100) / 100;
      feeLabel = "1% — post-acceptance cancel";
    } else if (job.job_status === "driver_enroute") {
      fee = Math.round(price * 0.05 * 100) / 100;
      feeLabel = "5% — driver en route cancel";
    } else if (job.job_status === "driver_arrived" || job.job_status === "service_in_progress") {
      fee = Math.round(price * 0.10 * 100) / 100;
      feeLabel = "10% — late cancel";
    }
  }

  const handleConfirm = () => {
    if (!reason.trim()) return;
    cancelJob.mutate(
      { jobId: job.job_id, reason },
      {
        onSuccess: () => {
          toast({ title: "Job Cancelled", description: fee > 0 ? `Cancellation fee: $${fee}` : "No fee applied." });
          onOpenChange(false);
          setReason("");
        },
        onError: (err) => {
          toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setReason(""); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel Job</DialogTitle>
        </DialogHeader>

        {blocked ? (
          <div className="py-4 text-center">
            <p className="text-sm text-destructive font-medium">
              Cancellation is not allowed after vehicle load or completion.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {fee > 0 && (
              <div className="rounded border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">
                  Cancellation Fee: ${fee.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {feeLabel} (of ${Number(job.estimated_price ?? 0).toFixed(2)})
                </p>
              </div>
            )}
            <div>
              <Label>Cancellation Reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this job being cancelled?" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Keep Job</Button>
              <Button variant="destructive" onClick={handleConfirm} disabled={cancelJob.isPending || !reason.trim()}>
                {cancelJob.isPending ? "Cancelling…" : "Confirm Cancellation"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
