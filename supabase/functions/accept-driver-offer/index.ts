import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePhone } from "../_shared/phone.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * SHARED ACCEPTANCE PATH — single source of truth for accepting a driver offer.
 *
 * Called by:
 *   1. twilio-webhook  (SMS YES reply, source="sms")
 *   2. driver-respond  (web link Accept button, source="web_link")
 *   3. client-side useAcceptDispatchOffer (dispatcher screen, source="dispatcher")
 *
 * Input:  { offerId: string, source: "sms" | "web_link" | "dispatcher" }
 * Output: { success: boolean, action: "accepted", jobId, driverId, pricingReady }
 *
 * State transitions on acceptance:
 *   dispatch_offers[offerId].offer_status       → "accepted"
 *   dispatch_offers[offerId].sms_delivery_status → "responded" (if sms source)
 *   dispatch_offers[same job, other].offer_status → "expired"
 *   drivers[driverId].last_sms_response_at       → now (if sms source)
 *   jobs.assigned_driver_id                       → driver_id
 *   jobs.assigned_truck_id                        → truck_id (from offer)
 *   jobs.job_status                               → "payment_authorization_required"
 *   jobs.reserved_driver_id                       → null
 *   jobs.reservation_expires_at                   → null
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { offerId, source } = await req.json();

    if (!offerId || !source) {
      return jsonResponse({ success: false, error: "offerId and source are required" }, 400);
    }

    const validSources = ["sms", "web_link", "dispatcher"];
    if (!validSources.includes(source)) {
      return jsonResponse({ success: false, error: `Invalid source. Use: ${validSources.join(", ")}` }, 400);
    }

    console.log(`[ACCEPT] Starting acceptance — offerId=${offerId} source=${source}`);

    // -----------------------------------------------------------------------
    // 1. Fetch and validate the offer
    // -----------------------------------------------------------------------
    const { data: offer, error: offerErr } = await supabase
      .from("dispatch_offers")
      .select("offer_id, job_id, driver_id, truck_id, offer_status, expires_at, token")
      .eq("offer_id", offerId)
      .single();

    if (offerErr || !offer) {
      console.log(`[ACCEPT] Offer not found — offerId=${offerId}`);
      return jsonResponse({ success: false, error: "Offer not found" }, 404);
    }

    console.log(`[ACCEPT] Offer found — status=${offer.offer_status} driver=${offer.driver_id} job=${offer.job_id}`);

    // Check offer is still pending
    if (offer.offer_status !== "pending") {
      console.log(`[ACCEPT] Offer not pending — status=${offer.offer_status}`);
      return jsonResponse({
        success: false,
        error: `Offer is no longer pending (status: ${offer.offer_status})`,
        status: offer.offer_status,
      }, 409);
    }

    // Check expiry
    if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
      console.log(`[ACCEPT] Offer expired — expires_at=${offer.expires_at}`);
      await supabase.from("dispatch_offers").update({ offer_status: "expired" }).eq("offer_id", offerId);
      return jsonResponse({
        success: false,
        error: "This offer has expired and is no longer active.",
        status: "expired",
      }, 410);
    }

    // -----------------------------------------------------------------------
    // 2. Fetch driver info for logging and SMS
    // -----------------------------------------------------------------------
    const { data: driver } = await supabase
      .from("drivers")
      .select("driver_name, company_name")
      .eq("driver_id", offer.driver_id)
      .single();
    const driverName = driver?.driver_name || "Unknown";
    const driverCompany = driver?.company_name || null;

    // -----------------------------------------------------------------------
    // 3. Fetch current job state for audit trail
    // -----------------------------------------------------------------------
    const { data: currentJob } = await supabase
      .from("jobs")
      .select("job_status, estimated_price, user_id, stripe_payment_intent_id")
      .eq("job_id", offer.job_id)
      .single();

    const oldStatus = currentJob?.job_status;
    const hasPricing = currentJob?.estimated_price && Number(currentJob.estimated_price) > 0;

    console.log(`[ACCEPT] Job state — oldStatus=${oldStatus} hasPricing=${hasPricing} userId=${currentJob?.user_id}`);

    // -----------------------------------------------------------------------
    // 4. Perform all state transitions
    // -----------------------------------------------------------------------

    // 4a. Accept this offer + mark sms status if SMS source
    const offerUpdate: Record<string, unknown> = { offer_status: "accepted" };
    if (source === "sms") {
      offerUpdate.sms_delivery_status = "responded";
    }
    const { error: offerUpdateErr } = await supabase
      .from("dispatch_offers")
      .update(offerUpdate)
      .eq("offer_id", offerId);
    if (offerUpdateErr) {
      console.error(`[ACCEPT] FAILED to mark offer accepted — offerId=${offerId} error=${offerUpdateErr.message}`);
      return jsonResponse({ success: false, error: `DB error updating offer: ${offerUpdateErr.message}` }, 500);
    }
    console.log(`[ACCEPT] Offer marked accepted — offerId=${offerId}`);

    // 4b. Expire all other pending offers for this job
    const { error: expireErr } = await supabase
      .from("dispatch_offers")
      .update({ offer_status: "expired" })
      .eq("job_id", offer.job_id)
      .neq("offer_id", offerId)
      .eq("offer_status", "pending");
    if (expireErr) {
      console.warn(`[ACCEPT] Non-fatal: could not expire sibling offers — job=${offer.job_id} error=${expireErr.message}`);
    }

    // 4c. Update driver response tracking (SMS source)
    if (source === "sms") {
      await supabase.from("drivers").update({
        last_sms_response_at: new Date().toISOString(),
      }).eq("driver_id", offer.driver_id);
    }

    // 4d. Assign driver to job.
    // New flow: Stripe payment was pre-authorized before dispatch (stripe_payment_intent_id present).
    //   → skip payment step, go directly to driver_enroute.
    // Old flow: no Stripe auth yet → go to payment_authorization_required.
    //
    // NOTE: Cannot use oldStatus === "ready_for_dispatch" because useAutoDispatchOffer sets
    // job_status to "driver_offer_sent" when creating the offer — before the driver accepts.
    // By the time this function runs, oldStatus is always "driver_offer_sent", never
    // "ready_for_dispatch". Using stripe_payment_intent_id is the reliable discriminator.
    const isNewFlow = !!(currentJob?.stripe_payment_intent_id);
    const newJobStatus = isNewFlow ? "driver_enroute" : "payment_authorization_required";
    const paymentDeadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error: jobUpdateErr } = await supabase.from("jobs").update({
      assigned_driver_id: offer.driver_id,
      assigned_truck_id: offer.truck_id,
      job_status: newJobStatus,
      reserved_driver_id: null,
      reservation_expires_at: null,
      step_deadline_at: isNewFlow ? null : paymentDeadline,
      exception_code: null,
      exception_message: null,
    }).eq("job_id", offer.job_id);
    if (jobUpdateErr) {
      console.error(`[ACCEPT] FAILED to update job — job=${offer.job_id} error=${jobUpdateErr.message} code=${jobUpdateErr.code}`);
      return jsonResponse({
        success: false,
        error: `DB error updating job: ${jobUpdateErr.message}`,
        jobId: offer.job_id,
        offerId,
      }, 500);
    }

    console.log(`[ACCEPT] State transitions complete — driver=${driverName} job=${offer.job_id} newStatus=${newJobStatus} isNewFlow=${isNewFlow}`);

    // -----------------------------------------------------------------------
    // 5. Create audit + event logs
    // -----------------------------------------------------------------------
    const sourceLabel = source === "sms" ? "via SMS" : source === "web_link" ? "via web link" : "via dispatcher";
    const acceptMessage = isNewFlow
      ? `Driver ${driverName} accepted job ${sourceLabel} — dispatched (price pre-authorized)`
      : `Driver ${driverName} accepted job ${sourceLabel} — awaiting payment authorization`;

    await Promise.all([
      supabase.from("audit_logs").insert({
        job_id: offer.job_id,
        action_type: `Driver ${driverName} accepted offer ${sourceLabel}`,
        event_type: "driver_assigned",
        event_source: source === "sms" ? "twilio_sms" : source === "web_link" ? "driver_sms" : "offer_screen",
        old_value: { job_status: oldStatus },
        new_value: { job_status: newJobStatus, assigned_driver_id: offer.driver_id },
      }),
      supabase.from("job_events").insert({
        job_id: offer.job_id,
        event_type: "driver_accepted",
        event_category: "dispatch",
        actor_type: source === "dispatcher" ? "dispatcher" : "driver",
        message: acceptMessage,
        new_value: {
          job_status: newJobStatus,
          assigned_driver_id: offer.driver_id,
          source,
          is_new_flow: isNewFlow,
        },
      }),
    ]);

    // -----------------------------------------------------------------------
    // 6. Send customer SMS — content depends on which flow we are in.
    //
    // NEW flow (ready_for_dispatch → driver_enroute):
    //   Price was already approved by customer. Send "driver confirmed + on the way" SMS.
    //
    // OLD flow (driver_offer_sent → payment_authorization_required):
    //   Price not yet approved. Send payment link SMS.
    // -----------------------------------------------------------------------
    let customerSmsStatus: "sent" | "no_pricing" | "invalid_phone" | "send_failed" | "no_credentials" | "skipped" = "skipped";
    let customerPhone: string | null = null;

    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    const hasSmsCreds = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);

    if (currentJob?.user_id) {
      const { data: user } = await supabase
        .from("users")
        .select("phone")
        .eq("user_id", currentJob.user_id)
        .single();

      const rawPhone = user?.phone ?? "";
      customerPhone = rawPhone || null;
      const phoneCheck = validatePhone(rawPhone);
      console.log(`[ACCEPT] Customer phone check — raw="${rawPhone}" e164="${phoneCheck.e164}" valid=${phoneCheck.valid} reason=${phoneCheck.reason ?? "ok"}`);

      if (!phoneCheck.valid) {
        const exMsg = `Customer phone "${rawPhone}" is invalid (${phoneCheck.reason}) — customer SMS blocked after driver acceptance`;
        console.error(`[ACCEPT] ${exMsg}`);
        customerSmsStatus = "invalid_phone";
        await Promise.all([
          supabase.from("jobs").update({ exception_code: "invalid_customer_phone", exception_message: exMsg }).eq("job_id", offer.job_id),
          supabase.from("job_events").insert({ job_id: offer.job_id, event_type: "customer_sms_blocked", event_category: "exception", message: exMsg, new_value: { raw_phone: rawPhone, reason: phoneCheck.reason } }),
        ]);
      } else if (!hasSmsCreds) {
        console.error("[ACCEPT] Customer SMS skipped — Twilio credentials not configured");
        customerSmsStatus = "no_credentials";
      } else if (isNewFlow) {
        // NEW flow: price already confirmed, driver is on the way
        const price = Number(currentJob.estimated_price);
        const driverLine = driverCompany ? `${driverName} (${driverCompany})` : driverName;
        const trackLink = `https://rin-beta.lovable.app/track/${offer.job_id}`;
        const smsBody =
          `RIN: Great news! Your driver ${driverLine} has been dispatched and is on the way.\n\n` +
          `Confirmed price: $${price.toFixed(2)}\n` +
          `Track your service: ${trackLink}\n\n` +
          `Reply CANCEL to cancel (if driver has not yet arrived).`;

        try {
          const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
          const smsResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ To: phoneCheck.e164, From: TWILIO_PHONE_NUMBER!, Body: smsBody }),
          });

          if (smsResp.ok) {
            const smsData = await smsResp.json();
            console.log(`[ACCEPT] Driver-confirmed SMS sent — to=${phoneCheck.e164} SID=${smsData.sid}`);
            customerSmsStatus = "sent";
            await supabase.from("job_events").insert({ job_id: offer.job_id, event_type: "driver_confirmed_sms_sent", event_category: "communication", message: `Driver confirmed SMS sent to ${phoneCheck.e164} — driver=${driverName} price=$${price.toFixed(2)} SID=${smsData.sid}` });
          } else {
            const errBody = await smsResp.text();
            console.error(`[ACCEPT] Driver-confirmed SMS failed — to=${phoneCheck.e164} status=${smsResp.status} body=${errBody.slice(0, 200)}`);
            customerSmsStatus = "send_failed";
            await supabase.from("job_events").insert({ job_id: offer.job_id, event_type: "driver_confirmed_sms_failed", event_category: "exception", message: `Driver confirmed SMS failed to ${phoneCheck.e164} [${smsResp.status}]` });
          }
        } catch (smsErr) {
          console.error(`[ACCEPT] Driver-confirmed SMS threw: ${smsErr}`);
          customerSmsStatus = "send_failed";
        }
      } else {
        // OLD flow: price not yet approved — send payment link
        if (!hasPricing) {
          console.log(`[ACCEPT] Pricing missing for job ${offer.job_id} — payment SMS withheld`);
          customerSmsStatus = "no_pricing";
          await supabase.from("jobs").update({ exception_code: "pricing_missing", exception_message: "Driver accepted but estimated_price is not set. Dispatcher must set price and send payment link." }).eq("job_id", offer.job_id);
          await supabase.from("job_events").insert({ job_id: offer.job_id, event_type: "pricing_missing_warning", event_category: "exception", message: `Driver ${driverName} accepted but estimated_price is missing. Payment SMS withheld.`, new_value: { exception_code: "pricing_missing" } });
        } else {
          const price = Number(currentJob.estimated_price);
          const payLink = `https://rin-beta.lovable.app/pay/${offer.job_id}`;
          const smsBody = `RIN: Your driver is confirmed. Estimated charge: $${price.toFixed(2)}. Please authorize payment: ${payLink}`;

          try {
            const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
            const smsResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
              method: "POST",
              headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ To: phoneCheck.e164, From: TWILIO_PHONE_NUMBER!, Body: smsBody }),
            });

            if (smsResp.ok) {
              const smsData = await smsResp.json();
              console.log(`[ACCEPT] Payment SMS sent — to=${phoneCheck.e164} SID=${smsData.sid}`);
              customerSmsStatus = "sent";
              await supabase.from("job_events").insert({ job_id: offer.job_id, event_type: "payment_sms_sent", event_category: "payment", message: `Payment SMS sent to ${phoneCheck.e164} ($${price.toFixed(2)}) — SID: ${smsData.sid}` });
            } else {
              const errBody = await smsResp.text();
              customerSmsStatus = "send_failed";
              await supabase.from("jobs").update({ exception_code: "payment_sms_failed", exception_message: `Dispatcher must resend payment link manually. Twilio error [${smsResp.status}].` }).eq("job_id", offer.job_id);
              await supabase.from("job_events").insert({ job_id: offer.job_id, event_type: "payment_sms_failed", event_category: "exception", message: `Payment SMS failed to ${phoneCheck.e164} [${smsResp.status}]: ${errBody.slice(0, 200)}` });
            }
          } catch (smsErr) {
            customerSmsStatus = "send_failed";
            await supabase.from("jobs").update({ exception_code: "payment_sms_failed", exception_message: "Unexpected error sending payment SMS." }).eq("job_id", offer.job_id);
          }
        }
      }
    }

    console.log(`[ACCEPT] Customer SMS status — job=${offer.job_id} status=${customerSmsStatus} isNewFlow=${isNewFlow}`);

    console.log(`[ACCEPT] Complete — offerId=${offerId} driver=${driverName} job=${offer.job_id} source=${source} newStatus=${newJobStatus} isNewFlow=${isNewFlow} customerSms=${customerSmsStatus}`);

    return jsonResponse({
      success: true,
      action: "accepted",
      jobId: offer.job_id,
      driverId: offer.driver_id,
      driverName,
      newJobStatus,
      isNewFlow,
      pricingReady: !!hasPricing,
      customerSmsStatus,
    });
  } catch (error: unknown) {
    console.error("[ACCEPT] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ success: false, error: msg }, 500);
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
