import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const MAX_RETRIES = 2;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const formData = await req.formData();
    const callSid = formData.get("CallSid") as string || "";
    const from = (formData.get("From") as string || "").trim();
    const speechResult = (formData.get("SpeechResult") as string || "").trim();
    const digits = (formData.get("Digits") as string || "").trim();
    const input = speechResult || digits;

    // Parse step from URL query
    const url = new URL(req.url);
    const stepParam = parseInt(url.searchParams.get("step") || "1", 10);

    const functionUrl = `${SUPABASE_URL}/functions/v1/rin-voice-intake`;

    console.log(`Voice intake: CallSid=${callSid} step=${stepParam} input="${input}" from=${from}`);

    if (!callSid) {
      return twiml("<Say>We could not identify your call. Please try again.</Say><Hangup/>");
    }

    // Step 1: Initial greeting — no input expected
    if (stepParam === 1) {
      // Create session
      await supabase.from("voice_call_sessions").upsert({
        call_sid: callSid,
        step: 1,
        retry_count: 0,
        caller_phone: from,
        updated_at: new Date().toISOString(),
      }, { onConflict: "call_sid" });

      return twiml(`
        <Say voice="Polly.Joanna">Welcome to RIN roadside assistance. I'll ask you a few questions to get help on the way.</Say>
        <Gather input="speech" speechTimeout="auto" action="${functionUrl}?step=2" method="POST">
          <Say voice="Polly.Joanna">What happened to your vehicle?</Say>
        </Gather>
        <Redirect method="POST">${functionUrl}?step=2</Redirect>
      `);
    }

    // Fetch session
    const { data: session } = await supabase
      .from("voice_call_sessions")
      .select("*")
      .eq("call_sid", callSid)
      .single();

    if (!session) {
      return twiml("<Say>We lost your session. Please call back.</Say><Hangup/>");
    }

    // Retry logic helper
    const retryCount = session.retry_count || 0;

    if (!input && stepParam > 1) {
      // No speech detected — retry or fallback
      if (retryCount < MAX_RETRIES) {
        await supabase.from("voice_call_sessions")
          .update({ retry_count: retryCount + 1, updated_at: new Date().toISOString() })
          .eq("call_sid", callSid);

        const retryPrompts: Record<number, string> = {
          2: "I didn't catch that. What happened to your vehicle?",
          3: "I didn't catch that. Can the vehicle still drive? Say yes or no.",
          4: "I didn't catch that. Is your vehicle on a street, highway, or in a parking garage?",
          5: "I didn't catch that. Where is the vehicle located right now?",
          6: "I didn't catch that. What is the make and model of the vehicle?",
          7: "I didn't catch that. Where should the vehicle be towed?",
        };

        const prompt = retryPrompts[stepParam] || "I didn't catch that. Please try again.";
        return twiml(`
          <Gather input="speech" speechTimeout="auto" action="${functionUrl}?step=${stepParam}" method="POST">
            <Say voice="Polly.Joanna">${escapeXml(prompt)}</Say>
          </Gather>
          <Redirect method="POST">${functionUrl}?step=${stepParam}</Redirect>
        `);
      }

      // Max retries exceeded — send SMS fallback and preserve partial data
      await sendFallbackSms(from, callSid, session);
      return twiml(`
        <Say voice="Polly.Joanna">I'm having trouble hearing you. We'll send you a text message to continue your request. Thank you for calling RIN.</Say>
        <Hangup/>
      `);
    }

    // Reset retry count on successful input
    await supabase.from("voice_call_sessions")
      .update({ retry_count: 0, updated_at: new Date().toISOString() })
      .eq("call_sid", callSid);

    // Step 2: Store incident_description → ask drivable
    if (stepParam === 2) {
      await supabase.from("voice_call_sessions")
        .update({ incident_description: input, step: 2 })
        .eq("call_sid", callSid);

      return twiml(`
        <Gather input="speech" speechTimeout="auto" action="${functionUrl}?step=3" method="POST">
          <Say voice="Polly.Joanna">Can the vehicle still drive? Say yes or no.</Say>
        </Gather>
        <Redirect method="POST">${functionUrl}?step=3</Redirect>
      `);
    }

    // Step 3: Store drivable → ask location_type
    if (stepParam === 3) {
      const lower = input.toLowerCase();
      const drivable = lower.includes("yes") || lower.includes("yeah") || lower.includes("yep");
      
      await supabase.from("voice_call_sessions")
        .update({ drivable, step: 3 })
        .eq("call_sid", callSid);

      return twiml(`
        <Gather input="speech" speechTimeout="auto" action="${functionUrl}?step=4" method="POST">
          <Say voice="Polly.Joanna">Is your vehicle on a street, on a highway, or in a parking garage?</Say>
        </Gather>
        <Redirect method="POST">${functionUrl}?step=4</Redirect>
      `);
    }

    // Step 4: Store location_type → ask location
    if (stepParam === 4) {
      const lower = input.toLowerCase();
      let locationType = "street";
      if (lower.includes("highway") || lower.includes("freeway") || lower.includes("interstate")) {
        locationType = "highway";
      } else if (lower.includes("garage") || lower.includes("parking") || lower.includes("lot")) {
        locationType = "parking_garage";
      }

      await supabase.from("voice_call_sessions")
        .update({ location_type: locationType, step: 4 })
        .eq("call_sid", callSid);

      return twiml(`
        <Gather input="speech" speechTimeout="auto" action="${functionUrl}?step=5" method="POST">
          <Say voice="Polly.Joanna">Where is the vehicle located right now? Please include any street names, intersections, or landmarks.</Say>
        </Gather>
        <Redirect method="POST">${functionUrl}?step=5</Redirect>
      `);
    }

    // Step 5: Store location → ask vehicle info
    if (stepParam === 5) {
      await supabase.from("voice_call_sessions")
        .update({ location_text: input, step: 5 })
        .eq("call_sid", callSid);

      return twiml(`
        <Gather input="speech" speechTimeout="auto" action="${functionUrl}?step=6" method="POST">
          <Say voice="Polly.Joanna">What is the year, make, and model of the vehicle? For example, 2020 Honda Civic.</Say>
        </Gather>
        <Redirect method="POST">${functionUrl}?step=6</Redirect>
      `);
    }

    // Step 6: Store vehicle_info → if not drivable ask tow destination, else finalize
    if (stepParam === 6) {
      await supabase.from("voice_call_sessions")
        .update({ vehicle_info: input, step: 6 })
        .eq("call_sid", callSid);

      // Reload session for drivable status
      const { data: updated } = await supabase
        .from("voice_call_sessions")
        .select("drivable")
        .eq("call_sid", callSid)
        .single();

      if (updated && updated.drivable === false) {
        return twiml(`
          <Gather input="speech" speechTimeout="auto" action="${functionUrl}?step=7" method="POST">
            <Say voice="Polly.Joanna">Where should the vehicle be towed? Please provide an address or business name.</Say>
          </Gather>
          <Redirect method="POST">${functionUrl}?step=7</Redirect>
        `);
      }

      // Drivable — skip tow destination, finalize
      return await finalizeIntake(supabase, callSid, functionUrl);
    }

    // Step 7: Store destination → finalize
    if (stepParam === 7) {
      await supabase.from("voice_call_sessions")
        .update({ destination_text: input, step: 7 })
        .eq("call_sid", callSid);

      return await finalizeIntake(supabase, callSid, functionUrl);
    }

    return twiml("<Say>Something went wrong. Please call back.</Say><Hangup/>");
  } catch (error) {
    console.error("Voice intake error:", error);
    return twiml("<Say>We're sorry, something went wrong. Please try again later.</Say><Hangup/>");
  }
});

