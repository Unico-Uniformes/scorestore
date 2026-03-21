"use strict";

const { jsonResponse, handleOptions, supabaseAdmin } = require("./_shared");

const safeStr = (v, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function getSecretFromHeaders(headers) {
  return (
    headers["x-envia-token"] ||
    headers["X-Envia-Token"] ||
    headers["x-webhook-secret"] ||
    headers["X-Webhook-Secret"] ||
    ""
  );
}

function normalizeTracking(payload) {
  return (
    safeStr(payload?.tracking_number) ||
    safeStr(payload?.trackingNumber) ||
    safeStr(payload?.tracking) ||
    safeStr(payload?.guideNumber) ||
    safeStr(payload?.shipment_number) ||
    ""
  ).trim();
}

function normalizeCarrier(payload) {
  return (
    safeStr(payload?.carrier) ||
    safeStr(payload?.carrier_name) ||
    safeStr(payload?.carrierName) ||
    safeStr(payload?.provider) ||
    ""
  ).trim();
}

function normalizeStatus(payload) {
  return (
    safeStr(payload?.status) ||
    safeStr(payload?.shipment_status) ||
    safeStr(payload?.shipping_status) ||
    safeStr(payload?.event) ||
    ""
  ).trim();
}

function bucketStatus(raw) {
  const s = safeStr(raw).toLowerCase();

  if (!s) return "unknown";
  if (["delivered", "entregado"].includes(s)) return "delivered";
  if (
    [
      "in_transit",
      "transit",
      "shipped",
      "picked_up",
      "out_for_delivery",
      "label_created",
      "guia_generada",
      "en_transito",
    ].includes(s)
  ) return "in_transit";
  if (["returned", "failed", "exception", "cancelled", "canceled", "error"].includes(s)) return "issue";
  return "other";
}

function normalizeCost(payload) {
  return (
    safeNum(payload?.envia_cost_mxn, NaN) ||
    safeNum(payload?.shipping_cost_mxn, NaN) ||
    safeNum(payload?.cost_mxn, NaN) ||
    safeNum(payload?.amount_mxn, NaN) ||
    NaN
  );
}

function normalizeSessionId(payload) {
  return (
    safeStr(payload?.stripe_session_id) ||
    safeStr(payload?.session_id) ||
    safeStr(payload?.checkout_session_id) ||
    ""
  ).trim();
}

function normalizePaymentIntentId(payload) {
  return (
    safeStr(payload?.stripe_payment_intent_id) ||
    safeStr(payload?.payment_intent_id) ||
    ""
  ).trim();
}

function normalizeOrderId(payload) {
  return (
    safeStr(payload?.order_id) ||
    safeStr(payload?.id_order) ||
    ""
  ).trim();
}

module.exports = async (req, res) => {
    const origin = req.headers.origin || "*";

    const sendVercelResponse = (response) => {
        Object.keys(response.headers || {}).forEach(key => {
            res.setHeader(key, response.headers[key]);
        });
        res.status(response.statusCode).send(response.body);
    };

  try {
    if (req.method === "OPTIONS") {
        sendVercelResponse(handleOptions({headers: req.headers}));
        return;
    }
    if (req.method !== "POST") {
        sendVercelResponse(jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
        return;
    }

    const expectedSecret = safeStr(process.env.ENVIA_WEBHOOK_SECRET || "");
    const receivedSecret = safeStr(getSecretFromHeaders(req.headers || {}));

    if (expectedSecret && receivedSecret !== expectedSecret) {
        sendVercelResponse(jsonResponse(403, { ok: false, error: "Forbidden" }, origin));
        return;
    }

    const payload = req.body || {};

    const sb = supabaseAdmin();
    if (!sb) {
        sendVercelResponse(jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin));
        return;
    }

    const trackingNumber = normalizeTracking(payload);
    const carrier = normalizeCarrier(payload);
    const rawStatus = normalizeStatus(payload);
    const shipmentBucket = bucketStatus(rawStatus);
    const enviaCostMaybe = normalizeCost(payload);

    const stripeSessionId = normalizeSessionId(payload);
    const paymentIntentId = normalizePaymentIntentId(payload);
    const orderId = normalizeOrderId(payload);

    let query = null;

    if (stripeSessionId) {
      query = sb
        .from("orders")
        .select("id,status")
        .eq("stripe_session_id", stripeSessionId)
        .limit(1)
        .maybeSingle();
    } else if (paymentIntentId) {
      query = sb
        .from("orders")
        .select("id,status")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .limit(1)
        .maybeSingle();
    } else if (trackingNumber) {
      query = sb
        .from("orders")
        .select("id,status")
        .eq("tracking_number", trackingNumber)
        .limit(1)
        .maybeSingle();
    } else if (orderId) {
      query = sb
        .from("orders")
        .select("id,status")
        .eq("id", orderId)
        .limit(1)
        .maybeSingle();
    }

    if (!query) {
        sendVercelResponse(jsonResponse(200, { ok: true, ignored: true, reason: "no_match_keys" }, origin));
        return;
    }

    const { data: order, error: orderErr } = await query;

    if (orderErr || !order?.id) {
        sendVercelResponse(jsonResponse(200, { ok: true, ignored: true, reason: "order_not_found" }, origin));
        return;
    }

    const update = {
      updated_at: new Date().toISOString(),
      shipment_status: rawStatus || null,
      shipping_status: shipmentBucket,
      tracking_number: trackingNumber || null,
      carrier: carrier || null,
    };

    if (Number.isFinite(enviaCostMaybe)) {
      update.envia_cost_mxn = enviaCostMaybe;
    }

    const currentStatus = safeStr(order?.status).toLowerCase();

    if (shipmentBucket === "delivered") {
      update.status = "fulfilled";
      update.fulfilled_at = new Date().toISOString();
      update.shipped_at = new Date().toISOString();
    } else if (shipmentBucket === "in_transit") {
      if (currentStatus !== "fulfilled") {
        update.status = currentStatus === "paid" ? "paid" : currentStatus || "paid";
      }
      update.shipped_at = new Date().toISOString();
    } else if (shipmentBucket === "issue") {
      if (currentStatus !== "refunded" && currentStatus !== "cancelled") {
        update.status = currentStatus || "paid";
      }
    }

    const { error: upErr } = await sb
      .from("orders")
      .update(update)
      .eq("id", order.id);

    if (upErr) {
      throw upErr;
    }

    sendVercelResponse(jsonResponse(
      200,
      {
        ok: true,
        updated: true,
        order_id: order.id,
        shipment_status: rawStatus,
        shipping_status: shipmentBucket,
      },
      origin
    ));
  } catch (e) {
    console.error("[envia_webhook] error:", e?.message || e);
    sendVercelResponse(jsonResponse(500, { ok: false, error: "envia_webhook_failed" }, origin));
  }
};