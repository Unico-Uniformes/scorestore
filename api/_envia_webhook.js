// api/_envia_webhook.js
"use strict";

const crypto = require("crypto");

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
  resolveScoreOrgId,
  sendTelegram,
} = require("../lib/_shared");

const ENVIA_WEBHOOK_SECRET =
  process.env.ENVIA_WEBHOOK_SECRET ||
  process.env.ENVIA_SIGNATURE_SECRET ||
  "";

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

function getHeader(headers, name) {
  const h = headers || {};
  const lower = String(name || "").toLowerCase();
  const upper = String(name || "").toUpperCase();
  return safeStr(h[name] || h[lower] || h[upper] || "");
}

function getSignature(req) {
  const headers = req?.headers || {};
  return (
    getHeader(headers, "x-envia-signature") ||
    getHeader(headers, "x-signature") ||
    getHeader(headers, "signature") ||
    getHeader(headers, "x-webhook-signature") ||
    ""
  );
}

async function readRawBody(req) {
  if (!req) return Buffer.from("");

  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  if (req.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));

  if (typeof req.arrayBuffer === "function") {
    const ab = await req.arrayBuffer();
    return Buffer.from(ab);
  }

  return new Promise((resolve) => {
    const chunks = [];
    req.on?.("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on?.("end", () => resolve(Buffer.concat(chunks)));
    req.on?.("error", () => resolve(Buffer.from("")));
  });
}

function parsePayload(req, rawBody) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const text = rawBody ? rawBody.toString("utf8") : "";
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeLower(v) {
  return safeStr(v).trim().toLowerCase();
}

function normalizeText(v) {
  return safeStr(v).trim();
}

function normalizeTracking(v) {
  return normalizeText(v).replace(/\s+/g, "").toUpperCase();
}

function buildOrderUpdate({
  rawStatus,
  shipmentBucket,
  trackingNumber,
  carrier,
  orgId,
  enviaCostMaybe,
}) {
  const now = new Date().toISOString();
  const tracking = normalizeTracking(trackingNumber);

  const cost = Number.isFinite(Number(enviaCostMaybe))
    ? Math.max(0, Math.round(Number(enviaCostMaybe)))
    : null;

  const update = {
    updated_at: now,
    org_id: orgId,
    organization_id: orgId,
    shipping_provider: "envia",
    shipping_status_raw: normalizeText(rawStatus),
    shipping_status: normalizeText(shipmentBucket),
    shipping_carrier: normalizeText(carrier),
    tracking_number: tracking || null,
    carrier: normalizeText(carrier) || null,
    envia_cost_cents: cost, // ✅ FIX: eliminado campo con acento
  };

  if (shipmentBucket === "delivered") {
    update.status = "fulfilled";
    update.fulfilled_at = now;
    update.shipped_at = now;
  } else if (shipmentBucket === "in_transit") {
    update.status = "paid";
    update.shipped_at = now;
  } else if (shipmentBucket === "issue") {
    update.status = "paid";
  }

  return update;
}

function getQueryCandidates(payload = {}) {
  const meta = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;

  const stripeSessionId =
    safeStr(
      meta.stripe_session_id ||
        meta.session_id ||
        meta.checkout_session_id ||
        data.stripe_session_id ||
        data.session_id ||
        data.checkout_session_id ||
        ""
    ).trim();

  const trackingNumber = normalizeTracking(
    data.tracking_number ||
      data.trackingNumber ||
      data.guide_number ||
      data.guideNumber ||
      data.tracking ||
      meta.tracking_number ||
      ""
  );

  const orderId = safeStr(data.order_id || data.orderId || meta.order_id || meta.orderId || "").trim();

  return {
    stripeSessionId,
    trackingNumber,
    orderId,
  };
}

