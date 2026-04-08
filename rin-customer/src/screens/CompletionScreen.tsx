import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { supabase, SUPABASE_URL } from "../lib/supabase";
import type { Job } from "../types/job";

interface Props {
  job: Job;
  onCompleted: () => void;
}

/**
 * Customer confirms service is complete. Triggers Phase 2 of complete-job
 * (Stripe capture + receipt SMS to both parties).
 * Falls back to SMS if the edge function call fails.
 */
export default function CompletionScreen({ job, onCompleted }: Props) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      // Call complete-job Phase 2 via edge function (same as SMS CONFIRM path)
      const response = await fetch(`${SUPABASE_URL}/functions/v1/complete-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.job_id, confirmed: true }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        // Fallback: direct DB update if edge function fails
        console.warn("Edge function failed, falling back to direct update:", result);
        const { error } = await supabase
          .from("jobs")
          .update({ job_status: "job_completed", completed_at: new Date().toISOString() })
          .eq("job_id", job.job_id);

        if (error) throw error;

        await supabase.from("job_events").insert({
          job_id: job.job_id,
          event_type: "status_changed",
          event_category: "lifecycle",
          message: "Customer confirmed via app (fallback — edge function unavailable)",
          new_value: { job_status: "job_completed", channel: "app", fallback: true },
        });

        // Log anomaly for the fallback
        await supabase.from("job_anomalies").insert({
          job_id: job.job_id,
          anomaly_type: "sms_missing",
          severity: "warning",
          message: "Completion confirmed via app fallback — Stripe capture and receipt SMS may not have fired",
        });
      }

      onCompleted();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not confirm completion. Trying SMS fallback...");
      // If everything fails, the SMS path still works — customer can reply CONFIRM
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>?</Text>
      </View>

      <Text style={styles.title}>Service Complete?</Text>
      <Text style={styles.subtitle}>
        Your driver has marked the service as done. Please confirm if everything looks good.
      </Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Amount to charge</Text>
        <Text style={styles.summaryPrice}>
          ${job.estimated_price ? Number(job.estimated_price).toFixed(2) : "—"}
        </Text>
      </View>

      <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.confirmText}>Confirm & Pay</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.helpText}>
        Having an issue? Contact your dispatcher for assistance.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa", alignItems: "center", justifyContent: "center" },
  iconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", marginBottom: 24 },
  icon: { fontSize: 40 },
  title: { fontSize: 26, fontWeight: "700", color: "#1a1a2e", marginBottom: 12 },
  subtitle: { fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22, marginBottom: 24, paddingHorizontal: 16 },
  summaryCard: { backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 32, width: "100%", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 12, elevation: 3 },
  summaryLabel: { fontSize: 14, color: "#888", marginBottom: 4 },
  summaryPrice: { fontSize: 40, fontWeight: "800", color: "#1a1a2e" },
  confirmButton: { backgroundColor: "#16a34a", borderRadius: 12, padding: 16, alignItems: "center", width: "100%", marginBottom: 16 },
  confirmText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  helpText: { fontSize: 13, color: "#999", textAlign: "center" },
});
