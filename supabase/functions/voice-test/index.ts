import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const V = "alice";

function xml(body: string): Response {
  return new Response(`<Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return xml(`<Say voice="${V}">Error. Goodbye.</Say><Hangup/>`);
  }

  const callSid = (formData.get("CallSid") as string) || "unknown";
  const from = (formData.get("From") as string) || "";
  const digits = (formData.get("Digits") as string) || "";
  const speech = (formData.get("SpeechResult") as string) || "";

  // Load or create session
  const { data: sess } = await supabase
    .from("voice_call_sessions")
    .select("*")
    .eq("call_sid", callSid)
    .maybeSingle();

  // Handle recording callback (Twilio sends recording URL here)
  const url = new URL(req.url);
  if (url.searchParams.get("step") === "recording") {
    const recordingUrl = (formData.get("RecordingUrl") as string) || "";
    const recordingSid = (formData.get("RecordingSid") as string) || "";
    if (recordingUrl) {
      console.log(`[VOICE] Recording saved: ${recordingUrl} SID: ${recordingSid}`);
      // Save recording URL to session for audit
      await supabase.from("voice_call_sessions")
        .update({ recording_url: recordingUrl, recording_sid: recordingSid })
        .eq("call_sid", callSid);
      // Log to audit
      await supabase.from("audit_logs").insert({
        action_type: "voice_recording_saved",
        event_type: "voice_intake",
        event_source: "twilio",
        new_value: { call_sid: callSid, recording_url: recordingUrl, recording_sid: recordingSid },
      });
    }
    return xml(""); // empty TwiML — just acknowledge
  }

  if (!sess) {
    await supabase.from("voice_call_sessions").insert({
      call_sid: callSid, caller_phone: from, ivr_step: 0, language_code: "en-US"
    });
    // Audit: new voice session
    await supabase.from("audit_logs").insert({
      action_type: "voice_session_started",
      event_type: "voice_intake",
      event_source: "twilio",
      new_value: { call_sid: callSid, caller_phone: from },
    });
  }

  const step = sess?.ivr_step ?? 0;

  // ═══════════════════════════════════════════════════════════
  // STEP 0: Greeting — open-ended speech input
  // Uses Twilio <Say> (fast) + speech recognition
  // ═══════════════════════════════════════════════════════════
  if (step === 0 && !speech && !digits) {
    // Language selection: press 1 for English, 2 for French, 3 for Cantonese — or just start speaking English
    return xml(
      // Record the entire call for audit/liability
      `<Record recordingStatusCallback="${SUPABASE_URL}/functions/v1/voice-test?step=recording" maxLength="300" playBeep="false" trim="trim-silence"/>` +
      `<Gather input="speech dtmf" numDigits="1" timeout="12" speechTimeout="4" language="en-US">` +
      `<Say voice="${V}">Hello! This is Way Lift Roadside Assistance. ` +
      `Please tell me your name, your location, and what happened with your vehicle. ` +
      `You may speak in your own language.</Say>` +
      `<Say voice="${V}" language="fr-CA">Bienvenue chez Way Lift. Dites-nous votre nom, votre emplacement et ce qui s'est passé. Vous pouvez parler dans votre langue.</Say>` +
      `</Gather>` +
      `<Say voice="${V}">I didn't hear anything. Goodbye.</Say><Hangup/>`
    );
  }

  // Language switch: pressed 1 for French or 2 for Cantonese
  if (step === 0 && digits && !speech) {
    if (digits === "1") {
      await supabase.from("voice_call_sessions").update({ language_code: "fr-CA" }).eq("call_sid", callSid);
      return xml(
        `<Gather input="speech" timeout="10" speechTimeout="4" language="fr-CA">` +
        `<Say voice="${V}" language="fr-CA">Bienvenue chez Way Lift assistance routière. Veuillez me dire votre nom, votre emplacement, et ce qui s'est passé avec votre véhicule.</Say>` +
        `</Gather>` +
        `<Say voice="${V}" language="fr-CA">Aucune réponse. Au revoir.</Say><Hangup/>`
      );
    }
    if (digits === "2") {
      await supabase.from("voice_call_sessions").update({ language_code: "yue-Hant-HK" }).eq("call_sid", callSid);
      return xml(
        `<Gather input="speech" timeout="10" speechTimeout="4" language="yue-Hant-HK">` +
        `<Say voice="${V}" language="zh-HK">歡迎致電 Way Lift 道路救援。請話畀我哋知你嘅名，你喺邊度，同埋你架車有咩問題。</Say>` +
        `</Gather>` +
        `<Say voice="${V}" language="zh-HK">冇收到回應。再見。</Say><Hangup/>`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 0 → caller spoke: extract with Claude Haiku
  // ═══════════════════════════════════════════════════════════
  if (step === 0 && speech) {
    console.log(`[VOICE] Caller said: "${speech}"`);

    await supabase.from("voice_call_sessions").update({
      ivr_step: 1, incident_description: speech
    }).eq("call_sid", callSid);

    if (!ANTHROPIC_KEY) {
      return xml(`<Say voice="${V}">Thank you. A dispatcher will text you shortly. Goodbye.</Say><Hangup/>`);
    }

    // Extract structured data
    try {
      const llmResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: `Extract roadside assistance info from caller speech. The caller may speak English, French, or Cantonese. Return JSON only, no other text:
{"name":null,"location":null,"incident":null,"vehicle_make":null,"vehicle_model":null,"vehicle_year":null,"can_roll":null,"language":"en|fr|zh"}
incident must be one of: tow, battery, flat tire, lockout, fuel, mechanical, accident, other, or null.
Detect the language spoken and set "language" accordingly.`,
          messages: [{ role: "user", content: speech }],
        }),
      });

      const data = await llmResp.json();
      const text = data.content?.[0]?.text || "{}";
      // Clean any markdown fencing
      const cleanJson = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const ext = JSON.parse(cleanJson);
      console.log(`[VOICE] Extracted: ${JSON.stringify(ext)}`);

      const incMap: Record<string, string> = {
        "tow": "1d8d7d3b-c58b-4b2b-944e-b1c00ca8969f",
        "battery": "a4cdb184-d275-41a0-a2dc-cf17fe4ba5c9",
        "flat tire": "34c06174-258e-4bed-978f-cad26ee6c789",
        "lockout": "a53fc74d-2c2c-40dd-ad2f-8141137dda51",
        "fuel": "f2c9fc2d-d3a4-4aac-a607-9568de922a1d",
        "mechanical": "8e5dd7f8-28df-4f98-be40-5d8c05eaff41",
        "accident": "2d677673-e400-423b-88a6-89632546ec46",
        "other": "252293cb-7340-4b47-8cf6-b2a7813f4309",
      };

      const incidentId = ext.incident ? incMap[ext.incident.toLowerCase()] || null : null;
      const hasLocation = !!ext.location;
      const hasIncident = !!incidentId;

      // Detect language from LLM and save
      const detectedLang = ext.language === "fr" ? "fr-CA" : ext.language === "zh" ? "yue-Hant-HK" : sess?.language_code || "en-US";

      // Save extracted data + detected language
      await supabase.from("voice_call_sessions").update({
        incident_type_id: incidentId,
        location_text: ext.location,
        vehicle_info: [ext.vehicle_year, ext.vehicle_make, ext.vehicle_model].filter(Boolean).join(" ") || null,
        can_vehicle_roll: ext.can_roll,
        language_code: detectedLang,
      }).eq("call_sid", callSid);

      // If we have location + incident → create job immediately
      if (hasLocation && hasIncident) {
        const jobResp = await fetch(`${SUPABASE_URL}/functions/v1/intake-create-job`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: ext.name, phone: from, incidentTypeId: incidentId,
            pickupLocation: ext.location, vehicleMake: ext.vehicle_make,
            vehicleModel: ext.vehicle_model, vehicleYear: ext.vehicle_year,
            canVehicleRoll: ext.can_roll,
          }),
        });
        const jobResult = await jobResp.json();
        console.log(`[VOICE] Job: ${JSON.stringify(jobResult)}`);
        await supabase.from("voice_call_sessions").update({ ivr_step: 99, completed_at: new Date().toISOString(), job_id: jobResult.job_id }).eq("call_sid", callSid);

        const price = jobResult.suggested_price?.final_price;
        const callerLang = detectedLang;

        if (callerLang === "yue-Hant-HK") {
          const priceMsg = price ? `預計費用大約 ${price.toFixed(0)} 蚊。` : "";
          return xml(`<Say voice="${V}" language="zh-HK">多謝你！我已經收到你嘅資料。${priceMsg}我哋會盡快安排司機，並會發短信通知你。請注意安全！</Say><Hangup/>`);
        }
        if (callerLang === "fr-CA") {
          const priceMsg = price ? ` Le coût estimé est d'environ ${price.toFixed(2)} dollars.` : "";
          return xml(`<Say voice="${V}" language="fr-CA">Merci${ext.name ? ", " + esc(ext.name) : ""}! J'ai vos informations.${priceMsg} Un chauffeur sera assigné sous peu et vous recevrez un message texte. Soyez prudent!</Say><Hangup/>`);
        }
        // English
        const priceMsg = price ? ` The estimated cost is approximately $${price.toFixed(2)}.` : "";
        return xml(`<Say voice="${V}">Thank you${ext.name ? ", " + esc(ext.name) : ""}! I've got your details.${priceMsg} A driver will be assigned shortly and you'll receive a text message. Stay safe!</Say><Hangup/>`);
      }

      // Missing info → ask follow-up
      let followUp = "Thank you. I just need a bit more information. ";
      if (!hasLocation) followUp += "What is your exact location? Please give me a street address or intersection. ";
      if (!hasIncident) followUp += "What is the problem with your vehicle? ";
      if (!ext.vehicle_make) followUp += "What kind of vehicle do you have? ";

      return xml(
        `<Gather input="speech" timeout="10" speechTimeout="4" language="en-US">` +
        `<Say voice="${V}">${esc(followUp)}</Say>` +
        `</Gather>` +
        `<Say voice="${V}">No response. A dispatcher will text you. Goodbye.</Say><Hangup/>`
      );

    } catch (err) {
      console.error("[VOICE] Extraction error:", err);
      return xml(`<Say voice="${V}">Thank you. A dispatcher will contact you shortly by text. Goodbye.</Say><Hangup/>`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 1: Follow-up response
  // ═══════════════════════════════════════════════════════════
  if (step === 1 && speech) {
    console.log(`[VOICE] Follow-up: "${speech}"`);
    const { data: fullSess } = await supabase.from("voice_call_sessions").select("*").eq("call_sid", callSid).single();
    const combined = `${fullSess?.incident_description || ""}. ${speech}`;

    try {
      const llmResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001", max_tokens: 300,
          system: `Extract from caller speech. JSON only: {"name":null,"location":null,"incident":null,"vehicle_make":null,"vehicle_model":null,"vehicle_year":null,"can_roll":null}`,
          messages: [{ role: "user", content: combined }],
        }),
      });
      const data = await llmResp.json();
      const cleanJson = (data.content?.[0]?.text || "{}").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const ext = JSON.parse(cleanJson);

      const incMap: Record<string, string> = {
        "tow": "1d8d7d3b-c58b-4b2b-944e-b1c00ca8969f", "battery": "a4cdb184-d275-41a0-a2dc-cf17fe4ba5c9",
        "flat tire": "34c06174-258e-4bed-978f-cad26ee6c789", "lockout": "a53fc74d-2c2c-40dd-ad2f-8141137dda51",
        "fuel": "f2c9fc2d-d3a4-4aac-a607-9568de922a1d", "other": "252293cb-7340-4b47-8cf6-b2a7813f4309",
      };
      const incidentId = ext.incident ? incMap[ext.incident.toLowerCase()] || fullSess?.incident_type_id : fullSess?.incident_type_id;

      const jobResp = await fetch(`${SUPABASE_URL}/functions/v1/intake-create-job`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ext.name, phone: from || fullSess?.caller_phone,
          incidentTypeId: incidentId,
          pickupLocation: ext.location || fullSess?.location_text || "Location pending",
          vehicleMake: ext.vehicle_make, vehicleModel: ext.vehicle_model,
          vehicleYear: ext.vehicle_year, canVehicleRoll: ext.can_roll,
        }),
      });
      const jobResult = await jobResp.json();
      console.log(`[VOICE] Job: ${JSON.stringify(jobResult)}`);
      await supabase.from("voice_call_sessions").update({ ivr_step: 99, completed_at: new Date().toISOString() }).eq("call_sid", callSid);

      return xml(`<Say voice="${V}">Thank you! Your request has been submitted. A driver will be assigned and you'll get a text message. Stay safe!</Say><Hangup/>`);
    } catch (err) {
      console.error("[VOICE] Follow-up error:", err);
    }

    return xml(`<Say voice="${V}">Thank you. A dispatcher will text you shortly. Goodbye.</Say><Hangup/>`);
  }

  return xml(`<Say voice="${V}">Goodbye.</Say><Hangup/>`);
});
