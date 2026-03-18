import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

// Separate keyword sets per user's refinement
const DRIVER_ACCEPT_KEYWORDS = new Set(["YES", "Y", "ACCEPT"]);
const DRIVER_DECLINE_KEYWORDS = new Set(["NO", "N", "DECLINE"]);
const CUSTOMER_CONFIRM_KEYWORDS = new Set(["YES", "Y", "CONFIRM", "OK"]);

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
    const messageSid = (formData.get("MessageSid") as string || "").trim();

    console.log(`[WEBHOOK] Inbound SMS from=${from} body="${body}" sid=${messageSid}`);

    if (!from) {
      return twimlResponse("We couldn't identify your phone number.");
    }

    // -----------------------------------------------------------------------
    // 1. Check if sender is a DRIVER
    // -----------------------------------------------------------------------
    const { data: driver } = await supabase
      .from("drivers")
      .select("driver_id, driver_name")
      .eq("phone", from)
      .single();

    if (driver) {
      return await handleDriverReply(supabase, driver, body, from, messageSid);
    }

    // -----------------------------------------------------------------------
    // 2. Check if sender is a CUSTOMER
    // -----------------------------------------------------------------------
    const { data: customer } = await supabase
      .from("users")
      .select("user_id, name")
      .eq("phone", from)
      .single();

    if (customer) {
      return await handleCustomerReply(supabase, customer, body, from, messageSid);
    }

    // Unknown number
    return twimlResponse("This number is not registered with RIN. Visit rin-beta.lovable.app to get help.");
  } catch (error) {
    console.error("Twilio webhook error:", error);
    return twimlResponse("Something went wrong. Please try again or use the link in your original message.");
  }
});

// ---------------------------------------------------------------------------
// DRIVER reply handler
// ---------------------------------------------------------------------------

async function handleDriverReply(
  supabase: any,
  driver: { driver_id: string; driver_name: string },
  body: string,
  from: string,
  messageSid: string,
) {
  // Update driver response tracking
  await supabase.from("drivers").update({
    last_sms_response_at: new Date().toISOString(),
  }).eq("driver_id", driver.driver_id);

  // Find the most recent pending, unexpired offer for this driver
  const { data: offers } = await supabase
    .from("dispatch_offers")
    .select("offer_id, job_id, token, expires_at")
    .eq("driver_id", driver.driver_id)
    .eq("offer_status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);

  const validOffers = (offers || []).filter(
    (o: any) => !o.expires_at || new Date(o.expires_at).getTime() > Date.now()
  );

  if (validOffers.length === 0) {
    return twimlResponse("You have no pending offers at this time.");
  }

  if (validOffers.length > 1) {
    const link = `https://rin-beta.lovable.app/driver/offer/${validOffers[0].offer_id}?token=${validOffers[0].token}`;
    return twimlResponse(`You have multiple pending offers. Please use the link to respond: ${link}`);
  }

  const offer = validOffers[0];

  console.log(`[WEBHOOK] Driver ${driver.driver_name} responded "${body}" for offer ${offer.offer_id} (inbound SID: ${messageSid})`);

  // Update offer-level tracking
  await supabase.from("dispatch_offers").update({
    sms_delivery_status: "responded",
  }).eq("offer_id", offer.offer_id);

  if (DRIVER_ACCEPT_KEYWORDS.has(body)) {
    // Check pricing availability (don't block acceptance, but gate payment SMS)
    const { data: jobCheck } = await supabase
      .from("jobs")
      .select("estimated_price, user_id")
      .eq("job_id", offer.job_id)
      .single();

    const hasPricing = jobCheck?.estimated_price && Number(jobCheck.estimated_price) > 0;

    // Accept offer
    await supabase.from("dispatch_offers").update({ offer_status: "accepted" }).eq("offer_id", offer.offer_id);
    await supabase.from("dispatch_offers").update({ offer_status: "expired" })
      .eq("job_id", offer.job_id).neq("offer_id", offer.offer_id).eq("offer_status", "pending");

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
      message: `Driver ${driver.driver_name} accepted job via SMS (inbound SID: ${messageSid})`,
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
          await sendCustomerPaymentSms(supabase, user.phone, offer.job_id);
        }
      }
    } catch (e) {
      console.error("Payment SMS to customer failed:", e);
    }

    return twimlResponse("You've accepted the job! Check the app for details.");
  }

  if (DRIVER_DECLINE_KEYWORDS.has(body)) {
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
      message: `Driver ${driver.driver_name} declined job via SMS (inbound SID: ${messageSid})`,
    });

    return twimlResponse("You've declined the job offer.");
  }

  // Unrecognized reply
  const link = `https://rin-beta.lovable.app/driver/offer/${offer.offer_id}?token=${offer.token}`;
  return twimlResponse(`Reply YES to accept or NO to decline. Or use: ${link}`);
}

