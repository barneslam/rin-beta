import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Separate keyword sets
const DRIVER_ACCEPT_KEYWORDS = new Set(["YES", "Y", "ACCEPT"]);
const DRIVER_DECLINE_KEYWORDS = new Set(["NO", "N", "DECLINE"]);
const DRIVER_DONE_KEYWORDS = new Set(["DONE", "COMPLETE", "FINISH"]);
const DRIVER_CANCEL_AT_SCENE_KEYWORDS = new Set(["CANCEL"]);
// ADJUST <amount> — driver updates price on scene, parsed separately
const CUSTOMER_CONFIRM_KEYWORDS = new Set(["YES", "Y", "CONFIRM", "OK"]);
const CUSTOMER_APPROVE_KEYWORDS = new Set(["APPROVE"]);

/**
 * Normalize phone number for consistent matching.
 * Strips whitespace, dashes, parens. Ensures E.164-ish format.
 */
function normalizePhone(raw: string): string {
  let cleaned = raw.replace(/[\s\-\(\)\.]/g, "");
  // If it doesn't start with +, assume US/CA and prepend +1
  if (!cleaned.startsWith("+")) {
    if (cleaned.startsWith("1") && cleaned.length === 11) {
      cleaned = "+" + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = "+1" + cleaned;
    } else {
      cleaned = "+" + cleaned;
    }
  }
  return cleaned;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const formData = await req.formData();
    const rawBody = (formData.get("Body") as string || "").trim().toUpperCase();
    const rawFrom = (formData.get("From") as string || "").trim();
    const messageSid = (formData.get("MessageSid") as string || "").trim();

    const from = normalizePhone(rawFrom);

    // Structured entry log — one line per inbound SMS, all key fields present
    const log: Record<string, unknown> = {
      sid: messageSid,
      body: rawBody,
      raw_from: rawFrom,
      normalized_from: from,
      driver_lookup_phone_used: null as string | null,
      driver_lookup_result: "miss" as "hit_e164" | "hit_fallback" | "miss" | "ambiguous",
      customer_lookup_result: "miss" as "hit" | "miss",
      final_response_branch: null as string | null,
    };

    if (!from || from === "+") {
      log.final_response_branch = "invalid_phone";
      console.log("[WEBHOOK]", JSON.stringify(log));
      return twimlResponse("We couldn't identify your phone number.");
    }

    // -----------------------------------------------------------------------
    // 1. Check if sender is a DRIVER
    //    Primary: E.164 exact match. Fallback: last-10-digits match for phones
    //    that may have been stored without full normalization in the DB.
    // -----------------------------------------------------------------------
    log.driver_lookup_phone_used = from;

    let { data: driver } = await supabase
      .from("drivers")
      .select("driver_id, driver_name, phone")
      .eq("phone", from)
      .maybeSingle();

    if (driver) {
      log.driver_lookup_result = "hit_e164";
    } else {
      // Fallback: match on trailing 10 digits to tolerate minor format drift
      const digits10 = from.replace(/\D/g, "").slice(-10);
      const { data: fallbackRows } = await supabase
        .from("drivers")
        .select("driver_id, driver_name, phone")
        .ilike("phone", `%${digits10}`);
      if (fallbackRows && fallbackRows.length === 1) {
        driver = fallbackRows[0];
        log.driver_lookup_result = "hit_fallback";
        log.driver_lookup_phone_used = digits10;
      } else if (fallbackRows && fallbackRows.length > 1) {
        log.driver_lookup_result = "ambiguous";
      }
    }

    if (driver) {
      log.final_response_branch = "driver_reply";
      console.log("[WEBHOOK]", JSON.stringify(log));
      return await handleDriverReply(supabase, driver, rawBody, from, messageSid);
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
      log.customer_lookup_result = "hit";
      log.final_response_branch = "customer_reply";
      console.log("[WEBHOOK]", JSON.stringify(log));
      return await handleCustomerReply(supabase, customer, rawBody, from, messageSid);
    }

    log.final_response_branch = "unregistered";
    console.log("[WEBHOOK]", JSON.stringify(log));
    return twimlResponse("This number is not registered with RIN. Visit rin-beta.lovable.app to get help.");
  } catch (error) {
    console.error("[WEBHOOK] Unhandled error:", error);
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
  // -----------------------------------------------------------------------
  // DONE — job completion signal (must be in service_in_progress or driver_arrived)
  // -----------------------------------------------------------------------
  if (DRIVER_DONE_KEYWORDS.has(body)) {
    const { data: activeJob } = await supabase
      .from("jobs")
      .select("job_id, job_status")
      .eq("assigned_driver_id", driver.driver_id)
      .in("job_status", ["service_in_progress", "driver_arrived"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeJob) {
      return twimlResponse("No active job found to mark as complete.");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/complete-job`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: activeJob.job_id, driverId: driver.driver_id }),
      });
      const data = await resp.json();
      if (data.success) {
        return twimlResponse("Job marked complete. Payment is being processed and confirmations sent.");
      }
      console.error(`[WEBHOOK] complete-job failed — job=${activeJob.job_id} error=${data.error}`);
      return twimlResponse("Could not complete job. Please contact dispatch.");
    } catch (err) {
      console.error(`[WEBHOOK] complete-job threw — job=${activeJob.job_id} error=${err}`);
      return twimlResponse("Something went wrong. Please contact dispatch.");
    }
  }

  // -----------------------------------------------------------------------
  // CANCEL at scene — driver cannot do the job after arriving
  // -----------------------------------------------------------------------
  if (DRIVER_CANCEL_AT_SCENE_KEYWORDS.has(body)) {
    const { data: activeJob } = await supabase
      .from("jobs")
      .select("job_id, job_status")
      .eq("assigned_driver_id", driver.driver_id)
      .in("job_status", ["driver_enroute", "driver_arrived", "service_in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeJob) {
      return twimlResponse("No active job found to cancel. If declining an offer, reply NO instead.");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/driver-cancel-at-scene`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: activeJob.job_id, driverId: driver.driver_id, driverName: driver.driver_name }),
      });
      const data = await resp.json();
      if (data.success) {
        return twimlResponse("Cancellation received. Dispatch is finding a replacement driver. Thank you.");
      }
      console.error(`[WEBHOOK] driver-cancel-at-scene failed — job=${activeJob.job_id} error=${data.error}`);
      return twimlResponse("Could not process cancellation. Please contact dispatch.");
    } catch (err) {
      console.error(`[WEBHOOK] driver-cancel-at-scene threw — job=${activeJob.job_id} error=${err}`);
      return twimlResponse("Something went wrong. Please contact dispatch.");
    }
  }

  // -----------------------------------------------------------------------
  // ADJUST <amount> — driver updates price on scene
  // e.g. "ADJUST 150" or "ADJUST 150.00"
  // -----------------------------------------------------------------------
  if (body.startsWith("ADJUST")) {
    const parts = body.split(/\s+/);
    const rawAmount = parts[1];
    const parsedAmount = rawAmount ? Number(rawAmount.replace(/[^0-9.]/g, "")) : NaN;

    if (!rawAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return twimlResponse('To adjust the amount, reply: ADJUST <amount> (e.g. "ADJUST 150")');
    }

    const { data: activeJob } = await supabase
      .from("jobs")
      .select("job_id, job_status")
      .eq("assigned_driver_id", driver.driver_id)
      .in("job_status", ["driver_enroute", "driver_arrived", "service_in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeJob) {
      return twimlResponse("No active job found to adjust amount for.");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/driver-adjust-amount`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: activeJob.job_id, driverId: driver.driver_id, newAmount: parsedAmount }),
      });
      const data = await resp.json();
      if (data.success) {
        return twimlResponse(`Amount updated to $${parsedAmount.toFixed(2)}. Send DONE when the job is complete.`);
      }
      console.error(`[WEBHOOK] driver-adjust-amount failed — job=${activeJob.job_id} error=${data.error}`);
      return twimlResponse("Could not update amount. Please contact dispatch.");
    } catch (err) {
      console.error(`[WEBHOOK] driver-adjust-amount threw — job=${activeJob.job_id} error=${err}`);
      return twimlResponse("Something went wrong. Please contact dispatch.");
    }
  }

  // Find the most recent pending, unexpired offer for this driver
  const { data: offers } = await supabase
    .from("dispatch_offers")
    .select("offer_id, job_id, token, expires_at, offer_status")
    .eq("driver_id", driver.driver_id)
    .eq("offer_status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);

  const now = Date.now();
  const validOffers = (offers || []).filter(
    (o: any) => !o.expires_at || new Date(o.expires_at).getTime() > now
  );

  console.log(`[WEBHOOK] Driver ${driver.driver_name} — total_pending=${(offers||[]).length} valid_unexpired=${validOffers.length}`);

  if (validOffers.length === 0) {
    // Check if there are expired pending offers (user replied too late)
    const expiredPending = (offers || []).filter(
      (o: any) => o.expires_at && new Date(o.expires_at).getTime() <= now
    );
    if (expiredPending.length > 0) {
      console.log(`[WEBHOOK] Driver ${driver.driver_name} replied to expired offer — offer_id=${expiredPending[0].offer_id}`);

      // Mark expired offers as expired in DB
      for (const o of expiredPending) {
        await supabase.from("dispatch_offers").update({ offer_status: "expired" }).eq("offer_id", o.offer_id);
      }

      await supabase.from("job_events").insert({
        job_id: expiredPending[0].job_id,
        event_type: "sms_reply_after_expiry",
        event_category: "communication",
        message: `Driver ${driver.driver_name} replied "${body}" after offer expired (SID: ${messageSid})`,
      });

      return twimlResponse("This offer has expired and is no longer active. No action was taken.");
    }

    return twimlResponse("You have no pending offers at this time.");
  }

  if (validOffers.length > 1) {
    const link = `https://rin-beta.lovable.app/driver/offer/${validOffers[0].offer_id}?token=${validOffers[0].token}`;
    return twimlResponse(`You have multiple pending offers. Please use the link to respond: ${link}`);
  }

  const offer = validOffers[0];
  console.log(`[WEBHOOK] Matched offer — offer_id=${offer.offer_id} job_id=${offer.job_id}`);

  // -----------------------------------------------------------------------
  // ACCEPT via shared accept-driver-offer function
  // -----------------------------------------------------------------------
  if (DRIVER_ACCEPT_KEYWORDS.has(body)) {
    console.log(`[WEBHOOK] Driver ${driver.driver_name} accepting offer ${offer.offer_id} via SMS — job=${offer.job_id}`);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let acceptStatus = 500;
    let acceptData: Record<string, unknown> = {};
    try {
      const acceptResp = await fetch(`${SUPABASE_URL}/functions/v1/accept-driver-offer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ offerId: offer.offer_id, source: "sms" }),
      });
      acceptStatus = acceptResp.status;
      acceptData = await acceptResp.json();
    } catch (fetchErr) {
      console.error(`[WEBHOOK] accept-driver-offer fetch threw — offer=${offer.offer_id} error=${fetchErr}`);
      return twimlResponse("Something went wrong accepting the offer. Please use the link in your original message.");
    }

    console.log(`[WEBHOOK] accept-driver-offer response — status=${acceptStatus} body=${JSON.stringify(acceptData)}`);

    if (acceptData.success) {
      return twimlResponse("You've accepted the job! Check the app for details.");
    }

    // Handle specific failure cases
    if (acceptStatus === 410) {
      return twimlResponse("This offer has expired and is no longer active.");
    }
    if (acceptStatus === 409) {
      return twimlResponse(`This offer has already been ${acceptData.status || "responded to"}.`);
    }

    console.error(`[WEBHOOK] Acceptance failed — offer=${offer.offer_id} status=${acceptStatus} error=${acceptData.error}`);
    return twimlResponse("Something went wrong accepting the offer. Please use the link in your original message.");
  }

  // -----------------------------------------------------------------------
  // DECLINE
  // -----------------------------------------------------------------------
  if (DRIVER_DECLINE_KEYWORDS.has(body)) {
    console.log(`[WEBHOOK] Driver ${driver.driver_name} declining offer ${offer.offer_id} via SMS`);

    // Update driver tracking
    await supabase.from("drivers").update({
      last_sms_response_at: new Date().toISOString(),
    }).eq("driver_id", driver.driver_id);

    await supabase.from("dispatch_offers").update({
      offer_status: "declined",
      sms_delivery_status: "responded",
    }).eq("offer_id", offer.offer_id);

    await Promise.all([
      supabase.from("audit_logs").insert({
        job_id: offer.job_id,
        action_type: `Driver ${driver.driver_name} declined via SMS`,
        event_type: "offer_responded",
        event_source: "twilio_sms",
      }),
      supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "offer_declined",
        event_category: "dispatch",
        actor_type: "driver",
        message: `Driver ${driver.driver_name} declined job via SMS (SID: ${messageSid})`,
      }),
    ]);

    console.log(`[WEBHOOK] Decline complete — offer_id=${offer.offer_id}`);
    return twimlResponse("You've declined the job offer.");
  }

  // Unrecognized reply
  const link = `https://rin-beta.lovable.app/driver/offer/${offer.offer_id}?token=${offer.token}`;
  console.log(`[WEBHOOK] Unrecognized driver reply: "${body}"`);
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
  await supabase.from("users").update({
    last_sms_response_at: new Date().toISOString(),
  }).eq("user_id", customer.user_id);

  // Find job awaiting customer confirmation (details)
  const { data: confirmJobs } = await supabase
    .from("jobs")
    .select("job_id, job_status, sms_confirmed")
    .eq("user_id", customer.user_id)
    .eq("sms_confirmed", false)
    .in("job_status", ["pending_customer_confirmation"])
    .order("created_at", { ascending: false })
    .limit(1);

  const confirmJob = confirmJobs?.[0];

  // Find job awaiting price approval
  const { data: priceJobs } = await supabase
    .from("jobs")
    .select("job_id, job_status, estimated_price")
    .eq("user_id", customer.user_id)
    .eq("job_status", "pending_customer_price_approval")
    .order("created_at", { ascending: false })
    .limit(1);

  const priceJob = priceJobs?.[0];

  console.log(`[WEBHOOK] Customer ${customer.name} — body="${body}" confirmJob=${confirmJob?.job_id || "none"} priceJob=${priceJob?.job_id || "none"}`);

  // -----------------------------------------------------------------------
  // YES / CONFIRM — customer confirms job details
  // -----------------------------------------------------------------------
  if (CUSTOMER_CONFIRM_KEYWORDS.has(body)) {
    if (!confirmJob) {
      return twimlResponse("You have no pending requests to confirm.");
    }

    await supabase.from("jobs").update({
      job_status: "pending_pricing",
      sms_confirmed: true,
      sms_confirmed_at: new Date().toISOString(),
      confirmation_channel: "sms",
    }).eq("job_id", confirmJob.job_id);

    await supabase.from("job_events").insert({
      job_id: confirmJob.job_id,
      event_type: "customer_confirmed_sms",
      event_category: "communication",
      message: `Customer ${customer.name} confirmed request via SMS (SID: ${messageSid})`,
      new_value: { job_status: "pending_pricing" },
    });

    console.log(`[WEBHOOK] Customer confirmed job ${confirmJob.job_id} — transitioning to pending_pricing`);
    return twimlResponse("Confirmed! A dispatcher will review your request and send you a price estimate shortly.");
  }

  // -----------------------------------------------------------------------
  // APPROVE — customer approves estimated price
  // -----------------------------------------------------------------------
  if (CUSTOMER_APPROVE_KEYWORDS.has(body)) {
    if (!priceJob) {
      return twimlResponse("You have no pending price to approve.");
    }

    const payLink = `https://rin-beta.lovable.app/pay/${priceJob.job_id}`;
    const priceStr = priceJob.estimated_price ? `$${Number(priceJob.estimated_price).toFixed(2)}` : "the estimated amount";

    await supabase.from("job_events").insert({
      job_id: priceJob.job_id,
      event_type: "customer_approve_sms",
      event_category: "pricing",
      message: `Customer ${customer.name} replied APPROVE via SMS — payment link sent (SID: ${messageSid})`,
    });

    console.log(`[WEBHOOK] Customer approved price for job ${priceJob.job_id} — sending payment link`);
    return twimlResponse(`To complete your authorization of ${priceStr}, please visit: ${payLink}`);
  }

  // -----------------------------------------------------------------------
  // CANCEL — customer cancels request
  // -----------------------------------------------------------------------
  if (body === "CANCEL") {
    const cancelTarget = confirmJob || priceJob;
    if (!cancelTarget) {
      return twimlResponse("You have no active requests to cancel.");
    }

    await supabase.from("jobs").update({
      job_status: "cancelled_by_customer",
      cancelled_by: "customer_sms",
      cancelled_reason: "Customer cancelled via SMS",
    }).eq("job_id", cancelTarget.job_id);

    await supabase.from("job_events").insert({
      job_id: cancelTarget.job_id,
      event_type: "job_cancelled",
      event_category: "lifecycle",
      message: `Customer ${customer.name} cancelled via SMS (SID: ${messageSid})`,
    });

    return twimlResponse("Your request has been cancelled. No charges have been applied.");
  }

  if (confirmJob) {
    return twimlResponse("Reply YES to confirm your roadside assistance request, or CANCEL to cancel it.");
  }
  if (priceJob) {
    return twimlResponse(`Reply APPROVE to authorize the estimated price of $${Number(priceJob.estimated_price).toFixed(2)}, or CANCEL to cancel.`);
  }

  return twimlResponse("Thank you for reaching out to RIN. Visit rin-beta.lovable.app for help.");
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