// ---------------------------------------------------------------------------
// Finalize: assemble payload and invoke shared pipeline
// ---------------------------------------------------------------------------

async function finalizeIntake(supabase: any, callSid: string, _functionUrl: string) {
  const { data: session } = await supabase
    .from("voice_call_sessions")
    .select("*")
    .eq("call_sid", callSid)
    .single();

  if (!session) {
    return twiml("<Say>We lost your session. Please call back.</Say><Hangup/>");
  }

  // Parse vehicle info best-effort
  const vehicleParsed = parseVehicleInfo(session.vehicle_info || "");

  // Assemble IntakePayload
  const intakePayload = {
    incident_description: session.incident_description || "",
    incident_type: null,
    location_text: session.location_text || "",
    location_lat: null,
    location_lng: null,
    location_type: session.location_type || null,
    vehicle_make: vehicleParsed.make,
    vehicle_model: vehicleParsed.model,
    vehicle_year: vehicleParsed.year,
    vehicle_info: session.vehicle_info || "",
    drivable: session.drivable,
    tow_required: session.drivable === false ? true : null,
    destination_text: session.destination_text || null,
    caller_name: "Voice Customer",
    caller_phone: session.caller_phone || "",
    language: "en",
    intake_source: "voice",
  };

  // Invoke the shared server-side intake pipeline
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/process-intake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(intakePayload),
    });

    const result = await resp.json();

    if (result.success && result.job_id) {
      // Update session with job_id
      await supabase.from("voice_call_sessions")
        .update({ job_id: result.job_id })
        .eq("call_sid", callSid);

      return twiml(`
        <Say voice="Polly.Joanna">Your request has been received. A driver is being dispatched to your location. You will receive a text message with tracking details. Thank you for calling RIN.</Say>
        <Hangup/>
      `);
    } else {
      console.error("Process intake returned error:", result);
      return twiml(`
        <Say voice="Polly.Joanna">We've recorded your information but had trouble creating the request. You will receive a text message with next steps. Thank you for calling RIN.</Say>
        <Hangup/>
      `);
    }
  } catch (e) {
    console.error("Failed to invoke process-intake:", e);
    // Still preserve data — send SMS fallback
    await sendFallbackSms(session.caller_phone, callSid, session);
    return twiml(`
      <Say voice="Polly.Joanna">We've recorded your information. You will receive a text message with next steps. Thank you for calling RIN.</Say>
      <Hangup/>
    `);
  }
}

