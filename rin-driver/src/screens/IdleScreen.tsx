import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
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

      <View style={[styles.statusCircle, isAvailable ? styles.statusOnline : styles.statusOffline]}>
        <Text style={styles.statusIcon}>{isAvailable ? "ON" : "OFF"}</Text>
      </View>
      <Text style={styles.statusLabel}>
        {isAvailable ? "Available for dispatch" : "Offline"}
      </Text>

      <TouchableOpacity
        style={[styles.toggleButton, isAvailable ? styles.toggleOff : styles.toggleOn]}
        onPress={onToggleAvailability}
      >
        <Text style={styles.toggleText}>
          {isAvailable ? "Go Offline" : "Go Online"}
        </Text>
      </TouchableOpacity>

      {isAvailable && (
        <Text style={styles.waitingText}>
          Waiting for dispatch offers...{"\n"}You'll be notified when a job comes in.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa", alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 48, fontWeight: "900", color: "#f59e0b", letterSpacing: 4 },
  subtitle: { fontSize: 16, color: "#888", marginBottom: 32, fontWeight: "500" },
  profileCard: { backgroundColor: "#fff", borderRadius: 12, padding: 20, alignItems: "center", marginBottom: 32, width: "100%", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  driverName: { fontSize: 20, fontWeight: "700", color: "#1a1a2e" },
  company: { fontSize: 14, color: "#666", marginTop: 4 },
  statusCircle: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  statusOnline: { backgroundColor: "#dcfce7" },
  statusOffline: { backgroundColor: "#fee2e2" },
  statusIcon: { fontSize: 24, fontWeight: "800" },
  statusLabel: { fontSize: 16, color: "#666", marginBottom: 32 },
  toggleButton: { borderRadius: 12, padding: 16, alignItems: "center", width: "100%", marginBottom: 24 },
  toggleOn: { backgroundColor: "#16a34a" },
  toggleOff: { backgroundColor: "#dc2626" },
  toggleText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  waitingText: { fontSize: 14, color: "#999", textAlign: "center", lineHeight: 20 },
});
