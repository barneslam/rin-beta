import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const body = (formData.get("Body") as string || "").trim().toUpperCase();
    const from = (formData.get("From") as string || "").trim();

    console.log(`Inbound SMS from ${from}: "${body}"`);

    if (!from) {
      return twimlResponse("We couldn't identify your phone number.");
    }

    // Look up driver by phone number
    const { data: driver } = await supabase
      .from("drivers")
      .select("driver_id, driver_name")
      .eq("phone", from)
      .single();

    if (!driver) {
      return twimlResponse("This number is not registered as a RIN driver.");
    }

    // Find the most recent pending, unexpired offer for this driver
    const { data: offers } = await supabase
      .from("dispatch_offers")
      .select("offer_id, job_id, token, expires_at")
      .eq("driver_id", driver.driver_id)
      .eq("offer_status", "pending")
      .order("created_at", { ascending: false })
      .limit(5);

    const validOffers = (offers || []).filter(
      (o) => !o.expires_at || new Date(o.expires_at).getTime() > Date.now()
    );

    if (validOffers.length === 0) {
      return twimlResponse("You have no pending offers at this time.");
    }

    if (validOffers.length > 1) {
      const link = `https://rin-beta.lovable.app/driver/offer/${validOffers[0].offer_id}?token=${validOffers[0].token}`;
      return twimlResponse(`You have multiple pending offers. Please use the link to respond: ${link}`);
    }

    const offer = validOffers[0];

    if (body === "YES" || body === "Y" || body === "ACCEPT") {
      // Accept offer
      await supabase.from("dispatch_offers").update({ offer_status: "accepted" }).eq("offer_id", offer.offer_id);
      await supabase.from("dispatch_offers").update({ offer_status: "expired" })
        .eq("job_id", offer.job_id).neq("offer_id", offer.offer_id).eq("offer_status", "pending");

      // Move job to payment_authorization_required (shared lifecycle for ALL jobs)
      await supabase.from("jobs").update({
        assigned_driver_id: driver.driver_id,
        job_status: "payment_authorization_required",
      }).eq("job_id", offer.job_id);

      await supabase.from("audit_logs").insert({
        job_id: offer.job_id,
        action_type: `Driver ${driver.driver_name} accepted via SMS — payment authorization required`,
        event_type: "driver_assigned",
        event_source: "twilio_sms",
      });
      await supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "driver_accepted",
        event_category: "dispatch",
        message: `Driver ${driver.driver_name} accepted job via SMS`,
      });

      // Send payment authorization SMS to customer
      try {
        const { data: job } = await supabase
          .from("jobs")
          .select("user_id")
          .eq("job_id", offer.job_id)
          .single();

        if (job?.user_id) {
          const { data: user } = await supabase
            .from("users")
            .select("phone")
            .eq("user_id", job.user_id)
            .single();

          if (user?.phone) {
            await sendCustomerPaymentSms(user.phone, offer.job_id);
          }
        }
      } catch (e) {
        console.error("Payment SMS to customer failed:", e);
      }

      return twimlResponse("You've accepted the job! Check the app for details.");
    }

    if (body === "NO" || body === "N" || body === "DECLINE") {
      await supabase.from("dispatch_offers").update({ offer_status: "declined" }).eq("offer_id", offer.offer_id);
      await supabase.from("audit_logs").insert({
        job_id: offer.job_id,
        action_type: `Driver ${driver.driver_name} declined via SMS`,
        event_type: "offer_responded",
        event_source: "twilio_sms",
      });
      await supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "offer_declined",
        event_category: "dispatch",
        message: `Driver ${driver.driver_name} declined job via SMS`,
      });

      return twimlResponse("You've declined the job offer.");
    }

    // Unrecognized reply
    const link = `https://rin-beta.lovable.app/driver/offer/${offer.offer_id}?token=${offer.token}`;
    return twimlResponse(`Reply YES to accept or NO to decline. Or use: ${link}`);
  } catch (error) {
    console.error("Twilio webhook error:", error);
    return twimlResponse("Something went wrong. Please try again or use the link in your original message.");
  }
});

// ---------------------------------------------------------------------------
// Send payment SMS to customer
// ---------------------------------------------------------------------------

async function sendCustomerPaymentSms(phone: string, jobId: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY not configured");
  const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER not configured");

  const body = `RIN: Your driver is confirmed and on the way! Please authorize payment to proceed: https://rin-beta.lovable.app/pay/${jobId}`;

  const resp = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: phone, From: TWILIO_PHONE_NUMBER, Body: body }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio SMS error [${resp.status}]: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// TwiML helpers
// ---------------------------------------------------------------------------

function twimlResponse(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
