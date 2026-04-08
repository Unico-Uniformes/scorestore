// lib/handlers/_envia_webhook.js
// (antes: api/_envia_webhook.js — movido a lib/handlers/)
// FIX CRÍTICO: el original tenía un bloque de código suelto fuera de cualquier
// función (el for...of de fetchOrderByCandidates) que causaba SyntaxError en runtime.
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

// ── Helpers de respuesta ─────────────────────────────────────────────────────

function send(res, payload) {
  const out   = payload || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"]        = "no-cache";
  out.headers["Expires"]       = "0";
  res.statusCode = out.statusCode || 200;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body || "");
}

function getOrigin(req) {
  return req?.headers?.origin || req?.headers?.Origin || "*";
}

function getHeader(headers, name) {
  const h     = headers || {};
  const lower = String(name || "").toLowerCase();
  const upper = String(name || "").toUpperCase();
  return safeStr(h[name] || h[lower] || h[upper] || "");
}

function getSignature(req) {
  const headers = req?.headers || {};
  return (
    getHeader(headers, "x-envia-signature") ||
    getHeader(headers, "x-signature")       ||
    getHeader(headers, "signature")          ||
    getHeader(headers, "x-webhook-signature") ||
    ""
  );
}

// ── Body parsing ─────────────────────────────────────────────────────────────

async function readRawBody(req) {
  if (!req)                        return Buffer.from("");
  if (Buffer.isBuffer(req.body))   return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  if (req.rawBody)
    return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
  if (typeof req.arrayBuffer === "function") {
    const ab = await req.arrayBuffer();
    return Buffer.from(ab);
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on?.("data",  (chunk) => chunks.push(Buffer.from(chunk)));
    req.on?.("end",   () => resolve(Buffer.concat(chunks)));
    req.on?.("error", () => resolve(Buffer.from("")));
  });
}

function parsePayload(req, rawBody) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const text = rawBody ? rawBody.toString("utf8") : "";
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

// ── Utils ────────────────────────────────────────────────────────────────────

function normalizeLower(v)   { return safeStr(v).trim().toLowerCase(); }
function normalizeText(v)    { return safeStr(v).trim(); }
function normalizeTracking(v){ return normalizeText(v).replace(/\s+/g, "").toUpperCase(); }

// ── Order update builder ─────────────────────────────────────────────────────

function buildOrderUpdate({ rawStatus, shipmentBucket, trackingNumber, carrier, orgId, enviaCostMaybe }) {
  const now      = new Date().toISOString();
  const tracking = normalizeTracking(trackingNumber);

  const update = {
    updated_at:           now,
    org_id:               orgId,
    organization_id:      orgId,
    shipping_provider:    "envia",
    shipping_status_raw:  normalizeText(rawStatus),
    shipping_status:      normalizeText(shipmentBucket),
    shipping_carrier:     normalizeText(carrier),
    tracking_number:      tracking || null,
    carrier:              normalizeText(carrier) || null,
    envia_cost_cents:     Number.isFinite(Number(enviaCostMaybe))
      ? Math.max(0, Math.round(Number(enviaCostMaybe)))
      : null,
  };

  if (shipmentBucket === "delivered") {
    update.status       = "fulfilled";
    update.fulfilled_at = now;
    update.shipped_at   = now;
  } else if (shipmentBucket === "in_transit") {
    update.status     = "paid";
    update.shipped_at = now;
  } else if (shipmentBucket === "issue") {
    update.status = "paid";
  }

  return update;
}

// ── Candidates helper ────────────────────────────────────────────────────────

function getQueryCandidates(payload = {}) {
  const meta = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const data = payload?.data     && typeof payload.data     === "object" ? payload.data     : payload;

  const stripeSessionId = safeStr(
    meta.stripe_session_id    || meta.session_id       || meta.checkout_session_id ||
    data.stripe_session_id    || data.session_id       || data.checkout_session_id ||
    ""
  ).trim();

  const trackingNumber = normalizeTracking(
    data.tracking_number || data.trackingNumber || data.guide_number ||
    data.guideNumber     || data.tracking       || meta.tracking_number || ""
  );

  const orderId = safeStr(data.order_id || data.orderId || meta.order_id || meta.orderId || "").trim();

  return { stripeSessionId, trackingNumber, orderId };
}

