import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { supabase, SUPABASE_URL } from "../lib/supabase";
import { INCIDENT_NAMES } from "../types/driver";
import type { DispatchOffer, JobForDriver } from "../types/driver";

interface Props {
  offer: DispatchOffer;
  job: JobForDriver;
  onResponded: () => void;
}

/**
 * Driver sees incoming dispatch offer with job details.
 * Replaces the SMS offer → YES/NO flow.
 */
export default function OfferScreen({ offer, job, onResponded }: Props) {
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  // Countdown timer
  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [offer.expires_at]);

  const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
    .filter(Boolean).join(" ") || "Not specified";

  const incidentName = job.incident_type_id
    ? INCIDENT_NAMES[job.incident_type_id] || "Roadside Assistance"
    : "Roadside Assistance";

  const payout = job.estimated_price
    ? `$${(Number(job.estimated_price) * 0.8).toFixed(2)}`
    : "TBD";

  const handleAccept = async () => {
    setLoading(true);
    try {
      // Accept offer via DB (same as twilio-webhook YES path)
      await supabase
        .from("dispatch_offers")
        .update({ offer_status: "accepted", response_time: Math.floor((Date.now() - new Date(offer.created_at).getTime()) / 1000) })
        .eq("offer_id", offer.offer_id);

      await supabase
        .from("jobs")
        .update({
          job_status: "driver_enroute",
          assigned_driver_id: offer.driver_id,
          assigned_truck_id: offer.truck_id,
        })
        .eq("job_id", job.job_id);

      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "driver_accepted",
        event_category: "dispatch",
        message: `Driver accepted job via mobile app`,
        new_value: { source: "app", job_status: "driver_enroute", assigned_driver_id: offer.driver_id },
      });

      onResponded();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    setLoading(true);
    try {
      await supabase
        .from("dispatch_offers")
        .update({ offer_status: "declined", response_time: Math.floor((Date.now() - new Date(offer.created_at).getTime()) / 1000) })
        .eq("offer_id", offer.offer_id);

      await supabase.from("job_events").insert({
        job_id: job.job_id,
        event_type: "driver_declined",
        event_category: "dispatch",
        message: "Driver declined offer via mobile app",
      });

      onResponded();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  if (timeLeft <= 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.expiredTitle}>Offer Expired</Text>
        <Text style={styles.expiredText}>This dispatch offer has expired.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.timerBar}>
        <Text style={styles.timerText}>
          {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")} remaining
        </Text>
      </View>

      <Text style={styles.title}>New Job Offer</Text>

      <View style={styles.card}>
        <Text style={styles.incidentType}>{incidentName}</Text>
        <DetailRow label="Vehicle" value={vehicle} />
        <DetailRow label="Location" value={job.pickup_location || "Not provided"} />
        <DetailRow label="Can Roll?" value={job.can_vehicle_roll === true ? "Yes" : job.can_vehicle_roll === false ? "No" : "Unknown"} />
        <DetailRow label="Your Payout" value={payout} highlight />
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.declineButton} onPress={handleDecline} disabled={loading}>
          <Text style={styles.declineText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptButton} onPress={handleAccept} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.acceptText}>Accept Job</Text>
          )}
        </TouchableOpacity>
      </View>
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
  container: { flex: 1, padding: 24, backgroundColor: "#f8f9fa" },
  centered: { alignItems: "center", justifyContent: "center" },
  timerBar: { backgroundColor: "#fef3c7", borderRadius: 8, padding: 10, alignItems: "center", marginBottom: 16 },
  timerText: { color: "#92400e", fontWeight: "700", fontSize: 15 },
  title: { fontSize: 26, fontWeight: "800", color: "#1a1a2e", marginBottom: 20 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 20, marginBottom: 24, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  incidentType: { fontSize: 20, fontWeight: "700", color: "#2563eb", marginBottom: 16, textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  rowLabel: { fontSize: 14, color: "#888", fontWeight: "500" },
  rowValue: { fontSize: 14, color: "#1a1a2e", fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  rowHighlight: { fontSize: 18, fontWeight: "800", color: "#16a34a" },
  buttonRow: { flexDirection: "row", gap: 12 },
  declineButton: { flex: 1, borderWidth: 2, borderColor: "#dc2626", borderRadius: 12, padding: 16, alignItems: "center" },
  declineText: { color: "#dc2626", fontSize: 17, fontWeight: "700" },
  acceptButton: { flex: 2, backgroundColor: "#16a34a", borderRadius: 12, padding: 16, alignItems: "center" },
  acceptText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  expiredTitle: { fontSize: 22, fontWeight: "700", color: "#dc2626", marginBottom: 8 },
  expiredText: { fontSize: 15, color: "#666" },
});