// ---------------------------------------------------------------------------
// Send SMS fallback for partial/failed sessions
// ---------------------------------------------------------------------------

async function sendFallbackSms(phone: string, callSid: string, session: any) {
  if (!phone) return;

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!LOVABLE_API_KEY || !TWILIO_API_KEY || !TWILIO_PHONE_NUMBER) return;

  const body = `RIN: We received a partial request from your call. To complete your roadside request, please use our chat: https://rin-beta.lovable.app/get-help/chat`;

  try {
    await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, From: TWILIO_PHONE_NUMBER, Body: body }),
    });
  } catch (e) {
    console.error("Fallback SMS failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Vehicle info parser (best-effort)
// ---------------------------------------------------------------------------

function parseVehicleInfo(text: string): { year: number | null; make: string; model: string } {
  if (!text) return { year: null, make: "", model: "" };
  const parts = text.trim().split(/\s+/);
  let year: number | null = null;
  let rest = parts;

  if (parts.length > 0 && /^\d{4}$/.test(parts[0])) {
    const y = parseInt(parts[0], 10);
    if (y >= 1900 && y <= 2030) {
      year = y;
      rest = parts.slice(1);
    }
  }

  const make = rest[0] || "";
  const model = rest.slice(1).join(" ") || "";
  return { year, make, model };
}

// ---------------------------------------------------------------------------
// TwiML helpers
// ---------------------------------------------------------------------------

function twiml(body: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${body}
</Response>`;
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