// ---------------------------------------------------------------------------
// CUSTOMER reply handler
// ---------------------------------------------------------------------------

async function handleCustomerReply(
  supabase: any,
  customer: { user_id: string; name: string },
  body: string,
  from: string,
  messageSid: string,
) {
  // Update customer response tracking
  await supabase.from("users").update({
    last_sms_response_at: new Date().toISOString(),
  }).eq("user_id", customer.user_id);

  // Find the most recent unconfirmed job for this customer
  const { data: jobs } = await supabase
    .from("jobs")
    .select("job_id, job_status, sms_confirmed")
    .eq("user_id", customer.user_id)
    .eq("sms_confirmed", false)
    .in("job_status", ["intake_started", "intake_completed"])
    .order("created_at", { ascending: false })
    .limit(1);

  const job = jobs?.[0];

  console.log(`[WEBHOOK] Customer ${customer.name} responded "${body}" for job ${job?.job_id || "none"} (inbound SID: ${messageSid})`);

  if (CUSTOMER_CONFIRM_KEYWORDS.has(body)) {
    if (!job) {
      return twimlResponse("You have no pending requests to confirm.");
    }

    // Confirm the specific job
    await supabase.from("jobs").update({
      sms_confirmed: true,
      sms_confirmed_at: new Date().toISOString(),
      confirmation_channel: "sms",
    }).eq("job_id", job.job_id);

    await supabase.from("job_events").insert({
      job_id: job.job_id,
      event_type: "customer_confirmed_sms",
      event_category: "communication",
      message: `Customer ${customer.name} confirmed request via SMS reply (inbound SID: ${messageSid})`,
    });

    console.log(`[WEBHOOK] Customer ${customer.name} confirmed job ${job.job_id} via SMS`);
    return twimlResponse("Confirmed! We're finding you a driver now.");
  }

  if (body === "CANCEL") {
    if (!job) {
      return twimlResponse("You have no pending requests to cancel.");
    }

    await supabase.from("jobs").update({
      job_status: "cancelled_by_customer",
      cancelled_by: "customer_sms",
      cancelled_reason: "Customer cancelled via SMS",
    }).eq("job_id", job.job_id);

    await supabase.from("job_events").insert({
      job_id: job.job_id,
      event_type: "job_cancelled",
      event_category: "lifecycle",
      message: `Customer ${customer.name} cancelled via SMS reply (inbound SID: ${messageSid})`,
    });

    return twimlResponse("Your request has been cancelled.");
  }

  // Unrecognized reply from customer
  if (job) {
    return twimlResponse("Reply YES to confirm your roadside assistance request, or CANCEL to cancel it.");
  }

  return twimlResponse("Thank you for reaching out to RIN. Visit rin-beta.lovable.app for help.");
}

// ---------------------------------------------------------------------------
// Send payment SMS to customer
// ---------------------------------------------------------------------------

async function sendCustomerPaymentSms(supabase: any, phone: string, jobId: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY not configured");
  const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER not configured");

  const smsBody = `RIN: Your driver is confirmed and on the way! Please authorize payment to proceed: https://rin-beta.lovable.app/pay/${jobId}`;

  const resp = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: phone, From: TWILIO_PHONE_NUMBER, Body: smsBody }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Twilio SMS error [${resp.status}]: ${JSON.stringify(data)}`);
  }

  console.log(`[SMS] Payment SMS to customer ${phone} job=${jobId} SID=${data.sid}`);

  // Log SID in job_events
  await supabase.from("job_events").insert({
    job_id: jobId,
    event_type: "payment_sms_sent",
    event_category: "communication",
    message: `Payment authorization SMS sent to ${phone} (Twilio SID: ${data.sid})`,
  });
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
