import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, CreditCard, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Inner form that uses Stripe hooks
function PaymentForm({ jobId, onSuccess }: { jobId: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("confirm-payment-authorization", {
        body: { jobId },
      });
      if (error) throw error;
      return data;
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMessage(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setErrorMessage(error.message ?? "Payment failed. Please try again.");
      setIsProcessing(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === "requires_capture") {
      // Authorization succeeded — confirm on backend
      try {
        const result = await confirmMutation.mutateAsync();
        if (result.status === "authorized") {
          onSuccess();
        } else {
          setErrorMessage("Authorization could not be confirmed. Please try again.");
        }
      } catch {
        setErrorMessage("Failed to confirm authorization. Please try again.");
      }
    } else {
      setErrorMessage("Unexpected payment status. Please contact support.");
    }

    setIsProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      {errorMessage && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>{errorMessage}</p>
        </div>
      )}
      <Button
        type="submit"
        disabled={!stripe || isProcessing}
        className="w-full"
        size="lg"
      >
        {isProcessing ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <CreditCard className="w-4 h-4 mr-2" />
        )}
        {isProcessing ? "Authorizing…" : "Authorize Payment"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Your card will be authorized but not charged yet. The final charge occurs after service is completed.
      </p>
    </form>
  );
}

export default function CustomerPayment() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [authorized, setAuthorized] = useState(false);

  // Fetch job details
  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: ["job-payment", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("job_id, estimated_price, pickup_location, vehicle_year, vehicle_make, vehicle_model, job_status, incident_type_id")
        .eq("job_id", jobId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch incident name
  const { data: incident } = useQuery({
    queryKey: ["incident-type", job?.incident_type_id],
    enabled: !!job?.incident_type_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incident_types")
        .select("incident_name")
        .eq("incident_type_id", job!.incident_type_id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Create payment intent
  const { data: paymentData, isLoading: paymentLoading, error: paymentError } = useQuery({
    queryKey: ["payment-intent", jobId],
    enabled: !!jobId && !!job && (job.job_status === "payment_authorization_required" || job.job_status === "payment_failed"),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("create-payment-intent", {
        body: { jobId },
      });
      if (error) throw error;
      return data as { clientSecret: string; publishableKey: string; amount: number };
    },
  });

  // Initialize Stripe when publishable key is available
  useEffect(() => {
    if (paymentData?.publishableKey) {
      setStripePromise(loadStripe(paymentData.publishableKey));
    }
  }, [paymentData?.publishableKey]);

  const handleSuccess = () => {
    setAuthorized(true);
    setTimeout(() => navigate(`/track/${jobId}`), 2000);
  };

  if (jobLoading || paymentLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <p className="text-lg font-semibold mb-2">Job not found</p>
        <button onClick={() => navigate("/")} className="text-primary text-sm hover:underline">
          Back to home
        </button>
      </div>
    );
  }

  // If job is already past payment gate, redirect to tracking
  if (!["payment_authorization_required", "payment_failed"].includes(job.job_status)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <CheckCircle2 className="w-12 h-12 text-success mb-4" />
        <p className="text-lg font-semibold mb-2">Payment already processed</p>
        <button onClick={() => navigate(`/track/${jobId}`)} className="text-primary text-sm hover:underline">
          Go to tracking
        </button>
      </div>
    );
  }

  if (authorized) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <CheckCircle2 className="w-16 h-16 text-success mb-4" />
        <h1 className="text-xl font-semibold mb-2">Payment Authorized</h1>
        <p className="text-sm text-muted-foreground">Redirecting to tracking…</p>
      </div>
    );
  }

  const vehicleSummary = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "Not specified";

  return (
    <div className="min-h-screen bg-background flex flex-col px-6 py-8">
      <div className="max-w-md mx-auto w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary/15 flex items-center justify-center">
            <CreditCard className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Authorize Payment</h1>
          <p className="text-sm text-muted-foreground">
            A card hold is required before your driver can begin service. You will not be charged until service is complete.
          </p>
        </div>

        {/* Job summary */}
        <div className="bg-muted rounded-2xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Service</span>
            <span className="font-medium">{incident?.incident_name ?? "Roadside assistance"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Vehicle</span>
            <span className="font-medium">{vehicleSummary}</span>
          </div>
          {job.pickup_location && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Location</span>
              <span className="font-medium truncate ml-4">{job.pickup_location}</span>
            </div>
          )}
          <div className="border-t pt-2 flex justify-between">
            <span className="text-sm text-muted-foreground">Authorization hold</span>
            <span className="text-lg font-bold">${job.estimated_price?.toFixed(2) ?? "—"}</span>
          </div>
        </div>

        {/* Payment error */}
        {paymentError && (
          <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p>Could not create payment session. Please try again later.</p>
          </div>
        )}

        {/* Retry notice for payment_failed */}
        {job.job_status === "payment_failed" && (
          <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p>Previous authorization failed. Please try a different card or try again.</p>
          </div>
        )}

        {/* Stripe Elements */}
        {stripePromise && paymentData?.clientSecret && (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: paymentData.clientSecret,
              appearance: { theme: "stripe" },
            }}
          >
            <PaymentForm jobId={jobId!} onSuccess={handleSuccess} />
          </Elements>
        )}
      </div>
    </div>
  );
}
