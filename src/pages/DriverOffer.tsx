import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { useDispatchOffers, useDrivers } from "@/hooks/useReferenceData";

const DriverOffer = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: offers } = useDispatchOffers(activeJobId ?? undefined);
  const { data: drivers } = useDrivers();

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

  const getDriverName = (id: string) => drivers?.find((d) => d.driver_id === id)?.driver_name || "Unknown";

  const offerStatusColors: Record<string, string> = {
    pending: "bg-accent/20 text-accent-foreground",
    accepted: "bg-success/15 text-success",
    declined: "bg-destructive/10 text-destructive",
    expired: "bg-muted text-muted-foreground",
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 6 — Driver Offer</h1>
        <p className="text-sm text-muted-foreground">Track dispatch offers sent to drivers.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dispatch Offers ({offers?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!offers || offers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No offers sent yet. Offers will appear here once dispatch logic runs.
            </p>
          ) : (
            <div className="space-y-3">
              {offers.map((offer) => (
                <div key={offer.offer_id} className="flex items-center justify-between rounded border p-3">
                  <div>
                    <p className="font-medium text-sm">{getDriverName(offer.driver_id)}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{offer.offer_id.slice(0, 8)}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {offer.response_time && (
                      <div className="text-right">
                        <p className="text-muted-foreground">Response</p>
                        <p className="font-mono">{offer.response_time}s</p>
                      </div>
                    )}
                    {offer.expires_at && (
                      <div className="text-right">
                        <p className="text-muted-foreground">Expires</p>
                        <p className="font-mono text-[10px]">{new Date(offer.expires_at).toLocaleTimeString()}</p>
                      </div>
                    )}
                    <Badge className={offerStatusColors[offer.offer_status] || ""}>
                      {offer.offer_status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed border-2">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground text-sm">🔌 Offer Distribution Engine will plug in here.</p>
          <p className="text-xs text-muted-foreground mt-1">
            This module will send, track, and manage driver offers with expiry and fallback logic.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DriverOffer;
