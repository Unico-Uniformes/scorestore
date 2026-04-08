"use strict";

const crypto = require("crypto");
const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
  resolveScoreOrgId,
  sendTelegram,
} = require("../_shared");

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
    envia_cost_cents: Number.isFinite(Number(enviaCostMaybe))
      ? Math.max(0, Math.round(Number(enviaCostMaybe)))
      : null,
  };

  return update;
}

function getQueryCandidates(payload = {}) {
  const meta = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;

  const stripeSessionId = safeStr(
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

  return { stripeSessionId, trackingNumber, orderId };
}

async function queryOrder(sb, orgId, qb) {
  const query = orgId
    ? qb.or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
    : qb;

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findOrderByCandidates(sb, { orgId, stripeSessionId, trackingNumber, orderId }) {
  if (!sb) return null;

  if (orderId) {
    const byId = await queryOrder(
      sb,
      orgId,
      sb.from("orders").select("*").eq("id", orderId)
    ).catch(() => null);
    if (byId?.id) return byId;
  }

  if (stripeSessionId) {
    const bySession = await queryOrder(
      sb,
      orgId,
      sb
        .from("orders")
        .select("*")
        .or(`checkout_session_id.eq.${stripeSessionId},stripe_session_id.eq.${stripeSessionId}`)
    ).catch(() => null);
    if (bySession?.id) return bySession;
  }

  if (trackingNumber) {
    const byLabel = await queryOrder(
      sb,
      orgId,
      sb
        .from("shipping_labels")
        .select("order_id")
        .or(`tracking_number.eq.${trackingNumber},tracking.eq.${trackingNumber},guide_number.eq.${trackingNumber}`)
    ).catch(() => null);

    if (byLabel?.order_id) {
      const fromLabel = await queryOrder(
        sb,
        orgId,
        sb.from("orders").select("*").eq("id", byLabel.order_id)
      ).catch(() => null);
      if (fromLabel?.id) return fromLabel;
    }

    const byTracking = await queryOrder(
      sb,
      orgId,
      sb
        .from("orders")
        .select("*")
        .or(`tracking_number.eq.${trackingNumber},shipping_tracking_number.eq.${trackingNumber}`)
    ).catch(() => null);

    if (byTracking?.id) return byTracking;
  }

  return null;
}

async function updateOrder(sb, orderId, update) {
  const { error } = await sb.from("orders").update(update).eq("id", orderId);
  if (error) throw error;
}

async function upsertLabel(
  sb,
  payload,
  order,
  { orgId, stripeSessionId },
  rawStatus,
  shipmentBucket,
  carrier,
  trackingNumber,
  enviaCostMaybe
) {
  const now = new Date().toISOString();

  await sb.from("shipping_labels").upsert(
    {
      id: payload?.id || crypto.randomUUID(),
      org_id: orgId,
      organization_id: orgId,
      order_id: order.id,
      stripe_session_id: stripeSessionId || order.checkout_session_id || order.stripe_session_id || null,
      provider: "envia",
      status_raw: rawStatus || null,
      status_bucket: shipmentBucket || null,
      carrier: carrier || null,
      tracking_number: trackingNumber || null,
      envia_cost_cents: Number.isFinite(Number(enviaCostMaybe))
        ? Math.max(0, Math.round(Number(enviaCostMaybe)))
        : null,
      raw: payload,
      created_at: now,
      updated_at: now,
    },
    { onConflict: "order_id" }
  );
}

async function insertWebhookLog(
  sb,
  payload,
  order,
  { orgId, stripeSessionId },
  rawStatus,
  carrier,
  trackingNumber
) {
  const now = new Date().toISOString();

  await sb.from("webhook_logs").insert({
    id: payload?.id || crypto.randomUUID(),
    org_id: orgId,
    organization_id: orgId,
    source: "envia",
    provider: "envia",
    order_id: order.id,
    stripe_session_id: stripeSessionId || order.checkout_session_id || order.stripe_session_id || null,
    status_raw: rawStatus || null,
    carrier: carrier || null,
    tracking_number: trackingNumber || null,
    raw: payload,
    created_at: now,
    updated_at: now,
  });
}

async function maybeNotifyTelegram(message) {
  if (typeof sendTelegram !== "function") return;
  try {
    await sendTelegram(message);
  } catch {}
}

async function verifyWebhookSignature(rawBody, signature) {
  if (!ENVIA_WEBHOOK_SECRET) return true;
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", ENVIA_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return expected === signature;
}

async function main(req, res) {
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
    const signatureOk = await verifyWebhookSignature(rawBody, signature);

    if (!signatureOk) {
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

    const orgId = await resolveScoreOrgId(sb).catch(() => "");

    const order = await findOrderByCandidates(sb, {
      orgId,
      stripeSessionId,
      trackingNumber,
      orderId,
    });

    if (!order) {
      return send(
        res,
        jsonResponse(200, { ok: true, ignored: true, reason: "no_match_keys" }, origin)
      );
    }

    const update = buildOrderUpdate({
      rawStatus,
      shipmentBucket,
      trackingNumber,
      carrier,
      orgId,
      enviaCostMaybe,
    });

    const currentStatus = normalizeLower(order?.status);

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

    await updateOrder(sb, order.id, update);

    await upsertLabel(
      sb,
      payload,
      order,
      { orgId, stripeSessionId },
      rawStatus,
      shipmentBucket,
      carrier,
      trackingNumber,
      enviaCostMaybe
    );

    await insertWebhookLog(
      sb,
      payload,
      order,
      { orgId, stripeSessionId },
      rawStatus,
      carrier,
      trackingNumber
    );

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

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          updated: true,
          order_id: order.id,
          shipment_status: rawStatus,
          shipping_status: shipmentBucket,
        },
        origin
      )
    );
  } catch (e) {
    console.error("[envia_webhook] error:", e?.message || e);
    return send(res, jsonResponse(500, { ok: false, error: "envia_webhook_failed" }, origin));
  }
}

module.exports = main;
module.exports.default = main;