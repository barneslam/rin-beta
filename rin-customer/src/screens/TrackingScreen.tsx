import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import type { Job, Driver, JobStatus } from "../types/job";
import { STATUS_LABELS } from "../types/job";

interface Props {
  job: Job;
  driver: Driver | null;
}

const PROGRESS_STEPS: { status: JobStatus[]; label: string }[] = [
  { status: ["ready_for_dispatch", "driver_offer_sent"], label: "Finding driver" },
  { status: ["driver_assigned", "driver_enroute"], label: "Driver en route" },
  { status: ["driver_arrived"], label: "Driver arrived" },
  { status: ["service_in_progress"], label: "Service in progress" },
];

/**
 * Real-time tracking screen. Shows driver info, progress steps,
 * and updates live via Supabase real-time subscription.
 */
export default function TrackingScreen({ job, driver }: Props) {
  const currentStepIndex = PROGRESS_STEPS.findIndex((s) =>
    s.status.includes(job.job_status)
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{STATUS_LABELS[job.job_status]}</Text>

      {/* Driver card */}
      {driver ? (
        <View style={styles.driverCard}>
          <View style={styles.driverAvatar}>
            <Text style={styles.driverInitial}>{driver.driver_name[0]}</Text>
          </View>
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>{driver.driver_name}</Text>
            <Text style={styles.driverCompany}>{driver.company_name}</Text>
            <Text style={styles.driverRating}>
              {"*".repeat(Math.round(driver.rating || 5))} {driver.rating?.toFixed(1) || "5.0"}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.searchingCard}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.searchingText}>Searching for available drivers...</Text>
        </View>
      )}

      {/* Progress steps */}
      <View style={styles.progressContainer}>
        {PROGRESS_STEPS.map((step, index) => {
          const isComplete = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          return (
            <View key={step.label} style={styles.progressStep}>
              <View
                style={[
                  styles.dot,
                  isComplete && styles.dotComplete,
                  isCurrent && styles.dotCurrent,
                ]}
              />
              {index < PROGRESS_STEPS.length - 1 && (
                <View style={[styles.line, isComplete && styles.lineComplete]} />
              )}
              <Text
                style={[
                  styles.stepLabel,
                  (isComplete || isCurrent) && styles.stepLabelActive,
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Job details */}
      <View style={styles.detailsCard}>
        <Text style={styles.detailTitle}>Service Details</Text>
        <DetailRow label="Location" value={job.pickup_location || "—"} />
        <DetailRow
          label="Vehicle"
          value={[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
        />
        {job.estimated_price && (
          <DetailRow label="Quoted Price" value={`$${Number(job.estimated_price).toFixed(2)}`} />
        )}
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 20 },
  driverCard: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  driverAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center", marginRight: 16 },
  driverInitial: { color: "#fff", fontSize: 24, fontWeight: "700" },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 18, fontWeight: "700", color: "#1a1a2e" },
  driverCompany: { fontSize: 14, color: "#666", marginTop: 2 },
  driverRating: { fontSize: 13, color: "#f59e0b", marginTop: 4 },
  searchingCard: { backgroundColor: "#fff", borderRadius: 12, padding: 32, alignItems: "center", marginBottom: 24, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  searchingText: { marginTop: 16, fontSize: 15, color: "#666" },
  progressContainer: { marginBottom: 24, paddingLeft: 8 },
  progressStep: { flexDirection: "row", alignItems: "center", marginBottom: 24, position: "relative" },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#d1d5db", marginRight: 12 },
  dotComplete: { backgroundColor: "#16a34a" },
  dotCurrent: { backgroundColor: "#2563eb", width: 20, height: 20, borderRadius: 10 },
  line: { position: "absolute", left: 7, top: 20, width: 2, height: 24, backgroundColor: "#d1d5db" },
  lineComplete: { backgroundColor: "#16a34a" },
  stepLabel: { fontSize: 15, color: "#9ca3af" },
  stepLabelActive: { color: "#1a1a2e", fontWeight: "600" },
  detailsCard: { backgroundColor: "#fff", borderRadius: 12, padding: 20, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  detailTitle: { fontSize: 16, fontWeight: "700", color: "#1a1a2e", marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  rowLabel: { fontSize: 14, color: "#888" },
  rowValue: { fontSize: 14, color: "#1a1a2e", fontWeight: "500", maxWidth: "60%", textAlign: "right" },
});
