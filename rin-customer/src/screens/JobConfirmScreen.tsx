import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { supabase, SUPABASE_URL } from "../lib/supabase";
import type { Job } from "../types/job";

interface Props {
  job: Job;
  onConfirmed: () => void;
}

/**
 * Step 1: Customer confirms their roadside request details.
 * Replaces the SMS "reply YES" flow.
 */
export default function JobConfirmScreen({ job, onConfirmed }: Props) {
  const [loading, setLoading] = useState(false);

  const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
    .filter(Boolean)
    .join(" ") || "Not specified";

  const handleConfirm = async () => {
    setLoading(true);
    try {
      // Same DB update the twilio-webhook does for YES
      const { error } = await supabase
        .from("jobs")
        .update({
          job_status: "pending_pricing",
          sms_confirmed: true,
          sms_confirmed_at: new Date().toISOString(),
          confirmation_channel: "app",
        })
        .eq("job_id", job.job_id)
        .eq("job_status", "pending_customer_confirmation");

      if (error) throw error;

      // Log event
      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "customer_confirmed_app",
        event_category: "communication",
        message: "Customer confirmed request via mobile app",
        new_value: { job_status: "pending_pricing", channel: "app" },
      });

      onConfirmed();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not confirm. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    Alert.alert("Cancel Request", "Are you sure you want to cancel?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, Cancel",
        style: "destructive",
        onPress: async () => {
          await supabase
            .from("jobs")
            .update({ job_status: "cancelled_by_customer" })
            .eq("job_id", job.job_id);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirm Your Request</Text>

      <View style={styles.card}>
        <DetailRow label="Vehicle" value={vehicle} />
        <DetailRow label="Location" value={job.pickup_location || "Not provided"} />
        <DetailRow
          label="Can vehicle roll?"
          value={job.can_vehicle_roll === true ? "Yes" : job.can_vehicle_roll === false ? "No" : "Not answered"}
        />
      </View>

      <Text style={styles.subtitle}>Please confirm these details are correct.</Text>

      <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.confirmText}>Confirm Details</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
        <Text style={styles.cancelText}>Cancel Request</Text>
      </TouchableOpacity>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 20 },
  subtitle: { fontSize: 15, color: "#666", marginBottom: 24, lineHeight: 22 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 20, marginBottom: 20, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  label: { fontSize: 14, color: "#888", fontWeight: "500" },
  value: { fontSize: 14, color: "#1a1a2e", fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  confirmButton: { backgroundColor: "#2563eb", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 12 },
  confirmText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  cancelButton: { padding: 16, alignItems: "center" },
  cancelText: { color: "#dc2626", fontSize: 15, fontWeight: "500" },
});
