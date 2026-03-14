import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMarkDriverUnavailable } from "@/hooks/useExceptionActions";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
}

export function DriverUnavailableDialog({ open, onOpenChange, jobId }: Props) {
  const [reason, setReason] = useState("");
  const markUnavailable = useMarkDriverUnavailable();

  const handleConfirm = () => {
    if (!reason.trim()) return;
    markUnavailable.mutate(
      { jobId, reason },
      {
        onSuccess: () => {
          toast({ title: "Driver Marked Unavailable", description: "Assignment cleared. Job under review." });
          onOpenChange(false);
          setReason("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setReason(""); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark Driver Unavailable</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the driver unavailable?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={markUnavailable.isPending || !reason.trim()}>
              {markUnavailable.isPending ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