// FIX CRÍTICO: esta función existía con el bloque for...of suelto fuera de ella
// en el original. La reconstruimos correctamente.
async function findOrderByCandidates(sb, { stripeSessionId, trackingNumber, orderId }) {
  const candidates = [];

  if (orderId) {
    candidates.push(
      sb.from("orders").select("*").eq("id", orderId).maybeSingle()
    );
  }

  if (stripeSessionId) {
    candidates.push(
      sb.from("orders")
        .select("*")
        .or(`checkout_session_id.eq.${stripeSessionId},stripe_session_id.eq.${stripeSessionId}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );
  }

  if (trackingNumber) {
    candidates.push(
      sb.from("orders")
        .select("*")
        .eq("tracking_number", trackingNumber)
        .order("created_at", { ascending: false })
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

// ── DB writers ───────────────────────────────────────────────────────────────

async function updateOrder(sb, orderId, update) {
  const { error } = await sb.from("orders").update(update).eq("id", orderId);
  if (error) throw error;
}

async function upsertLabel(sb, payload, order, { orgId, stripeSessionId }, rawStatus, shipmentBucket, carrier, trackingNumber, enviaCostMaybe) {
  const now = new Date().toISOString();
  await sb.from("shipping_labels").upsert(
    {
      id:               payload?.id || crypto.randomUUID(),
      org_id:           orgId,
      organization_id:  orgId,
      order_id:         order.id,
      stripe_session_id:
        stripeSessionId || order.checkout_session_id || order.stripe_session_id || null,
      provider:         "envia",
      status_raw:       rawStatus       || null,
      status_bucket:    shipmentBucket  || null,
      carrier:          carrier         || null,
      tracking_number:  trackingNumber  || null,
      envia_cost_cents: Number.isFinite(Number(enviaCostMaybe))
        ? Math.max(0, Math.round(Number(enviaCostMaybe)))
        : null,
      raw:        payload,
      created_at: now,
      updated_at: now,
    },
    { onConflict: "order_id" }
  );
}

async function insertWebhookLog(sb, payload, order, { orgId, stripeSessionId }, rawStatus, carrier, trackingNumber) {
  const now = new Date().toISOString();
  await sb.from("webhook_logs").insert({
    id:               payload?.id || crypto.randomUUID(),
    org_id:           orgId,
    organization_id:  orgId,
    source:           "envia",
    provider:         "envia",
    order_id:         order.id,
    stripe_session_id:
      stripeSessionId || order.checkout_session_id || order.stripe_session_id || null,
    status_raw:      rawStatus      || null,
    carrier:         carrier        || null,
    tracking_number: trackingNumber || null,
    raw:             payload,
    created_at:      now,
    updated_at:      now,
  });
}

async function maybeNotifyTelegram(message) {
  if (typeof sendTelegram !== "function") return;
  try { await sendTelegram(message); } catch {}
}

// ── Signature verification ───────────────────────────────────────────────────

async function verifyWebhookSignature(rawBody, signature) {
  if (!ENVIA_WEBHOOK_SECRET) return true;  // sin secret configurado → aceptar todo
  if (!signature)            return false;
  const expected = crypto
    .createHmac("sha256", ENVIA_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return expected === signature;
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }
    if (req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    }

    const rawBody      = await readRawBody(req);
    const signature    = getSignature(req);
    const signatureOk  = await verifyWebhookSignature(rawBody, signature);

    if (!signatureOk) {
      return send(res, jsonResponse(400, { ok: false, error: "Invalid webhook signature" }, origin));
    }

    const payload = parsePayload(req, rawBody);
    const { stripeSessionId, trackingNumber, orderId } = getQueryCandidates(payload);

    const rawStatus = normalizeText(
      payload.status       || payload.state          ||
      payload.shipment_status || payload.shipping_status ||
      payload.data?.status || payload.data?.state   || ""
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
      payload.carrier      || payload.carrier_name ||
      payload.data?.carrier || payload.data?.carrier_name || ""
    );

    const enviaCostMaybe =
      payload.cost_cents       || payload.envia_cost_cents     ||
      payload.data?.cost_cents || payload.data?.envia_cost_cents || null;

    const sb = supabaseAdmin();
    if (!sb) {
      return send(res, jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin));
    }

    const orgId = await resolveScoreOrgId(sb);

    const order = await findOrderByCandidates(sb, { stripeSessionId, trackingNumber, orderId });

    if (!order) {
      return send(res, jsonResponse(200, { ok: true, ignored: true, reason: "no_match_keys" }, origin));
    }

    const update        = buildOrderUpdate({ rawStatus, shipmentBucket, trackingNumber, carrier, orgId, enviaCostMaybe });
    const currentStatus = normalizeLower(order?.status);

    // Refinar status según estado actual para no hacer downgrade
    if (shipmentBucket === "delivered") {
      update.status       = "fulfilled";
      update.fulfilled_at = new Date().toISOString();
      update.shipped_at   = new Date().toISOString();
    } else if (shipmentBucket === "in_transit") {
      if (currentStatus !== "fulfilled") {
        update.status = currentStatus === "paid" ? "paid" : (currentStatus || "paid");
      }
      update.shipped_at = new Date().toISOString();
    } else if (shipmentBucket === "issue") {
      if (currentStatus !== "refunded" && currentStatus !== "cancelled") {
        update.status = currentStatus || "paid";
      }
    }

    await updateOrder(sb, order.id, update);

    await upsertLabel(
      sb, payload, order, { orgId, stripeSessionId },
      rawStatus, shipmentBucket, carrier, trackingNumber, enviaCostMaybe
    );

    await insertWebhookLog(
      sb, payload, order, { orgId, stripeSessionId },
      rawStatus, carrier, trackingNumber
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

    return send(res, jsonResponse(200, {
      ok:              true,
      updated:         true,
      order_id:        order.id,
      shipment_status: rawStatus,
      shipping_status: shipmentBucket,
    }, origin));

  } catch (e) {
    console.error("[envia_webhook] error:", e?.message || e);
    return send(res, jsonResponse(500, { ok: false, error: "envia_webhook_failed" }, origin));
  }
};
