"use strict";

const { jsonResponse, handleOptions, supabaseAdmin } = require("./_shared");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const relevantEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.succeeded",
  "charge.refunded",
]);

const withNoStore = (resp) => {
  const out = resp || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"] = "no-cache";
  out.headers["Expires"] = "0";
  return out;
};

const send = (res, resp) => {
  const out = withNoStore(resp);
  if (out.headers) {
    Object.keys(out.headers).forEach((key) => res.setHeader(key, out.headers[key]));
  }
  return res.status(out.statusCode || 200).send(out.body);
};

const readRawBody = async (req) => {
  if (!req) return Buffer.from("", "utf8");
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "utf8");
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");

  if (req.body && typeof req.body === "object") {
    throw new Error("Raw body unavailable for Stripe verification");
  }

  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
};

const getFirst = (...vals) => vals.find((v) => v !== undefined && v !== null && String(v).trim() !== "") || "";
const nowIso = () => new Date().toISOString();

async function updateBySession(sb, session) {
  const { data: order, error } = await sb
    .from("orders")
    .select("id")
    .or(`stripe_session_id.eq.${session.id},checkout_session_id.eq.${session.id}`)
    .limit(1)
    .maybeSingle();

  if (error || !order?.id) return null;

  const update = {
    stripe_session_id: session.id,
    checkout_session_id: session.id,
    stripe_customer_id: session.customer || null,
    stripe_payment_intent_id: session.payment_intent || null,
    payment_status: session.payment_status || "unpaid",
    status: session.payment_status === "paid" ? "paid" : "pending_payment",
    updated_at: nowIso(),
  };

  if (session.payment_status === "paid") {
    update.paid_at = nowIso();
  }

  const { error: upErr } = await sb.from("orders").update(update).eq("id", order.id);
  if (upErr) throw upErr;

  return order.id;
}

async function updateByPaymentIntent(sb, paymentIntentId, status, extra = {}) {
  if (!paymentIntentId) return null;

  const { data: order, error } = await sb
    .from("orders")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();

  if (error || !order?.id) return null;

  const update = {
    status,
    updated_at: nowIso(),
    ...extra,
  };

  const { error: upErr } = await sb.from("orders").update(update).eq("id", order.id);
  if (upErr) throw upErr;

  return order.id;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || req.headers.Origin || "*";

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    }

    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      return send(res, jsonResponse(400, { ok: false, error: "Webhook secret not configured" }, origin));
    }

    const rawBody = await readRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (error) {
      console.error("[stripe_webhook] signature verification failed:", error?.message || error);
      return send(res, jsonResponse(400, { ok: false, error: `Webhook Error: ${error.message}` }, origin));
    }

    if (!relevantEvents.has(event.type)) {
      return send(res, jsonResponse(200, { ok: true, received: true, ignored: true, reason: "irrelevant_event" }, origin));
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return send(res, jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin));
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        await updateBySession(sb, session);
        if (session.payment_intent) {
          await updateByPaymentIntent(sb, session.payment_intent, session.payment_status === "paid" ? "paid" : "pending_payment", {
            payment_status: session.payment_status || "unpaid",
            paid_at: session.payment_status === "paid" ? nowIso() : null,
          });
        }
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        await updateBySession(sb, session);
        if (session.payment_intent) {
          await updateByPaymentIntent(sb, session.payment_intent, "paid", {
            payment_status: "paid",
            paid_at: nowIso(),
          });
        }
        break;
      }

      case "charge.succeeded": {
        const charge = event.data.object;
        await updateByPaymentIntent(sb, charge.payment_intent, "paid", {
          payment_status: "paid",
          paid_at: nowIso(),
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        await updateByPaymentIntent(sb, charge.payment_intent, "refunded", {
          payment_status: "refunded",
          refunded_at: nowIso(),
        });
        break;
      }
    }

    return send(res, jsonResponse(200, { ok: true, received: true }, origin));
  } catch (error) {
    console.error("[stripe_webhook] error:", error?.message || error);
    return send(res, jsonResponse(500, { ok: false, error: "stripe_webhook_failed" }, origin));
  }
};