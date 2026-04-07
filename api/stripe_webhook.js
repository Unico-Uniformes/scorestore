// api/stripe_webhook.js
"use strict";

const crypto = require("crypto");
const Stripe = require("stripe");
const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
  resolveScoreOrgId,
  sendTelegram,
} = require("../lib/_shared");

function send(res, payload) {
  const out = payload || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"] = "no-cache";
  out.headers["Expires"] = "0";

  res.statusCode = out.statusCode || 200;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body || "");
}

function getOrigin(req) {
  return req?.headers?.origin || req?.headers?.Origin || "*";
}

function getRawBody(req) {
  if (Buffer.isBuffer(req?.body)) return req.body;
  if (typeof req?.body === "string") return Buffer.from(req.body, "utf8");
  if (req?.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
  return Buffer.from("");
}

function signatureOrNull(req) {
  const h = req?.headers || {};
  return h["stripe-signature"] || h["Stripe-Signature"] || "";
}

async function findOrderBySessionId(sb, sessionId) {
  const ids = Array.from(new Set([sessionId].filter(Boolean)));
  if (!ids.length) return null;

  for (const id of ids) {
    const { data } = await sb
      .from("orders")
      .select("*")
      .or(`checkout_session_id.eq.${id},stripe_session_id.eq.${id}`)
      .limit(1)
      .maybeSingle();

    if (data) return data;
  }

  return null;
}

async function upsertShipmentAndAudit(sb, orgId, orderId, sessionId, raw) {
  const now = new Date().toISOString();
  await sb.from("shipping_webhooks").upsert(
    {
      org_id: orgId,
      organization_id: orgId,
      order_id: orderId || null,
      stripe_session_id: sessionId || null,
      provider: "stripe",
      status: "received",
      raw: raw || {},
      updated_at: now,
      created_at: now,
    },
    { onConflict: "stripe_session_id" }
  );
}

module.exports = async (req, res) => {
  const origin = getOrigin(req);

  if (req.method === "OPTIONS") {
    return send(res, handleOptions({ headers: req.headers }));
  }

  if (req.method !== "POST") {
    return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
  }

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY || "";
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SIGNING_SECRET || "";
    if (!stripeKey || !webhookSecret) {
      return send(res, jsonResponse(500, { ok: false, error: "stripe_not_configured" }, origin));
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
    const sig = signatureOrNull(req);
    const rawBody = getRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (error) {
      return send(res, jsonResponse(400, { ok: false, error: "invalid_signature" }, origin));
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return send(res, jsonResponse(500, { ok: false, error: "supabase_not_configured" }, origin));
    }

    const orgId = await resolveScoreOrgId(sb);
    const nowIso = () => new Date().toISOString();
    const eventId = safeStr(event?.id || crypto.randomUUID());

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const sessionId = safeStr(session?.id || "");
        const order = await findOrderBySessionId(sb, sessionId);
        const status = session?.payment_status === "paid" ? "paid" : "completed";

        if (order) {
          await sb.from("orders").update({
            status,
            payment_status: session?.payment_status || "paid",
            stripe_session_id: sessionId,
            updated_at: nowIso(),
          }).or(`checkout_session_id.eq.${sessionId},stripe_session_id.eq.${sessionId}`);
        }

        await upsertShipmentAndAudit(sb, orgId, order?.id || null, sessionId, event);

        await sendTelegram(`✅ Pago confirmado: ${sessionId}`);
        break;
      }

      default:
        break;
    }

    return send(res, jsonResponse(200, { ok: true, received: true }, origin));
  } catch (error) {
    console.error("[stripe_webhook] error:", error?.message || error);
    return send(res, jsonResponse(500, { ok: false, error: "stripe_webhook_failed" }, origin));
  }
};