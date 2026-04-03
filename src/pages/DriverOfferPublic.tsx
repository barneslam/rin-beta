import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, AlertTriangle, Car, DollarSign, Clock, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { supabaseExternal } from "@/lib/supabaseExternal";

interface OfferDetails {
  offer: {
    offer_id: string;
    offer_status: string;
    expires_at: string | null;
    created_at: string;
  };
  job: {
    pickup_location: string | null;
    incident_name: string;
    vehicle_summary: string;
    estimated_price: number | null;
    job_status: string;
  };
}

const DriverOfferPublic = () => {
  const { offerId } = useParams<{ offerId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [details, setDetails] = useState<OfferDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<"accepted" | "declined" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch offer details
  useEffect(() => {
    if (!offerId || !token) {
      setError("Missing offer ID or token.");
      setLoading(false);
      return;
    }

    supabaseExternal.functions.invoke("driver-respond", {
      body: { offerId, token, action: "view" },
    })
      .then(({ data, error: fnError }) => {
        if (fnError) {
          setError("Failed to load offer details.");
        } else if (data?.error) {
          setError(data.error);
        } else {
          setDetails(data);
        }
      })
      .catch(() => setError("Failed to load offer details."))
      .finally(() => setLoading(false));
  }, [offerId, token]);

  // Countdown timer
  useEffect(() => {
    if (!details?.offer.expires_at || details.offer.offer_status !== "pending") return;

    const tick = () => {
      const diff = new Date(details.offer.expires_at!).getTime() - Date.now();
      const remaining = Math.max(0, Math.ceil(diff / 1000));
      setSecondsRemaining(remaining);
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [details?.offer.expires_at, details?.offer.offer_status]);

  const handleAction = async (action: "accept" | "decline") => {
    if (!offerId || !token) return;
    setSubmitting(true);

    try {
      const { data, error: fnError } = await supabaseExternal.functions.invoke("driver-respond", {
        body: { offerId, token, action },
      });
      if (fnError) throw fnError;

      if (data.success) {
        setActionResult(action === "accept" ? "accepted" : "declined");
      } else {
        setError(data.error || "Action failed.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (actionResult) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-4">
            {actionResult === "accepted" ? (
              <>
                <CheckCircle className="h-12 w-12 text-success mx-auto" />
                <h2 className="text-lg font-semibold">Job Accepted!</h2>
                <p className="text-sm text-muted-foreground">
                  You've been assigned to this job. Head to the pickup location.
                </p>
              </>
            ) : (
              <>
                <XCircle className="h-12 w-12 text-muted-foreground mx-auto" />
                <h2 className="text-lg font-semibold">Offer Declined</h2>
                <p className="text-sm text-muted-foreground">
                  No worries — the job will be offered to the next available driver.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!details) return null;

  const { offer, job } = details;
  const isPending = offer.offer_status === "pending";
  const isExpired = offer.offer_status === "expired" || (secondsRemaining !== null && secondsRemaining <= 0);
  const payout = job.estimated_price ? `$${Number(job.estimated_price).toFixed(2)}` : "TBD";

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background p-4 flex items-start justify-center pt-8">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold tracking-tight">RIN Dispatch</h1>
          <p className="text-sm text-muted-foreground">Job Offer</p>
        </div>

        {/* Timer */}
        {isPending && !isExpired && secondsRemaining !== null && (
          <Card className={`border-2 ${secondsRemaining <= 15 ? "border-destructive/50" : "border-accent/50"}`}>
            <CardContent className="py-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Time remaining</p>
              <p className={`font-mono text-2xl font-bold ${secondsRemaining <= 15 ? "text-destructive" : "text-accent"}`}>
                {formatTime(secondsRemaining)}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Expired banner */}
        {isExpired && isPending && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="py-4 text-center">
              <Clock className="h-6 w-6 text-destructive mx-auto mb-2" />
              <p className="text-sm font-medium">This offer has expired</p>
            </CardContent>
          </Card>
        )}

        {/* Already responded */}
        {!isPending && !isExpired && (
          <Card className="border-muted">
            <CardContent className="py-4 text-center">
              <Badge variant="secondary" className="text-xs">
                {offer.offer_status.charAt(0).toUpperCase() + offer.offer_status.slice(1)}
              </Badge>
              <p className="text-sm text-muted-foreground mt-2">This offer has already been {offer.offer_status}.</p>
            </CardContent>
          </Card>
        )}

        {/* Job Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Job Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Pickup</p>
                <p className="text-sm font-medium">{job.pickup_location || "See dispatch details"}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-accent mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Issue</p>
                <p className="text-sm font-medium">{job.incident_name}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Car className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Vehicle</p>
                <p className="text-sm font-medium">{job.vehicle_summary}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <DollarSign className="h-4 w-4 text-success mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Estimated Payout</p>
                <p className="text-sm font-bold">{payout}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        {isPending && !isExpired && (
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="w-full"
              onClick={() => handleAction("accept")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Accept
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => handleAction("decline")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Decline
            </Button>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground text-center">
          Powered by RIN Dispatch
        </p>
      </div>
    </div>
  );
};

export default DriverOfferPublic;
