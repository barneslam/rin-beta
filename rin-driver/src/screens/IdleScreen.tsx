import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import type { DriverProfile } from "../types/driver";

interface Props {
  profile: DriverProfile | null;
  onToggleAvailability: () => void;
}

export default function IdleScreen({ profile, onToggleAvailability }: Props) {
  const isAvailable = profile?.availability_status === "available";

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>RIN</Text>
      <Text style={styles.subtitle}>Driver</Text>

      {profile && (
        <View style={styles.profileCard}>
          <Text style={styles.driverName}>{profile.driver_name}</Text>
          <Text style={styles.company}>{profile.company_name}</Text>
        </View>
      )}

      {isAvailable ? (
        <>
          {/* Online state — prominent green indicator */}
          <View style={styles.onlineBanner}>
            <View style={styles.pulseDot} />
            <Text style={styles.onlineBannerText}>ONLINE</Text>
          </View>

          <View style={styles.waitingCard}>
            <ActivityIndicator size="small" color="#16a34a" style={{ marginBottom: 12 }} />
            <Text style={styles.waitingTitle}>Waiting for dispatch offers...</Text>
            <Text style={styles.waitingText}>You'll be notified when a job comes in.</Text>
          </View>

          <TouchableOpacity style={styles.goOfflineButton} onPress={onToggleAvailability}>
            <Text style={styles.goOfflineText}>Go Offline</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Offline state */}
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>OFFLINE</Text>
          </View>

          <Text style={styles.offlineMessage}>
            You are currently offline.{"\n"}Go online to receive dispatch offers.
          </Text>

          <TouchableOpacity style={styles.goOnlineButton} onPress={onToggleAvailability}>
            <Text style={styles.goOnlineText}>Go Online</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa", alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 48, fontWeight: "900", color: "#f59e0b", letterSpacing: 4 },
  subtitle: { fontSize: 16, color: "#888", marginBottom: 32, fontWeight: "500" },
  profileCard: { backgroundColor: "#fff", borderRadius: 12, padding: 20, alignItems: "center", marginBottom: 24, width: "100%", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  driverName: { fontSize: 20, fontWeight: "700", color: "#1a1a2e" },
  company: { fontSize: 14, color: "#666", marginTop: 4 },

  // Online state
  onlineBanner: { flexDirection: "row", alignItems: "center", backgroundColor: "#16a34a", borderRadius: 24, paddingVertical: 10, paddingHorizontal: 24, marginBottom: 24 },
  pulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff", marginRight: 10 },
  onlineBannerText: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: 2 },
  waitingCard: { backgroundColor: "#f0fdf4", borderWidth: 2, borderColor: "#bbf7d0", borderRadius: 12, padding: 24, alignItems: "center", width: "100%", marginBottom: 24 },
  waitingTitle: { fontSize: 16, fontWeight: "600", color: "#15803d", marginBottom: 4 },
  waitingText: { fontSize: 14, color: "#16a34a" },
  goOfflineButton: { borderWidth: 2, borderColor: "#d1d5db", borderRadius: 12, padding: 14, alignItems: "center", width: "100%" },
  goOfflineText: { color: "#888", fontSize: 15, fontWeight: "600" },

  // Offline state
  offlineBanner: { backgroundColor: "#6b7280", borderRadius: 24, paddingVertical: 10, paddingHorizontal: 24, marginBottom: 24 },
  offlineBannerText: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: 2 },
  offlineMessage: { fontSize: 15, color: "#888", textAlign: "center", lineHeight: 22, marginBottom: 24 },
  goOnlineButton: { backgroundColor: "#16a34a", borderRadius: 12, padding: 16, alignItems: "center", width: "100%" },
  goOnlineText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
