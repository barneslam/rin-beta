import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveJob } from "@/context/JobContext";
import { useJob } from "@/hooks/useJobs";
import { useDispatchOffers, useDrivers, useTrucks, useIncidentTypes, useTruckTypes } from "@/hooks/useReferenceData";
import {
  useAcceptDispatchOffer,
  useDeclineDispatchOffer,
  useExpireDispatchOffer,
  useAutoDispatchOffer,
} from "@/hooks/useDispatchEngine";
import { toast } from "@/hooks/use-toast";
import { useNavigate, Link } from "react-router-dom";
import { Clock, CheckCircle, XCircle, AlertTriangle, Timer } from "lucide-react";

const WAVE_SIZE = 5;

const DriverOffer = () => {
  const { activeJobId } = useActiveJob();
  const { data: job } = useJob(activeJobId);
  const { data: offers } = useDispatchOffers(activeJobId ?? undefined);
  const { data: drivers } = useDrivers();
  const { data: trucks } = useTrucks();
  const { data: incidentTypes } = useIncidentTypes();
  const { data: truckTypesData } = useTruckTypes();
  const acceptOffer = useAcceptDispatchOffer();
  const declineOffer = useDeclineDispatchOffer();
  const expireOffer = useExpireDispatchOffer();
  const autoDispatch = useAutoDispatchOffer();
  const navigate = useNavigate();

  const getDriver = useCallback((id: string) => drivers?.find((d) => d.driver_id === id), [drivers]);
  const driverAssigned = !!job?.assigned_driver_id;

  const sortedOffers = useMemo(() =>
    [...(offers ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [offers]
  );

  const pendingOffer = sortedOffers.find((o) => o.offer_status === "pending");
  const historyOffers = sortedOffers.filter((o) => o.offer_status !== "pending");

  const totalAttempts = sortedOffers.length;
  const currentWave = totalAttempts <= WAVE_SIZE ? 1 : 2;
  const waveAttempt = currentWave === 1 ? totalAttempts : totalAttempts - WAVE_SIZE;

  const isEscalated = job?.job_status === "reassignment_required" && !pendingOffer && totalAttempts > 0;

  const createAutoAdvanceFn = useCallback(() => {
    if (!drivers || !trucks || !incidentTypes || !truckTypesData || !job) return undefined;
    return async () => {
      const result = await autoDispatch.mutateAsync({
        jobId: job.job_id,
        drivers,
        trucks,
        incidentTypes,
        truckTypes: truckTypesData,
      });
      return result;
    };
  }, [drivers, trucks, incidentTypes, truckTypesData, autoDispatch, job]);

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No active job. Start from Incident Intake.</p>
      </div>
    );
  }

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
    const driver = getDriver(offer.driver_id);
    declineOffer.mutate(
      {
        offerId: offer.offer_id,
        jobId: offer.job_id,
        driverId: offer.driver_id,
        driverName: driver?.driver_name,
        autoAdvanceFn: createAutoAdvanceFn(),
      },
      {
        onSuccess: (result) => {
          if (result?.escalated) {
            toast({
              title: "All Offers Exhausted",
              description: "Job moved to Exception Queue for manual review.",
              variant: "destructive",
            });
          } else {
            toast({ title: "Offer Declined", description: "Sending to next driver…" });
          }
        },
      }
    );
  };

  const handleExpire = (offer: { offer_id: string; driver_id: string; job_id: string }) => {
    const driver = getDriver(offer.driver_id);
    expireOffer.mutate(
      {
        offerId: offer.offer_id,
        jobId: offer.job_id,
        driverId: offer.driver_id,
        driverName: driver?.driver_name,
        autoAdvanceFn: createAutoAdvanceFn(),
      },
      {
        onSuccess: (result) => {
          if (result?.escalated) {
            toast({
              title: "All Offers Exhausted",
              description: "Job moved to Exception Queue for manual review.",
              variant: "destructive",
            });
          } else {
            toast({ title: "Offer Expired", description: "Sending to next driver…" });
          }
        },
      }
    );
  };

  const offerStatusConfig: Record<string, { color: string; icon: typeof CheckCircle }> = {
    pending: { color: "bg-accent/20 text-accent-foreground", icon: Clock },
    accepted: { color: "bg-success/15 text-success", icon: CheckCircle },
    declined: { color: "bg-destructive/10 text-destructive", icon: XCircle },
    expired: { color: "bg-muted text-muted-foreground", icon: Timer },
  };

  const getTimeRemaining = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Step 6 — Driver Offer</h1>
        <p className="text-sm text-muted-foreground">
          Automatic dispatch routing — monitoring offer cycle.
        </p>
      </div>

      {/* Wave Indicator */}
      <Card className="border-primary/20">
        <CardContent className="py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="font-mono text-xs">
              Wave {currentWave} — Attempt {waveAttempt} of {WAVE_SIZE}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Total attempts: {totalAttempts} / {WAVE_SIZE * 2}
            </span>
          </div>
          {driverAssigned && (
            <Badge className="bg-success/15 text-success">Driver Assigned</Badge>
          )}
        </CardContent>
      </Card>

      {/* Escalation Banner */}
      {isEscalated && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-sm">All automatic attempts exhausted</p>
              <p className="text-xs text-muted-foreground">
                Job moved to Exception Queue.{" "}
                <Link to="/control-panel" className="text-primary underline">
                  Go to Control Panel
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Pending Offer */}
      {pendingOffer && (
        <Card className="border-accent/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent" />
              Active Offer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{getDriver(pendingOffer.driver_id)?.driver_name || "Unknown"}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{pendingOffer.offer_id.slice(0, 8)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Time Remaining</p>
                <p className="font-mono text-sm font-medium text-accent">
                  {getTimeRemaining(pendingOffer.expires_at)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Rating</p>
                <p className="font-mono font-medium">
                  {getDriver(pendingOffer.driver_id)?.rating != null
                    ? `${getDriver(pendingOffer.driver_id)!.rating} ★`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Reliability</p>
                <p className="font-mono font-medium">
                  {getDriver(pendingOffer.driver_id)?.reliability_score != null
                    ? `${getDriver(pendingOffer.driver_id)!.reliability_score}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Company</p>
                <p className="font-mono font-medium">
                  {getDriver(pendingOffer.driver_id)?.company_name || "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Sent</p>
                <p className="font-mono font-medium text-[10px]">
                  {new Date(pendingOffer.created_at).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => handleAccept(pendingOffer)}
                disabled={driverAssigned || acceptOffer.isPending}
              >
                Accept Offer
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDecline(pendingOffer)}
                disabled={declineOffer.isPending || autoDispatch.isPending}
              >
                Decline
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleExpire(pendingOffer)}
                disabled={expireOffer.isPending || autoDispatch.isPending}
              >
                Mark Expired
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No offers yet */}
      {(!offers || offers.length === 0) && !isEscalated && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No offers sent yet. Start Automatic Dispatch from{" "}
              <Link to="/matching" className="text-primary underline">Driver Matching</Link>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Offer History */}
      {historyOffers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Offer History ({historyOffers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {historyOffers.map((offer, idx) => {
                const driver = getDriver(offer.driver_id);
                const config = offerStatusConfig[offer.offer_status] || offerStatusConfig.pending;
                const StatusIcon = config.icon;
                const attemptNum = totalAttempts - idx;

                return (
                  <div key={offer.offer_id} className="flex items-center justify-between rounded border p-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-5">#{attemptNum}</span>
                      <StatusIcon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">{driver?.driver_name || "Unknown"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(offer.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <Badge className={config.color}>
                      {offer.offer_status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DriverOffer;
