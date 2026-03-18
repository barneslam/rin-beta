import { useState, useCallback } from "react";

export type GeoStatus = "idle" | "requesting" | "success" | "denied" | "unavailable" | "error";

interface DeviceLocationState {
  lat: number | null;
  lng: number | null;
  status: GeoStatus;
  errorMessage: string | null;
}

export function useDeviceLocation() {
  const [state, setState] = useState<DeviceLocationState>({
    lat: null,
    lng: null,
    status: "idle",
    errorMessage: null,
  });

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, status: "unavailable", errorMessage: "Geolocation not supported" }));
      return;
    }
    setState((s) => ({ ...s, status: "requesting", errorMessage: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          status: "success",
          errorMessage: null,
        });
      },
      (err) => {
        const status: GeoStatus = err.code === 1 ? "denied" : "error";
        setState({
          lat: null,
          lng: null,
          status,
          errorMessage: err.code === 1 ? "Location access denied" : "Could not get location",
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { ...state, requestLocation };
}
