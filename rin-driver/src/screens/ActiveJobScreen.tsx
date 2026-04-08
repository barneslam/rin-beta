import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, TextInput } from "react-native";
import { supabase, SUPABASE_URL } from "../lib/supabase";
import { INCIDENT_NAMES } from "../types/driver";
import type { JobForDriver } from "../types/driver";

interface Props {
  job: JobForDriver;
  driverId: string;
  onUpdate: () => void;
}

/**
 * Active job screen for drivers. Shows job details and action buttons
 * that change based on current status:
 * - driver_enroute → "I've Arrived" button
 * - driver_arrived → "Start Service" + "Adjust Price" + "Can't Complete"
 * - service_in_progress → "Mark Complete" + "Adjust Price" + "Can't Complete"
 * - pending_completion_approval → waiting screen
 */
export default function ActiveJobScreen({ job, driverId, onUpdate }: Props) {
  const [loading, setLoading] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [newAmount, setNewAmount] = useState("");

  const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
    .filter(Boolean).join(" ") || "Not specified";
  const incidentName = job.incident_type_id
    ? INCIDENT_NAMES[job.incident_type_id] || "Roadside Assistance"
    : "Roadside Assistance";

  const handleArrived = async () => {
    setLoading(true);
    try {
      await supabase.from("jobs").update({ job_status: "driver_arrived" }).eq("job_id", job.job_id);
      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "driver_arrived",
        event_category: "lifecycle",
        message: "Driver reported arrival via mobile app",
        new_value: { job_status: "driver_arrived" },
      });
      onUpdate();
    } catch (err: any) { Alert.alert("Error", err.message); }
    finally { setLoading(false); }
  };

  const handleStartService = async () => {
    setLoading(true);
    try {
      await supabase.from("jobs").update({ job_status: "service_in_progress" }).eq("job_id", job.job_id);
      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "status_changed",
        event_category: "lifecycle",
        message: "Driver started service via mobile app",
        new_value: { job_status: "service_in_progress" },
      });
      onUpdate();
    } catch (err: any) { Alert.alert("Error", err.message); }
    finally { setLoading(false); }
  };

  const handleMarkDone = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/complete-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.job_id, driverId, confirmed: false }),
      });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || "Failed to mark complete");
      onUpdate();
    } catch (err: any) {
      // Fallback to direct DB
      await supabase.from("jobs").update({ job_status: "pending_completion_approval" }).eq("job_id", job.job_id);
      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "status_changed",
        event_category: "lifecycle",
        message: "Driver marked job complete via app (fallback)",
        new_value: { job_status: "pending_completion_approval" },
      });
      onUpdate();
    } finally { setLoading(false); }
  };

  const handleAdjustPrice = async () => {
    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert("Invalid Amount", "Please enter a valid dollar amount.");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/driver-adjust-amount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.job_id, driverId, newAmount: amount }),
      });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || "Failed");
      setShowAdjust(false);
      setNewAmount("");
      Alert.alert("Price Updated", `New amount: $${amount.toFixed(2)}`);
      onUpdate();
    } catch (err: any) { Alert.alert("Error", err.message); }
    finally { setLoading(false); }
  };

  const handleCancelAtScene = () => {
    Alert.alert(
      "Unable to Complete",
      "Report that you cannot complete this job. No compensation will be issued.",
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Confirm",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const resp = await fetch(`${SUPABASE_URL}/functions/v1/driver-cancel-at-scene`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId: job.job_id, driverId, reason: "Driver unable to complete (reported via app)" }),
              });
              const result = await resp.json();
              if (!result.success) throw new Error(result.error || "Failed");
              onUpdate();
            } catch (err: any) { Alert.alert("Error", err.message); }
            finally { setLoading(false); }
          },
        },
      ]
    );
  };

  // Waiting for customer confirmation
  if (job.job_status === "pending_completion_approval") {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.waitingTitle}>Awaiting Customer Confirmation</Text>
        <Text style={styles.waitingText}>
          You've marked this job as done. Waiting for the customer to confirm completion.
        </Text>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Amount</Text>
          <Text style={styles.summaryPrice}>${Number(job.estimated_price || 0).toFixed(2)}</Text>
        </View>
      </View>
    );
  }

  const statusLabel: Record<string, string> = {
    driver_enroute: "En Route to Scene",
    driver_arrived: "On Scene",
    service_in_progress: "Service In Progress",
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>{statusLabel[job.job_status] || job.job_status}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.incidentType}>{incidentName}</Text>
        <DetailRow label="Vehicle" value={vehicle} />
        <DetailRow label="Location" value={job.pickup_location || "—"} />
        <DetailRow label="Can Roll?" value={job.can_vehicle_roll === true ? "Yes" : job.can_vehicle_roll === false ? "No" : "?"} />
        <DetailRow label="Price" value={`$${Number(job.estimated_price || 0).toFixed(2)}`} />
      </View>

      {/* Primary action */}
      {job.job_status === "driver_enroute" && (
        <TouchableOpacity style={styles.primaryButton} onPress={handleArrived} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>I've Arrived</Text>}
        </TouchableOpacity>
      )}

      {job.job_status === "driver_arrived" && (
        <TouchableOpacity style={styles.primaryButton} onPress={handleStartService} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Start Service</Text>}
        </TouchableOpacity>
      )}

      {job.job_status === "service_in_progress" && (
        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: "#16a34a" }]} onPress={handleMarkDone} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Mark Complete</Text>}
        </TouchableOpacity>
      )}

      {/* Price adjustment */}
      {(job.job_status === "driver_arrived" || job.job_status === "service_in_progress") && (
        <>
          {showAdjust ? (
            <View style={styles.adjustRow}>
              <TextInput
                style={styles.adjustInput}
                placeholder="New amount"
                keyboardType="decimal-pad"
                value={newAmount}
                onChangeText={setNewAmount}
              />
              <TouchableOpacity style={styles.adjustSubmit} onPress={handleAdjustPrice}>
                <Text style={styles.adjustSubmitText}>Update</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowAdjust(false)}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowAdjust(true)}>
              <Text style={styles.secondaryText}>Adjust Price</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.dangerButton} onPress={handleCancelAtScene}>
            <Text style={styles.dangerText}>Can't Complete Job</Text>
          </TouchableOpacity>
        </>
      )}
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
  centered: { alignItems: "center", justifyContent: "center" },
  statusBadge: { backgroundColor: "#2563eb", borderRadius: 8, padding: 10, alignItems: "center", marginBottom: 16 },
  statusText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 20, marginBottom: 24, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  incidentType: { fontSize: 20, fontWeight: "700", color: "#1a1a2e", marginBottom: 12, textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  rowLabel: { fontSize: 14, color: "#888" },
  rowValue: { fontSize: 14, color: "#1a1a2e", fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 12 },
  primaryText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondaryButton: { borderWidth: 2, borderColor: "#2563eb", borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 12 },
  secondaryText: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  dangerButton: { padding: 14, alignItems: "center" },
  dangerText: { color: "#dc2626", fontSize: 15, fontWeight: "500" },
  adjustRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  adjustInput: { flex: 1, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 12, fontSize: 16 },
  adjustSubmit: { backgroundColor: "#2563eb", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20 },
  adjustSubmitText: { color: "#fff", fontWeight: "700" },
  cancelLink: { color: "#888", padding: 12 },
  waitingTitle: { fontSize: 20, fontWeight: "700", color: "#1a1a2e", marginTop: 20, marginBottom: 8 },
  waitingText: { fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22, marginBottom: 24 },
  summaryCard: { backgroundColor: "#fff", borderRadius: 12, padding: 24, alignItems: "center", width: "80%" },
  summaryLabel: { fontSize: 14, color: "#888", marginBottom: 4 },
  summaryPrice: { fontSize: 36, fontWeight: "800", color: "#1a1a2e" },
});
