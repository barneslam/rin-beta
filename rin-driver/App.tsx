import React, { useState, useCallback } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, ActivityIndicator, View, Text, Platform } from "react-native";

import { supabase } from "./src/lib/supabase";
import { usePendingOffer, useActiveJob, useDriverProfile } from "./src/hooks/useDriverJob";
import OfferScreen from "./src/screens/OfferScreen";
import ActiveJobScreen from "./src/screens/ActiveJobScreen";
import IdleScreen from "./src/screens/IdleScreen";

// Hard-coded for testing — in production, use phone-based auth
const TEST_DRIVER_ID = "0ecf6a1e-6109-494c-aff8-66451ea63f41";

/**
 * RIN Driver App
 *
 * State machine:
 * 1. Idle (available/offline) → waiting for offers
 * 2. Offer received → accept or decline
 * 3. Active job → ARRIVED → service → DONE → waiting for customer confirm
 * 4. Job complete → back to idle
 *
 * SMS Fallback: If the app is not installed, all edge functions
 * still send SMS to the driver. The app is an upgrade path.
 */
export default function App() {
  const [driverId] = useState(TEST_DRIVER_ID);

  const profile = useDriverProfile(driverId);
  const { offer, job: offerJob, loading: offerLoading, refetch: refetchOffer } = usePendingOffer(driverId);
  const { job: activeJob, loading: jobLoading, refetch: refetchJob } = useActiveJob(driverId);

  const handleOfferResponded = useCallback(() => {
    refetchOffer();
    refetchJob();
  }, [refetchOffer, refetchJob]);

  const handleJobUpdate = useCallback(() => {
    refetchJob();
  }, [refetchJob]);

  const handleToggleAvailability = useCallback(async () => {
    if (!profile) return;
    const newStatus = profile.availability_status === "available" ? "offline" : "available";
    await supabase
      .from("drivers")
      .update({ availability_status: newStatus })
      .eq("driver_id", driverId);
    // Profile will update via next render
    refetchJob();
  }, [profile, driverId, refetchJob]);

  if (offerLoading || jobLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#f59e0b" />
        </View>
      </SafeAreaView>
    );
  }

  // Priority: active job > pending offer > idle
  const renderScreen = () => {
    // Active job takes priority
    if (activeJob) {
      if (activeJob.job_status === "job_completed") {
        return (
          <View style={[styles.container, styles.centered]}>
            <Text style={styles.completedIcon}>Done</Text>
            <Text style={styles.completedTitle}>Job Complete</Text>
            <Text style={styles.completedText}>
              Payment of ${Number(activeJob.estimated_price || 0).toFixed(2)} has been processed.
            </Text>
          </View>
        );
      }
      return (
        <ActiveJobScreen
          job={activeJob}
          driverId={driverId}
          onUpdate={handleJobUpdate}
        />
      );
    }

    // Pending offer
    if (offer && offerJob) {
      return (
        <OfferScreen
          offer={offer}
          job={offerJob}
          onResponded={handleOfferResponded}
        />
      );
    }

    // Idle — waiting for jobs
    return (
      <IdleScreen
        profile={profile}
        onToggleAvailability={handleToggleAvailability}
      />
    );
  };

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        {renderScreen()}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: "#f8f9fa", minHeight: Platform.OS === "web" ? "100vh" as any : undefined },
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  completedIcon: { fontSize: 24, fontWeight: "800", color: "#16a34a", marginBottom: 16, backgroundColor: "#dcfce7", width: 80, height: 80, borderRadius: 40, textAlign: "center", textAlignVertical: "center", lineHeight: 80, overflow: "hidden" },
  completedTitle: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 8 },
  completedText: { fontSize: 15, color: "#666", textAlign: "center" },
});
