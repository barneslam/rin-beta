import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTruckTypes } from "@/hooks/useReferenceData";
import { useAmendJob, useCustomerReapproval } from "@/hooks/useExceptionActions";
import { toast } from "@/hooks/use-toast";
import type { Job } from "@/types/rin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
}

export function AmendJobDialog({ open, onOpenChange, job }: Props) {
  const { data: truckTypes } = useTruckTypes();
  const amendJob = useAmendJob();
  const reapproval = useCustomerReapproval();

  const [truckTypeId, setTruckTypeId] = useState(job.required_truck_type_id ?? "");
  const [price, setPrice] = useState(job.estimated_price?.toString() ?? "");
  const [reason, setReason] = useState("");
  const [amended, setAmended] = useState(false);

  const handleSubmit = () => {
    if (!reason.trim()) return;
    amendJob.mutate(
      {
        jobId: job.job_id,
        updates: {
          required_truck_type_id: truckTypeId || undefined,
          estimated_price: price ? Number(price) : undefined,
        },
        amendmentReason: reason,
      },
      {
        onSuccess: () => {
          toast({ title: "Job Amended", description: "Awaiting customer re-approval." });
          setAmended(true);
        },
      }
    );
  };

  const handleApproval = (approved: boolean) => {
    reapproval.mutate(
      { jobId: job.job_id, approved },
      {
        onSuccess: () => {
          toast({
            title: approved ? "Customer Approved" : "Customer Declined",
            description: approved ? "Job continues." : "Job cancelled.",
          });
          onOpenChange(false);
          setAmended(false);
          setReason("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setAmended(false); setReason(""); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Amend Job</DialogTitle>
        </DialogHeader>

        {!amended ? (
          <div className="space-y-4">
            <div>
              <Label>Revised Truck Type</Label>
              <Select value={truckTypeId} onValueChange={setTruckTypeId}>
                <SelectTrigger><SelectValue placeholder="Select truck type" /></SelectTrigger>
                <SelectContent>
                  {truckTypes?.map((t) => (
                    <SelectItem key={t.truck_type_id} value={t.truck_type_id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Revised Price ($)</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label>Amendment Reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this amendment needed?" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={amendJob.isPending || !reason.trim()}>
                {amendJob.isPending ? "Submitting…" : "Submit Amendment"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              Amendment submitted. Simulating customer response:
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => handleApproval(true)} disabled={reapproval.isPending} className="bg-success hover:bg-success/90 text-success-foreground">
                Customer Approved
              </Button>
              <Button variant="destructive" onClick={() => handleApproval(false)} disabled={reapproval.isPending}>
                Customer Declined
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
