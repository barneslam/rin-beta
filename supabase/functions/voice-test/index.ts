import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const V = "alice";

function resp(body: string): Response {
  return new Response(`<Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
}

function menu(msg: string): string {
  return `<Gather input="dtmf" numDigits="1" timeout="10"><Say voice="${V}">${msg}</Say></Gather><Say voice="${V}">No response. Goodbye.</Say><Hangup/>`;
}

function say(msg: string, lang = "", voice = V): string {
  return lang ? `<Say voice="${voice}" language="${lang}">${msg}</Say>` : `<Say voice="${voice}">${msg}</Say>`;
}

function menuLang(msg: string, lang: string, voice = V): string {
  return `<Gather input="dtmf" numDigits="1" timeout="10"><Say voice="${voice}" language="${lang}">${msg}</Say></Gather><Say voice="${voice}" language="${lang}">Goodbye.</Say><Hangup/>`;
}

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return resp(`<Say voice="${V}">Error. Goodbye.</Say><Hangup/>`);
  }

  const callSid = (formData.get("CallSid") as string) || "unknown";
  const from = (formData.get("From") as string) || "";
  const digits = (formData.get("Digits") as string) || "";

  // Load session from DB
  const { data: sess } = await supabase
    .from("voice_call_sessions")
    .select("*")
    .eq("call_sid", callSid)
    .maybeSingle();

  const step = sess?.ivr_step ?? -1;
  const lang = sess?.language_code || "en-US";
  const isFr = lang === "fr-CA";
  const isCn = lang === "yue-Hant-HK";

  // New call — create session
  if (!sess) {
    await supabase.from("voice_call_sessions").insert({ call_sid: callSid, caller_phone: from, ivr_step: -1, language_code: "en-US" });
  }

  // ══════════════════════════════════════════════════════════════
  // STEP -1: Language selection
  // ══════════════════════════════════════════════════════════════
  if (step === -1 && !digits) {
    return resp(
      `<Gather input="dtmf" numDigits="1" timeout="10">` +
      say("Bienvenue chez Way Lift. Pour le français, appuyez sur 1.", "fr-CA") +
      say("For English, press 2.", "") +
      say("廣東話，請按3。", "cmn-CN", "Polly.Zhiyu") +
      `</Gather>` +
      say("Goodbye.") + `<Hangup/>`
    );
  }

  if (step === -1 && digits) {
    const langMap: Record<string, string> = { "1": "fr-CA", "2": "en-US", "3": "yue-Hant-HK" };
    const chosen = langMap[digits] || "en-US";
    await supabase.from("voice_call_sessions").update({ ivr_step: 0, language_code: chosen }).eq("call_sid", callSid);

    // Show incident menu in chosen language
    if (chosen === "fr-CA") {
      return resp(menuLang("Appuyez sur 1 pour remorquage. 2 pour survoltage. 3 pour pneu crevé. 4 pour déverrouillage. 5 pour essence. 6 pour autre.", "fr-CA"));
    }
    if (chosen === "yue-Hant-HK") {
      return resp(menuLang("按1拖車。按2搭電。按3爆胎。按4開鎖。按5送油。按6其他。", "cmn-CN", "Polly.Zhiyu"));
    }
    return resp(menu("Welcome to Way Lift. Press 1 for tow. 2 for battery. 3 for flat tire. 4 for lockout. 5 for fuel. 6 for other."));
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 0: Incident type selected
  // ══════════════════════════════════════════════════════════════
  if (step === 0 && digits) {
    const incidents: Record<string, { id: string; en: string; fr: string; cn: string }> = {
      "1": { id: "1d8d7d3b-c58b-4b2b-944e-b1c00ca8969f", en: "Tow", fr: "remorquage", cn: "拖車" },
      "2": { id: "a4cdb184-d275-41a0-a2dc-cf17fe4ba5c9", en: "Battery Boost", fr: "survoltage", cn: "搭電" },
      "3": { id: "34c06174-258e-4bed-978f-cad26ee6c789", en: "Flat Tire", fr: "pneu crevé", cn: "爆胎" },
      "4": { id: "a53fc74d-2c2c-40dd-ad2f-8141137dda51", en: "Lockout", fr: "déverrouillage", cn: "開鎖" },
      "5": { id: "f2c9fc2d-d3a4-4aac-a607-9568de922a1d", en: "Fuel Delivery", fr: "essence", cn: "送油" },
      "6": { id: "252293cb-7340-4b47-8cf6-b2a7813f4309", en: "Other", fr: "autre", cn: "其他" },
    };
    const inc = incidents[digits];
    if (!inc) return resp(menu("Invalid. Press 1 through 6."));

    await supabase.from("voice_call_sessions").update({ ivr_step: 1, incident_type_id: inc.id, incident_name: inc.en }).eq("call_sid", callSid);

    if (isFr) return resp(menuLang(`Compris, ${inc.fr}. Êtes-vous sur une autoroute? 1 pour autoroute. 2 pour rue. 3 pour stationnement.`, "fr-CA"));
    if (isCn) return resp(menuLang(`收到，${inc.cn}。你喺邊度？按1高速公路。按2普通街道。按3停車場。`, "cmn-CN", "Polly.Zhiyu"));
    return resp(menu(`Got it, ${inc.en}. Press 1 for highway. 2 for city street. 3 for parking lot.`));
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 1: Location type selected
  // ══════════════════════════════════════════════════════════════
  if (step === 1 && digits) {
    const locs: Record<string, string> = { "1": "highway", "2": "city_street", "3": "parking_lot" };
    await supabase.from("voice_call_sessions").update({ ivr_step: 2, location_type: locs[digits] || "unknown" }).eq("call_sid", callSid);

    if (isFr) return resp(menuLang("Votre véhicule peut-il rouler? 1 pour oui. 2 pour non.", "fr-CA"));
    if (isCn) return resp(menuLang("你架車可唔可以行？按1可以。按2唔可以。", "cmn-CN", "Polly.Zhiyu"));
    return resp(menu("Can your vehicle roll? Press 1 for yes. 2 for no."));
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2: Can roll → create job
  // ══════════════════════════════════════════════════════════════
  if (step === 2 && digits) {
    const canRoll = digits === "1";

    const { data: fullSess } = await supabase.from("voice_call_sessions").select("*").eq("call_sid", callSid).single();
    await supabase.from("voice_call_sessions").update({ ivr_step: 3, can_vehicle_roll: canRoll, completed_at: new Date().toISOString() }).eq("call_sid", callSid);

    try {
      const jobResp = await fetch(`${SUPABASE_URL}/functions/v1/intake-create-job`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: from || fullSess?.caller_phone,
          incidentTypeId: fullSess?.incident_type_id,
          pickupLocation: `Caller on ${(fullSess?.location_type || "").replace("_", " ")} — exact address pending`,
          canVehicleRoll: canRoll,
          locationType: fullSess?.location_type,
        }),
      });
      const result = await jobResp.json();
      console.log(`[VOICE-IVR] Job: ${JSON.stringify(result)}`);

      if (result.success) {
        if (isFr) return resp(say("Merci! Votre demande a été soumise. Un chauffeur sera assigné sous peu. Soyez prudent!", "fr-CA") + "<Hangup/>");
        if (isCn) return resp(say("多謝！你嘅請求已經提交。我哋會盡快安排司機。保重！", "cmn-CN", "Polly.Zhiyu") + "<Hangup/>");
        return resp(say("Thank you! Your request has been submitted. A driver will be assigned shortly. Stay safe!") + "<Hangup/>");
      }
    } catch (err) {
      console.error("[VOICE-IVR] Error:", err);
    }

    if (isFr) return resp(say("Merci. Un répartiteur vous contactera sous peu. Au revoir.", "fr-CA") + "<Hangup/>");
    if (isCn) return resp(say("多謝你嘅來電。調度員會盡快聯繫你。再見。", "cmn-CN", "Polly.Zhiyu") + "<Hangup/>");
    return resp(say("Thank you. A dispatcher will contact you shortly. Goodbye.") + "<Hangup/>");
  }

  return resp(say("Goodbye.") + "<Hangup/>");
});
