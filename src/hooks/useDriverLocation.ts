import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseExternal as supabase } from "@/lib/supabaseExternal";

interface DriverLocation {
  lat: number;
  lng: number;
  recorded_at: string;
}

interface UseDriverLocationResult {
  driverLocation: DriverLocation | null;
  distanceKm: number | null;
  etaMinutes: number | null;
}

const AVG_SPEED_KMH = 50;

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useDriverLocation(
  jobId: string | null | undefined,
  pickupLat: number | null | undefined,
  pickupLng: number | null | undefined
): UseDriverLocationResult {
  const [realtimeLocation, setRealtimeLocation] = useState<DriverLocation | null>(null);

  // Initial query for latest location
  const { data: queryLocation } = useQuery({
    queryKey: ["driver_location", jobId],
    enabled: !!jobId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_location_updates")
        .select("lat, lng, recorded_at")
        .eq("job_id", jobId!)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? { lat: Number(data.lat), lng: Number(data.lng), recorded_at: data.recorded_at } : null;
    },
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!jobId) return;

    const channel = supabase
      .channel(`driver-location-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "driver_location_updates",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const row = payload.new as any;
          setRealtimeLocation({
            lat: Number(row.lat),
            lng: Number(row.lng),
            recorded_at: row.recorded_at,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  const driverLocation = realtimeLocation || queryLocation || null;

  let distanceKm: number | null = null;
  let etaMinutes: number | null = null;

  if (driverLocation && pickupLat != null && pickupLng != null) {
    distanceKm = Math.round(haversineDistance(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng) * 10) / 10;
    etaMinutes = Math.max(1, Math.round((distanceKm / AVG_SPEED_KMH) * 60));
  }

  return { driverLocation, distanceKm, etaMinutes };
}
