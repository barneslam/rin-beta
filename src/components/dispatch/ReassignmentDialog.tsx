import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useRequestReassignment } from "@/hooks/useExceptionActions";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
}

export function ReassignmentDialog({ open, onOpenChange, jobId }: Props) {
  const [reason, setReason] = useState("");
  const reassign = useRequestReassignment();

  const handleConfirm = () => {
    if (!reason.trim()) return;
    reassign.mutate(
      { jobId, reason },
      {
        onSuccess: () => {
          toast({ title: "Reassignment Requested", description: "Driver assignment cleared. Job ready for re-matching." });
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
          <DialogTitle>Request Reassignment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Reason for Reassignment</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does this job need a different driver?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={reassign.isPending || !reason.trim()}>
              {reassign.isPending ? "Processing…" : "Confirm Reassignment"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
