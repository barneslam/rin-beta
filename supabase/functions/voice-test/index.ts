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
      `<Say voice="${V}">This is Way Lift Roadside Assistance.</Say>` +
      `<Gather input="dtmf" numDigits="1" timeout="8">` +
      `<Say voice="${V}">For English, press 1 or stay on the line.</Say>` +
      `<Say voice="${V}" language="fr-CA">Pour français, appuyez sur 2.</Say>` +
      `<Say voice="${V}" language="zh-HK">廣東話請按3。</Say>` +
      `</Gather>` +
      // No key pressed → default English
      `<Gather input="speech" timeout="12" speechTimeout="4" language="en-US">` +
      `<Say voice="${V}">How can I help you? Please tell me your name, location, and what happened.</Say>` +
      `</Gather>` +
      `<Say voice="${V}">I didn't hear anything. Goodbye.</Say><Hangup/>`
    );
  }

  // Language switch: pressed 1=English, 2=French, 3=Cantonese
  if (step === 0 && digits && !speech) {
    if (digits === "1") {
      await supabase.from("voice_call_sessions").update({ language_code: "en-US" }).eq("call_sid", callSid);
      return xml(
        `<Say voice="${V}">How can I help you? Please tell me your name, location, and what happened.</Say>` +
        `<Gather input="speech" timeout="12" speechTimeout="4" language="en-US"></Gather>` +
        `<Say voice="${V}">No response. Goodbye.</Say><Hangup/>`
      );
    }
    if (digits === "2") {
      await supabase.from("voice_call_sessions").update({ language_code: "fr-CA" }).eq("call_sid", callSid);
      return xml(
        `<Say voice="${V}" language="fr-CA">Comment puis-je vous aider? Dites-moi votre nom, votre emplacement et ce qui s'est passé.</Say>` +
        `<Gather input="speech" timeout="12" speechTimeout="4" language="fr-CA"></Gather>` +
        `<Say voice="${V}" language="fr-CA">Aucune réponse. Au revoir.</Say><Hangup/>`
      );
    }
    if (digits === "3") {
      await supabase.from("voice_call_sessions").update({ language_code: "yue-Hant-HK" }).eq("call_sid", callSid);
      return xml(
        `<Say voice="${V}" language="zh-HK">我點樣可以幫到你？請講你嘅名，你喺邊度，同埋你架車有咩問題。</Say>` +
        `<Gather input="speech" timeout="12" speechTimeout="4" language="yue-Hant-HK"></Gather>` +
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

      // If we have enough info → read back and ask for confirmation
      if (hasLocation && hasIncident) {
        // Save to step 2 (confirmation pending)
        await supabase.from("voice_call_sessions").update({ ivr_step: 2 }).eq("call_sid", callSid);

        const vehicle = [ext.vehicle_year, ext.vehicle_make, ext.vehicle_model].filter(Boolean).join(" ") || "";
        const callerLang = detectedLang;

        if (callerLang === "yue-Hant-HK") {
          const summary = `我收到嘅資料係：地點，${esc(ext.location)}。問題，${esc(ext.incident)}。${vehicle ? `車輛，${esc(vehicle)}。` : ""}`;
          return xml(
            `<Gather input="speech dtmf" numDigits="1" timeout="10" speechTimeout="3" language="yue-Hant-HK">` +
            `<Say voice="${V}" language="zh-HK">${summary} 係咪正確？按1確認，或者按2修改。</Say>` +
            `</Gather>` +
            `<Say voice="${V}" language="zh-HK">冇收到回應。再見。</Say><Hangup/>`
          );
        }
        if (callerLang === "fr-CA") {
          const summary = `Voici ce que j'ai noté: Emplacement, ${esc(ext.location)}. Problème, ${esc(ext.incident)}. ${vehicle ? `Véhicule, ${esc(vehicle)}.` : ""}`;
          return xml(
            `<Gather input="speech dtmf" numDigits="1" timeout="10" speechTimeout="3" language="fr-CA">` +
            `<Say voice="${V}" language="fr-CA">${summary} Est-ce correct? Appuyez sur 1 pour confirmer, ou 2 pour corriger.</Say>` +
            `</Gather>` +
            `<Say voice="${V}" language="fr-CA">Aucune réponse. Au revoir.</Say><Hangup/>`
          );
        }
        // English
        const summary = `Here's what I have: Location, ${esc(ext.location)}. Problem, ${esc(ext.incident)}. ${vehicle ? `Vehicle, ${esc(vehicle)}.` : ""}`;
        return xml(
          `<Gather input="speech dtmf" numDigits="1" timeout="10" speechTimeout="3" language="en-US">` +
          `<Say voice="${V}">${summary} Is this correct? Press 1 to confirm, or press 2 to make changes.</Say>` +
          `</Gather>` +
          `<Say voice="${V}">No response. Goodbye.</Say><Hangup/>`
        );
      }

      // Missing info → ask follow-up in the right language
      const callerLang = detectedLang;
      let followUp = "";
      if (callerLang === "yue-Hant-HK") {
        if (!hasLocation) followUp += "請問你而家喺邊度？請講地址或者附近嘅交叉路口。";
        if (!hasIncident) followUp += "你架車有咩問題？";
        if (!ext.vehicle_make) followUp += "你揸咩車？";
        return xml(
          `<Gather input="speech" timeout="10" speechTimeout="4" language="yue-Hant-HK">` +
          `<Say voice="${V}" language="zh-HK">多謝。我仲需要多啲資料。${followUp}</Say>` +
          `</Gather>` +
          `<Say voice="${V}" language="zh-HK">冇收到回應。再見。</Say><Hangup/>`
        );
      }
      if (callerLang === "fr-CA") {
        if (!hasLocation) followUp += "Quelle est votre adresse exacte ou l'intersection la plus proche? ";
        if (!hasIncident) followUp += "Quel est le problème avec votre véhicule? ";
        if (!ext.vehicle_make) followUp += "Quel type de véhicule avez-vous? ";
        return xml(
          `<Gather input="speech" timeout="10" speechTimeout="4" language="fr-CA">` +
          `<Say voice="${V}" language="fr-CA">Merci. J'ai besoin de plus d'informations. ${followUp}</Say>` +
          `</Gather>` +
          `<Say voice="${V}" language="fr-CA">Aucune réponse. Au revoir.</Say><Hangup/>`
        );
      }
      // English
      followUp = "Thank you. I just need a bit more information. ";
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

      const fLang = fullSess?.language_code || "en-US";
      if (fLang === "yue-Hant-HK") {
        const p = jobResult.suggested_price?.final_price;
        return xml(`<Say voice="${V}" language="zh-HK">多謝！你嘅請求已經提交。${p ? `預計費用大約${p.toFixed(0)}蚊。` : ""}我哋會盡快安排司機，並會發短信通知你。保重！</Say><Hangup/>`);
      }
      if (fLang === "fr-CA") {
        const p = jobResult.suggested_price?.final_price;
        return xml(`<Say voice="${V}" language="fr-CA">Merci! Votre demande a été soumise.${p ? ` Coût estimé: ${p.toFixed(2)} dollars.` : ""} Un chauffeur sera assigné sous peu. Soyez prudent!</Say><Hangup/>`);
      }
      const p = jobResult.suggested_price?.final_price;
      return xml(`<Say voice="${V}">Thank you! Your request has been submitted.${p ? ` Estimated cost is approximately $${p.toFixed(2)}.` : ""} A driver will be assigned and you'll get a text. Stay safe!</Say><Hangup/>`);
    } catch (err) {
      console.error("[VOICE] Follow-up error:", err);
    }

    const fLang = sess?.language_code || "en-US";
    if (fLang === "yue-Hant-HK") return xml(`<Say voice="${V}" language="zh-HK">多謝你嘅來電。調度員會盡快聯繫你。再見。</Say><Hangup/>`);
    if (fLang === "fr-CA") return xml(`<Say voice="${V}" language="fr-CA">Merci. Un répartiteur vous contactera sous peu. Au revoir.</Say><Hangup/>`);
    return xml(`<Say voice="${V}">Thank you. A dispatcher will text you shortly. Goodbye.</Say><Hangup/>`);
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 2: Confirmation — caller confirms or wants changes
  // ═══════════════════════════════════════════════════════════
  if (step === 2 && (digits || speech)) {
    const confirmed = digits === "1" || /yes|correct|confirm|oui|係|啱/i.test(speech);
    const callerLang = sess?.language_code || "en-US";

    if (!confirmed) {
      // Caller wants changes — ask again
      if (callerLang === "yue-Hant-HK") {
        return xml(
          `<Gather input="speech" timeout="10" speechTimeout="4" language="yue-Hant-HK">` +
          `<Say voice="${V}" language="zh-HK">好，請重新講一次你嘅位置同埋問題。</Say>` +
          `</Gather><Say voice="${V}" language="zh-HK">冇回應。再見。</Say><Hangup/>`
        );
      }
      if (callerLang === "fr-CA") {
        return xml(
          `<Gather input="speech" timeout="10" speechTimeout="4" language="fr-CA">` +
          `<Say voice="${V}" language="fr-CA">D'accord, veuillez me redonner votre emplacement et le problème.</Say>` +
          `</Gather><Say voice="${V}" language="fr-CA">Aucune réponse. Au revoir.</Say><Hangup/>`
        );
      }
      return xml(
        `<Gather input="speech" timeout="10" speechTimeout="4" language="en-US">` +
        `<Say voice="${V}">Okay, please tell me again your location and what happened.</Say>` +
        `</Gather><Say voice="${V}">No response. Goodbye.</Say><Hangup/>`
      );
    }

    // Confirmed — create the job
    const { data: fullSess } = await supabase.from("voice_call_sessions").select("*").eq("call_sid", callSid).single();

    const jobResp = await fetch(`${SUPABASE_URL}/functions/v1/intake-create-job`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fullSess?.incident_description?.match(/name[:\s]+(\w+)/i)?.[1] || null,
        phone: from || fullSess?.caller_phone,
        incidentTypeId: fullSess?.incident_type_id,
        pickupLocation: fullSess?.location_text || "Location pending",
        canVehicleRoll: fullSess?.can_vehicle_roll,
      }),
    });
    const jobResult = await jobResp.json();
    console.log(`[VOICE] Confirmed job: ${JSON.stringify(jobResult)}`);
    await supabase.from("voice_call_sessions").update({ ivr_step: 99, completed_at: new Date().toISOString(), job_id: jobResult.job_id }).eq("call_sid", callSid);

    const price = jobResult.suggested_price?.final_price;

    if (callerLang === "yue-Hant-HK") {
      const priceMsg = price ? `預計費用大約 ${price.toFixed(0)} 蚊。` : "";
      return xml(`<Say voice="${V}" language="zh-HK">多謝確認！${priceMsg}我哋會盡快安排司機，並會發短信通知你。請注意安全！</Say><Hangup/>`);
    }
    if (callerLang === "fr-CA") {
      const priceMsg = price ? ` Le coût estimé est d'environ ${price.toFixed(2)} dollars.` : "";
      return xml(`<Say voice="${V}" language="fr-CA">Merci pour la confirmation!${priceMsg} Un chauffeur sera assigné sous peu. Soyez prudent!</Say><Hangup/>`);
    }
    const priceMsg = price ? ` The estimated cost is approximately $${price.toFixed(2)}.` : "";
    return xml(`<Say voice="${V}">Confirmed!${priceMsg} A driver will be assigned shortly and you'll receive a text message. Stay safe!</Say><Hangup/>`);
  }

  return xml(`<Say voice="${V}">Goodbye.</Say><Hangup/>`);
});
