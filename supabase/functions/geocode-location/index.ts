import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { location_text } = await req.json();
    if (!location_text || typeof location_text !== "string") {
      return new Response(
        JSON.stringify({ lat: null, lng: null, confidence: "low" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use OpenStreetMap Nominatim for geocoding (free, no API key needed)
    const encoded = encodeURIComponent(location_text);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;

    const resp = await fetch(url, {
      headers: { "User-Agent": "RIN-Roadside-Intake/1.0" },
    });

    if (!resp.ok) {
      console.error("Nominatim error:", resp.status);
      return new Response(
        JSON.stringify({ lat: null, lng: null, confidence: "low" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = await resp.json();

    if (!results.length) {
      return new Response(
        JSON.stringify({ lat: null, lng: null, confidence: "low" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const top = results[0];
    const lat = parseFloat(top.lat);
    const lng = parseFloat(top.lon);

    // Determine confidence based on Nominatim importance score and type
    const importance = parseFloat(top.importance || "0");
    const confidence =
      importance > 0.6 ? "high" : importance > 0.3 ? "medium" : "low";

    return new Response(
      JSON.stringify({ lat, lng, confidence }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("geocode-location error:", e);
    return new Response(
      JSON.stringify({ lat: null, lng: null, confidence: "low" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