async function findOrderByCandidates(sb, { stripeSessionId, trackingNumber, orderId }) {
  const candidates = [];

  if (orderId) {
    candidates.push(
      sb.from("orders").select("*").eq("id", orderId).limit(1).maybeSingle()
    );
  }

  if (stripeSessionId) {
    candidates.push(
      sb
        .from("orders")
        .select("*")
        .or(`checkout_session_id.eq.${stripeSessionId},stripe_session_id.eq.${stripeSessionId}`)
        .limit(1)
        .maybeSingle()
    );
  }

  if (trackingNumber) {
    candidates.push(
      sb
        .from("orders")
        .select("*")
        .or(`tracking_number.eq.${trackingNumber},envia_tracking_number.eq.${trackingNumber}`)
        .limit(1)
        .maybeSingle()
    );
  }

  for (const query of candidates) {
    if (!query) continue;

    const { data: order, error: orderErr } = await query;
    if (orderErr || !order?.id) continue;

    return order;
  }

  return null;
}

async function updateOrder(sb, orderId, update) {
  const { error } = await sb.from("orders").update(update).eq("id", orderId);
  if (error) throw error;
}

async function verifyWebhookSignature(rawBody, signature) {
  if (!ENVIA_WEBHOOK_SECRET) return true;
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", ENVIA_WEBHOOK_SECRET)
    .update(rawBody) // ✅ FIX real
    .digest("hex");

  return expected === signature;
}

module.exports = async (req, res) => {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    }

    const rawBody = await readRawBody(req);
    const signature = getSignature(req);

    if (!(await verifyWebhookSignature(rawBody, signature))) {
      return send(res, jsonResponse(400, { ok: false, error: "Invalid webhook signature" }, origin));
    }

    const payload = parsePayload(req, rawBody);
    const { stripeSessionId, trackingNumber, orderId } = getQueryCandidates(payload);

    const rawStatus = normalizeText(
      payload.status ||
        payload.state ||
        payload.shipment_status ||
        payload.shipping_status ||
        payload.data?.status ||
        payload.data?.state ||
        ""
    );

    const shipmentBucket = (() => {
      const s = normalizeLower(rawStatus);
      if (!s) return "pending";
      if (["delivered", "delivered_to_customer", "completed"].includes(s)) return "delivered";
      if (["in_transit", "transit", "shipping", "shipped", "picked_up"].includes(s)) return "in_transit";
      if (["issue", "problem", "failed", "exception", "returned"].includes(s)) return "issue";
      return "pending";
    })();

    const carrier = normalizeText(
      payload.carrier ||
        payload.carrier_name ||
        payload.data?.carrier ||
        payload.data?.carrier_name ||
        ""
    );

    const enviaCostMaybe =
      payload.cost_cents ||
      payload.envia_cost_cents ||
      payload.data?.cost_cents ||
      payload.data?.envia_cost_cents ||
      null;

    const sb = supabaseAdmin();
    if (!sb) {
      return send(res, jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin));
    }

    const orgId = await resolveScoreOrgId(sb);

    const order = await findOrderByCandidates(sb, {
      stripeSessionId,
      trackingNumber,
      orderId,
    });

    if (!order) {
      return send(res, jsonResponse(200, { ok: true, ignored: true }, origin));
    }

    const update = buildOrderUpdate({
      rawStatus,
      shipmentBucket,
      trackingNumber,
      carrier,
      orgId,
      enviaCostMaybe,
    });

    await updateOrder(sb, order.id, update);

    await maybeNotifyTelegram(
      [
        "📦 <b>Envía webhook</b>",
        `Estado: ${rawStatus || "pending"}`,
        `Bucket: ${shipmentBucket}`,
        `Pedido: ${order.id}`,
        trackingNumber ? `Tracking: ${trackingNumber}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );

    return send(res, jsonResponse(200, { ok: true, updated: true }, origin));
  } catch (e) {
    console.error("[envia_webhook] error:", e?.message || e);
    return send(res, jsonResponse(500, { ok: false, error: "envia_webhook_failed" }, origin));
  }
};

module.exports.default = module.exports;