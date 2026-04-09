import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const V = "alice";

function resp(body: string): Response {
  return new Response(`<Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
}

function menu(msg: string): string {
  return `<Gather input="dtmf" numDigits="1" timeout="10"><Say voice="${V}">${msg}</Say></Gather><Say voice="${V}">No response. Goodbye.</Say><Hangup/>`;
}

function say(msg: string): string {
  return `<Say voice="${V}">${msg}</Say>`;
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return resp(`${say("Error. Goodbye.")}<Hangup/>`);
  }

  const callSid = (formData.get("CallSid") as string) || "unknown";
  const from = (formData.get("From") as string) || "";
  const digits = (formData.get("Digits") as string) || "";

  // Load state from DB (keyed by CallSid)
  const { data: existing } = await supabase
    .from("voice_call_sessions")
    .select("*")
    .eq("call_sid", callSid)
    .maybeSingle();

  let step = existing?.ivr_step ?? 0;
  let incidentId = existing?.incident_type_id ?? "";
  let locationType = existing?.location_type ?? "";

  // Create or update session record
  if (!existing) {
    await supabase.from("voice_call_sessions").insert({
      call_sid: callSid,
      caller_phone: from,
      ivr_step: 0,
    });
  }

  // ── STEP 0: Greeting → incident menu ──
  if (step === 0 && !digits) {
    return resp(menu(
      "Hello! This is Way Lift Roadside Assistance. " +
      "Press 1 for a tow. Press 2 for battery jumpstart. Press 3 for flat tire. " +
      "Press 4 for lockout. Press 5 for fuel delivery. Press 6 for other."
    ));
  }

  // ── Incident selected → save + ask location ──
  if (step === 0 && digits) {
    const incidents: Record<string, { id: string; name: string }> = {
      "1": { id: "1d8d7d3b-c58b-4b2b-944e-b1c00ca8969f", name: "Tow" },
      "2": { id: "a4cdb184-d275-41a0-a2dc-cf17fe4ba5c9", name: "Battery Boost" },
      "3": { id: "34c06174-258e-4bed-978f-cad26ee6c789", name: "Flat Tire" },
      "4": { id: "a53fc74d-2c2c-40dd-ad2f-8141137dda51", name: "Lockout" },
      "5": { id: "f2c9fc2d-d3a4-4aac-a607-9568de922a1d", name: "Fuel Delivery" },
      "6": { id: "252293cb-7340-4b47-8cf6-b2a7813f4309", name: "Other" },
    };
    const inc = incidents[digits];
    if (!inc) {
      return resp(menu("Invalid selection. Press 1 for tow. 2 for battery. 3 for flat tire. 4 for lockout. 5 for fuel. 6 for other."));
    }

    await supabase.from("voice_call_sessions")
      .update({ ivr_step: 1, incident_type_id: inc.id, incident_name: inc.name })
      .eq("call_sid", callSid);

    return resp(menu(
      `Got it, ${inc.name}. Are you on a major highway? ` +
      "Press 1 for highway. Press 2 for city street. Press 3 for parking lot."
    ));
  }

  // ── Location selected → save + ask can roll ──
  if (step === 1 && digits) {
    const locs: Record<string, string> = { "1": "highway", "2": "city_street", "3": "parking_lot" };
    const loc = locs[digits] || "unknown";

    await supabase.from("voice_call_sessions")
      .update({ ivr_step: 2, location_type: loc })
      .eq("call_sid", callSid);

    return resp(menu("Can your vehicle roll or be put in neutral? Press 1 for yes. Press 2 for no."));
  }

  // ── Can roll → create job ──
  if (step === 2 && digits) {
    const canRoll = digits === "1";

    // Reload full session
    const { data: sess } = await supabase
      .from("voice_call_sessions")
      .select("*")
      .eq("call_sid", callSid)
      .single();

    // Mark session complete
    await supabase.from("voice_call_sessions")
      .update({ ivr_step: 3, can_vehicle_roll: canRoll, completed_at: new Date().toISOString() })
      .eq("call_sid", callSid);

    // Create job via intake-create-job
    try {
      const jobResp = await fetch(`${SUPABASE_URL}/functions/v1/intake-create-job`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: from || sess?.caller_phone,
          incidentTypeId: sess?.incident_type_id,
          pickupLocation: `Caller on ${(sess?.location_type || "").replace("_", " ")} — exact address pending`,
          canVehicleRoll: canRoll,
          locationType: sess?.location_type,
        }),
      });
      const result = await jobResp.json();
      console.log(`[VOICE-IVR] Job: ${JSON.stringify(result)}`);

      if (result.success) {
        return resp(
          say("Thank you! Your request has been submitted. A driver will be assigned shortly and you will receive a text message with the details. Stay safe!") +
          "<Hangup/>"
        );
      }
    } catch (err) {
      console.error("[VOICE-IVR] Error:", err);
    }

    return resp(say("Thank you for calling. A dispatcher will contact you shortly. Goodbye.") + "<Hangup/>");
  }

  return resp(say("Goodbye.") + "<Hangup/>");
});
