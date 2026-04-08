import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import * as Linking from "expo-linking";

import { supabase } from "./src/lib/supabase";
import { useJob, useCustomerJobs } from "./src/hooks/useJob";
import { CUSTOMER_ACTION_REQUIRED } from "./src/types/job";
import JobConfirmScreen from "./src/screens/JobConfirmScreen";
import PriceApprovalScreen from "./src/screens/PriceApprovalScreen";
import TrackingScreen from "./src/screens/TrackingScreen";
import CompletionScreen from "./src/screens/CompletionScreen";
import ReceiptScreen from "./src/screens/ReceiptScreen";

/**
 * RIN Customer App
 *
 * Entry points:
 * 1. Deep link: rin-customer://job/:jobId  (from SMS link)
 * 2. Direct open: shows most recent active job for the customer
 *
 * SMS Fallback: If the app is not installed, all edge functions
 * still send SMS. The app is an upgrade, not a replacement.
 */
export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);

  // Parse deep link on launch
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const parsed = Linking.parse(event.url);
      if (parsed.path?.startsWith("job/")) {
        setJobId(parsed.path.replace("job/", ""));
      }
    };

    // Check initial URL
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    // Listen for incoming links while app is open
    const subscription = Linking.addEventListener("url", handleUrl);
    return () => subscription.remove();
  }, []);

  // TEST MODE: Auto-load latest active job
  useEffect(() => {
    if (!jobId) {
      // Hard-code the test job ID to bypass RLS
      // In production, auth tokens will grant access
      setJobId("b889221b-4862-4235-9820-029dc0839a11");
    }
  }, [jobId]);

  // In production this would use phone-based auth + useCustomerJobs
  const { job, driver, loading, error, refetch } = useJob(jobId);

  if (!jobId) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <Text style={styles.logo}>RIN</Text>
          <Text style={styles.tagline}>Roadside Intelligence Network</Text>
          <Text style={styles.waiting}>
            Waiting for a service request...{"\n\n"}
            When you receive an SMS from RIN, tap the link to open your job here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading your request...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !job) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load job details.{"\n"}Please check your SMS for updates.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Route to the correct screen based on job status
  const renderScreen = () => {
    switch (job.job_status) {
      case "pending_customer_confirmation":
        return <JobConfirmScreen job={job} onConfirmed={refetch} />;

      case "pending_customer_price_approval":
      case "customer_reapproval_pending":
        return <PriceApprovalScreen job={job} onApproved={refetch} />;

      case "payment_authorization_required":
      case "payment_authorized":
        // TODO: Integrate Stripe payment sheet here
        return <PriceApprovalScreen job={job} onApproved={refetch} />;

      case "ready_for_dispatch":
      case "driver_offer_sent":
      case "driver_assigned":
      case "driver_enroute":
      case "driver_arrived":
      case "service_in_progress":
        return <TrackingScreen job={job} driver={driver} />;

      case "pending_completion_approval":
        return <CompletionScreen job={job} onCompleted={refetch} />;

      case "job_completed":
        return <ReceiptScreen job={job} />;

      case "driver_cancelled_at_scene":
        return (
          <View style={[styles.container, styles.centered]}>
            <Text style={styles.errorTitle}>Driver Unavailable</Text>
            <Text style={styles.errorText}>
              Unfortunately the driver was unable to complete service.{"\n"}
              No charges have been applied.{"\n\n"}
              Our dispatcher is working to find another driver for you.
            </Text>
          </View>
        );

      case "cancelled_by_customer":
        return (
          <View style={[styles.container, styles.centered]}>
            <Text style={styles.errorTitle}>Request Cancelled</Text>
            <Text style={styles.errorText}>Your roadside request has been cancelled.</Text>
          </View>
        );

      default:
        return <TrackingScreen job={job} driver={driver} />;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      {renderScreen()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { fontSize: 48, fontWeight: "900", color: "#2563eb", letterSpacing: 4 },
  tagline: { fontSize: 14, color: "#666", marginTop: 8, marginBottom: 32 },
  waiting: { fontSize: 15, color: "#888", textAlign: "center", lineHeight: 22 },
  loadingText: { marginTop: 16, fontSize: 15, color: "#666" },
  errorTitle: { fontSize: 22, fontWeight: "700", color: "#dc2626", marginBottom: 12 },
  errorText: { fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22 },
});
