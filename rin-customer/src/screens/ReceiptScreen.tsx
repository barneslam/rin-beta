import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Job } from "../types/job";

interface Props {
  job: Job;
}

export default function ReceiptScreen({ job }: Props) {
  const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
    .filter(Boolean)
    .join(" ") || "—";

  return (
    <View style={styles.container}>
      <View style={styles.checkContainer}>
        <Text style={styles.check}>Done</Text>
      </View>

      <Text style={styles.title}>Service Complete</Text>
      <Text style={styles.subtitle}>Thank you for using RIN!</Text>

      <View style={styles.receiptCard}>
        <DetailRow label="Vehicle" value={vehicle} />
        <DetailRow label="Location" value={job.pickup_location || "—"} />
        <DetailRow label="Amount Charged" value={`$${Number(job.estimated_price || 0).toFixed(2)}`} highlight />
        <DetailRow label="Completed" value={job.completed_at ? new Date(job.completed_at).toLocaleString() : "—"} />
      </View>

      <Text style={styles.footer}>A receipt has also been sent to your phone via SMS.</Text>
    </View>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa", alignItems: "center", justifyContent: "center" },
  checkContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#dcfce7", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  check: { fontSize: 18, fontWeight: "700", color: "#16a34a" },
  title: { fontSize: 26, fontWeight: "700", color: "#1a1a2e", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#666", marginBottom: 24 },
  receiptCard: { backgroundColor: "#fff", borderRadius: 12, padding: 20, width: "100%", marginBottom: 20, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  rowLabel: { fontSize: 14, color: "#888" },
  rowValue: { fontSize: 14, color: "#1a1a2e", fontWeight: "500" },
  rowHighlight: { fontSize: 18, fontWeight: "800", color: "#16a34a" },
  footer: { fontSize: 13, color: "#999", textAlign: "center", marginTop: 8 },
});
