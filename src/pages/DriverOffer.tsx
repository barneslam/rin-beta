import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { useDispatchOffers, useDrivers } from "@/hooks/useReferenceData";
import { useAcceptDispatchOffer, useDeclineDispatchOffer } from "@/hooks/useDispatchEngine";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

const DriverOffer = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: offers } = useDispatchOffers(activeJobId ?? undefined);
  const { data: drivers } = useDrivers();
  const acceptOffer = useAcceptDispatchOffer();
  const declineOffer = useDeclineDispatchOffer();
  const navigate = useNavigate();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const getDriver = (id: string) => drivers?.find((d) => d.driver_id === id);
  const driverAssigned = !!job.assigned_driver_id;

  const offerStatusColors: Record<string, string> = {
    pending: "bg-accent/20 text-accent-foreground",
    accepted: "bg-success/15 text-success",
    declined: "bg-destructive/10 text-destructive",
    expired: "bg-muted text-muted-foreground",
  };

  const handleAccept = (offer: { offer_id: string; driver_id: string; truck_id: string | null; job_id: string }) => {
    acceptOffer.mutate(
      { offerId: offer.offer_id, jobId: offer.job_id, driverId: offer.driver_id, truckId: offer.truck_id },
      {
        onSuccess: () => {
          toast({ title: "Offer Accepted", description: "Driver assigned. Proceed to Job Tracking." });
        },
      }
    );
  };

  const handleDecline = (offer: { offer_id: string; driver_id: string; job_id: string }) => {
    declineOffer.mutate(
      { offerId: offer.offer_id, jobId: offer.job_id, driverId: offer.driver_id },
      {
        onSuccess: (result) => {
          if (result?.allExhausted) {
            toast({
              title: "All Offers Exhausted",
              description: "Job returned to matching. Select another driver.",
              variant: "destructive",
            });
            navigate("/matching");
          } else {
            toast({ title: "Offer Declined" });
          }
        },
      }
    );
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 6 — Driver Offer</h1>
        <p className="text-sm text-muted-foreground">Manage dispatch offers sent to drivers.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dispatch Offers ({offers?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!offers || offers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No offers sent yet. Prepare offers from Driver Matching.
            </p>
          ) : (
            <div className="space-y-3">
              {offers.map((offer) => {
                const driver = getDriver(offer.driver_id);
                const isPending = offer.offer_status === "pending";

                return (
                  <div key={offer.offer_id} className="rounded border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{driver?.driver_name || "Unknown"}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{offer.offer_id.slice(0, 8)}</p>
                      </div>
                      <Badge className={offerStatusColors[offer.offer_status] || ""}>
                        {offer.offer_status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Rating</p>
                        <p className="font-mono font-medium">{driver?.rating != null ? `${driver.rating} ★` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Reliability</p>
                        <p className="font-mono font-medium">{driver?.reliability_score != null ? `${driver.reliability_score}%` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">ETA</p>
                        <p className="font-mono font-medium">{job.eta_minutes ? `${job.eta_minutes} min` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Sent</p>
                        <p className="font-mono font-medium text-[10px]">{new Date(offer.created_at).toLocaleString()}</p>
                      </div>
                    </div>

                    {isPending && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => handleAccept(offer)}
                          disabled={driverAssigned || acceptOffer.isPending}
                        >
                          Accept Offer
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDecline(offer)}
                          disabled={declineOffer.isPending}
                        >
                          Decline Offer
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DriverOffer;
