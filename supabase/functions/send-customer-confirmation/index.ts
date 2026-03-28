import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePhone } from "../_shared/phone.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY is not configured");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { phone, jobId, userName, channel } = await req.json();
    if (!phone || !jobId) {
      return new Response(JSON.stringify({ error: "Missing phone or jobId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate phone — rejects non-E.164 AND fake/555 numbers
    const phoneCheck = validatePhone(phone);
    console.log(`[CONFIRM-SMS] Phone check — raw="${phone}" e164="${phoneCheck.e164}" valid=${phoneCheck.valid} reason=${phoneCheck.reason ?? "ok"} jobId=${jobId}`);

    if (!phoneCheck.valid) {
      const exMsg = `Customer phone "${phone}" is invalid (${phoneCheck.reason}) — confirmation SMS blocked`;
      console.error(`[CONFIRM-SMS] EXCEPTION: ${exMsg}`);

      await Promise.all([
        supabase.from("jobs").update({
          exception_code: "invalid_customer_phone",
          exception_message: exMsg,
        }).eq("job_id", jobId),
        supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "confirmation_sms_blocked",
          event_category: "exception",
          message: exMsg,
          new_value: { exception_code: "invalid_customer_phone", raw_phone: phone, reason: phoneCheck.reason },
        }),
      ]);

      return new Response(JSON.stringify({ success: false, error: exMsg, exception_code: "invalid_customer_phone" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the normalized E.164 form for all downstream calls
    const normalizedPhone = phoneCheck.e164;

    // Voice calls are auto-confirmed — no SMS needed
    if (channel === "voice") {
      await supabase.from("jobs").update({
        sms_confirmed: true,
        sms_confirmed_at: new Date().toISOString(),
        confirmation_channel: "voice",
      }).eq("job_id", jobId);

      console.log(`[CONFIRM-SMS] Voice auto-confirm for job=${jobId} — no SMS sent`);

      return new Response(JSON.stringify({ success: true, autoConfirmed: true, channel: "voice" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chat uses lighter path — send SMS but also provide web confirm link
    const trackLink = `https://rin-beta.lovable.app/track/${jobId}`;
    const isChat = channel === "chat";

    const smsBody = isChat
      ? `RIN: Your roadside request is confirmed. Track progress here: ${trackLink}\n\nIf you did not request this, reply CANCEL.`
      : `RIN: Reply YES to confirm your roadside assistance request for ${userName || "your vehicle"}.\n\nOr confirm here: ${trackLink}`;

    const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: normalizedPhone,
        From: TWILIO_PHONE_NUMBER,
        Body: smsBody,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const exMsg = `Confirmation SMS to ${normalizedPhone} failed — Twilio [${response.status}]: ${JSON.stringify(data)}`;
      console.error(`[CONFIRM-SMS] EXCEPTION: ${exMsg} — jobId=${jobId}`);

      await Promise.all([
        supabase.from("jobs").update({
          exception_code: "confirmation_sms_failed",
          exception_message: `Confirmation SMS failed [${response.status}] — customer may not be aware of their request`,
        }).eq("job_id", jobId),
        supabase.from("job_events").insert({
          job_id: jobId,
          event_type: "confirmation_sms_failed",
          event_category: "exception",
          message: exMsg,
          new_value: { exception_code: "confirmation_sms_failed", to: normalizedPhone, twilio_status: response.status },
        }),
      ]);

      return new Response(JSON.stringify({ success: false, error: exMsg, exception_code: "confirmation_sms_failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update user tracking
    const { data: job } = await supabase.from("jobs").select("user_id").eq("job_id", jobId).single();
    if (job?.user_id) {
      await supabase.from("users").update({
        last_sms_sent_at: new Date().toISOString(),
      }).eq("user_id", job.user_id);
    }

    // For chat channel, auto-confirm the job (lighter path — SMS is informational)
    if (isChat) {
      await supabase.from("jobs").update({
        sms_confirmed: true,
        sms_confirmed_at: new Date().toISOString(),
        confirmation_channel: "chat",
      }).eq("job_id", jobId);
    }

    // Log event with Twilio SID
    await supabase.from("job_events").insert({
      job_id: jobId,
      event_type: "confirmation_sms_sent",
      event_category: "communication",
      message: `Confirmation SMS sent to ${normalizedPhone} (channel: ${channel || "form"}) — SID: ${data.sid}`,
    });

    console.log(`[CONFIRM-SMS] Sent — customer=${normalizedPhone} job=${jobId} channel=${channel || "form"} SID=${data.sid}`);

    return new Response(JSON.stringify({
      success: true,
      sid: data.sid,
      autoConfirmed: isChat,
      channel: channel || "form",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending confirmation SMS:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
