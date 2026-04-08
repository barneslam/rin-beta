import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import type { Job } from "../types/job";

interface Props {
  job: Job;
  onApproved: () => void;
}

/**
 * Customer reviews and approves the quoted price.
 * Handles both initial pricing and amendment re-approval.
 */
export default function PriceApprovalScreen({ job, onApproved }: Props) {
  const [loading, setLoading] = useState(false);
  const isAmendment = job.job_status === "customer_reapproval_pending";

  const handleApprove = async () => {
    setLoading(true);
    try {
      const newStatus = isAmendment ? "service_in_progress" : "payment_authorization_required";

      const updates: Record<string, any> = { job_status: newStatus };
      if (!isAmendment) {
        // Apply payment bypass for now (replace with Stripe in production)
        updates.stripe_payment_intent_id = `bypass_app_${Math.floor(Date.now() / 1000)}`;
      }

      const { error } = await supabase
        .from("jobs")
        .update(updates)
        .eq("job_id", job.job_id);

      if (error) throw error;

      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: isAmendment ? "amendment_approved" : "customer_approve_app",
        event_category: "pricing",
        message: isAmendment
          ? `Customer approved amended price of $${job.estimated_price} via app`
          : `Customer approved price of $${job.estimated_price} via app`,
        new_value: { job_status: newStatus, channel: "app" },
      });

      // If not amendment, also advance past payment to ready_for_dispatch
      if (!isAmendment) {
        await supabase
          .from("jobs")
          .update({ job_status: "ready_for_dispatch" })
          .eq("job_id", job.job_id);

        await supabase.from("job_events").insert({
          job_id: job.job_id,
          event_type: "payment_bypassed",
          event_category: "payment",
          message: "Payment bypassed via app — advanced to ready_for_dispatch",
        });
      }

      onApproved();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = () => {
    Alert.alert(
      isAmendment ? "Decline Revised Price" : "Decline Quote",
      "Would you like to cancel this request?",
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Cancel Request",
          style: "destructive",
          onPress: async () => {
            await supabase
              .from("jobs")
              .update({ job_status: "cancelled_by_customer", cancelled_by: "customer", cancelled_reason: "Price declined" })
              .eq("job_id", job.job_id);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isAmendment ? "Revised Quote" : "Your Quote"}
      </Text>

      {isAmendment && job.amendment_reason && (
        <View style={styles.amendmentBanner}>
          <Text style={styles.amendmentText}>
            The service provider has revised the charge: {job.amendment_reason}
          </Text>
        </View>
      )}

      <View style={styles.priceCard}>
        <Text style={styles.priceLabel}>Estimated Total</Text>
        <Text style={styles.priceValue}>
          ${job.estimated_price?.toFixed(2) ?? "—"}
        </Text>
        <Text style={styles.priceNote}>
          Your card will be authorized but not charged until service is complete.
        </Text>
      </View>

      <TouchableOpacity style={styles.approveButton} onPress={handleApprove} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.approveText}>Approve ${job.estimated_price?.toFixed(2)}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.declineButton} onPress={handleDecline}>
        <Text style={styles.declineText}>Decline</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 20 },
  amendmentBanner: { backgroundColor: "#fef3c7", borderRadius: 8, padding: 14, marginBottom: 16 },
  amendmentText: { color: "#92400e", fontSize: 14, lineHeight: 20 },
  priceCard: { backgroundColor: "#fff", borderRadius: 16, padding: 32, alignItems: "center", marginBottom: 24, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 12, elevation: 3 },
  priceLabel: { fontSize: 14, color: "#888", marginBottom: 8 },
  priceValue: { fontSize: 48, fontWeight: "800", color: "#1a1a2e", marginBottom: 12 },
  priceNote: { fontSize: 13, color: "#999", textAlign: "center", lineHeight: 18 },
  approveButton: { backgroundColor: "#16a34a", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 12 },
  approveText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  declineButton: { padding: 16, alignItems: "center" },
  declineText: { color: "#dc2626", fontSize: 15, fontWeight: "500" },
});
