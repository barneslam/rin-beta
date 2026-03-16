import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are RIN, a calm and helpful roadside assistance agent. Your job is to quickly collect the information needed to dispatch help.

You need to find out:
1. What happened (flat tire, won't start, locked out, accident, stuck, etc.)
2. Where the person is (address, intersection, or landmark)
3. Vehicle details (make, model, year) — ask if not provided but don't push hard

Keep your messages short (1-3 sentences max). Be warm but efficient — this person is stranded.

Start by greeting them briefly and asking what happened.

When you have enough information (at minimum: what happened and where they are), call the create_roadside_job tool to create their help request. Do NOT ask for confirmation — just create it once you have the essentials.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_roadside_job",
      description:
        "Create a roadside assistance job once you have collected enough information from the caller.",
      parameters: {
        type: "object",
        properties: {
          incident_description: {
            type: "string",
            description: "Brief description of what happened (e.g. 'flat tire', 'dead battery', 'locked out')",
          },
          location: {
            type: "string",
            description: "Where the person is stranded",
          },
          vehicle_make: { type: "string", description: "Vehicle make" },
          vehicle_model: { type: "string", description: "Vehicle model" },
          vehicle_year: { type: "number", description: "Vehicle year" },
          caller_name: { type: "string", description: "Caller name if provided" },
          caller_phone: { type: "string", description: "Caller phone if provided" },
        },
        required: ["incident_description", "location"],
        additionalProperties: false,
      },
    },
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages,
          ],
          tools: TOOLS,
          tool_choice: "auto",
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service temporarily unavailable." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("roadside-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
