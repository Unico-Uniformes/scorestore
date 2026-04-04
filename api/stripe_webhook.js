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
} = require("./_shared");

const relevantEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.succeeded",
  "charge.refunded",
]);

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

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: "2024-06-20",
  });
}

function getSignature(headers = {}) {
  return (
    headers["stripe-signature"] ||
    headers["Stripe-Signature"] ||
    headers["stripe_signature"] ||
    ""
  ).trim();
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req.body && Buffer.isBuffer(req.body)) {
        return resolve(req.body);
      }

      if (req.body && typeof req.body === "string") {
        return resolve(Buffer.from(req.body));
      }

      const chunks = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    } catch (error) {
      reject(error);
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePaymentStatus(status) {
  const s = String(status || "unpaid").toLowerCase();
  if (["paid", "succeeded", "succeeded_paid", "complete"].includes(s)) return "paid";
  if (["refunded", "partially_refunded"].includes(s)) return "refunded";
  if (["failed", "canceled", "cancelled"].includes(s)) return "failed";
  if (["processing", "in_transit"].includes(s)) return "processing";
  return "unpaid";
}

function normalizeOrderStatus(paymentStatus, nextStatus = "") {
  const ps = normalizePaymentStatus(paymentStatus);
  const ns = String(nextStatus || "").toLowerCase();

  if (ps === "paid") return "paid";
  if (ps === "refunded") return "refunded";
  if (ps === "failed") return "failed";

  if (ns === "pending_payment") return "pending_payment";
  if (ns === "pending") return "pending";
  if (ns === "open") return "open";

  return "pending_payment";
}

function safeJson(value, fallback = null) {
  try {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseShippingMode(session) {
  const md = session?.metadata || {};
  const shipping = session?.shipping_details || {};
  const mode = String(md.shipping_mode || md.ship_mode || shipping.mode || shipping.shipping_method || "").toLowerCase();

  if (["pickup", "pickup_local"].includes(mode)) return mode;
  if (["envia_us", "envia-mx", "envia_mx", "delivery"].includes(mode)) return mode === "delivery" ? "envia_mx" : mode;
  if (String(session?.shipping_address_collection?.allowed_countries || "").includes("US")) return "envia_us";
  return "pickup";
}

function parseShippingCountry(session) {
  return String(
    session?.shipping_details?.address?.country ||
    session?.metadata?.shipping_country ||
    "MX"
  ).toUpperCase();
}

function parseShippingPostal(session) {
  return String(
    session?.shipping_details?.address?.postal_code ||
    session?.metadata?.shipping_postal_code ||
    session?.metadata?.postal_code ||
    ""
  ).trim();
}

function parseCustomerEmail(session) {
  return String(
    session?.customer_details?.email ||
    session?.customer_email ||
    session?.metadata?.customer_email ||
    session?.receipt_email ||
    ""
  ).trim().toLowerCase();
}

function parseCustomerName(session) {
  return String(
    session?.customer_details?.name ||
    session?.customer_name ||
    session?.metadata?.customer_name ||
    session?.shipping_details?.name ||
    ""
  ).trim();
}

function parseCustomerPhone(session) {
  return String(
    session?.customer_details?.phone ||
    session?.metadata?.customer_phone ||
    session?.shipping_details?.phone ||
    ""
  ).trim();
}

function parseLineItemsSummary(session) {
  const items = session?.line_items?.data || session?.metadata?.items_json || session?.metadata?.items || [];
  const arr = Array.isArray(items) ? items : safeJson(items, []);
  if (!Array.isArray(arr) || !arr.length) {
    return String(session?.metadata?.items_summary || "").trim();
  }

  return arr
    .map((item) => {
      const qty = Number(item?.quantity || item?.qty || 1) || 1;
      const name = String(item?.description || item?.name || item?.title || item?.sku || "Item").trim();
      const size = item?.metadata?.size ? ` / ${String(item.metadata.size).trim()}` : "";
      return `${qty}x ${name}${size}`;
    })
    .join(" · ");
}

function normalizeOrderRow(row) {
  if (!row || typeof row !== "object") return null;

  return {
    id: safeStr(row.id || ""),
    org_id: safeStr(row.org_id || row.organization_id || ""),
    organization_id: safeStr(row.organization_id || row.org_id || ""),
    checkout_session_id: safeStr(row.checkout_session_id || row.stripe_session_id || ""),
    stripe_session_id: safeStr(row.stripe_session_id || row.checkout_session_id || ""),
    stripe_payment_intent_id: safeStr(row.stripe_payment_intent_id || ""),
    stripe_charge_id: safeStr(row.stripe_charge_id || ""),
    status: safeStr(row.status || "open", "open"),
    payment_status: normalizePaymentStatus(row.payment_status || "unpaid"),
    currency: safeStr(row.currency || "MXN", "MXN"),
    amount_subtotal_cents: Number(row.amount_subtotal_cents || row.subtotal_cents || 0) || 0,
    amount_shipping_cents: Number(row.amount_shipping_cents || row.shipping_cents || 0) || 0,
    amount_discount_cents: Number(row.amount_discount_cents || row.discount_cents || 0) || 0,
    amount_total_cents: Number(row.amount_total_cents || row.total_cents || 0) || 0,
    amount_total_mxn: Number(row.amount_total_mxn || 0) || 0,
    customer_name: safeStr(row.customer_name || row.customer_details?.name || ""),
    customer_email: safeStr(row.customer_email || row.customer_details?.email || ""),
    customer_phone: safeStr(row.customer_phone || row.customer_details?.phone || ""),
    shipping_mode: safeStr(row.shipping_mode || row.shipping_details?.mode || "pickup"),
    shipping_country: String(row.shipping_country || row.shipping_details?.country || "MX").toUpperCase(),
    shipping_postal_code: safeStr(row.shipping_postal_code || row.shipping_details?.postal || ""),
    shipping_details: row.shipping_details || null,
    customer_details: row.customer_details || null,
    items_json: row.items_json || null,
    items_summary: safeStr(row.items_summary || ""),
    tracking_number: safeStr(row.tracking_number || ""),
    carrier: safeStr(row.carrier || ""),
    shipment_status: safeStr(row.shipment_status || ""),
    shipping_status: safeStr(row.shipping_status || ""),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function normalizeStripeSession(session) {
  if (!session || typeof session !== "object") return null;

  const amountSubtotal = Number(session.amount_subtotal || 0) || 0;
  const amountTotal = Number(session.amount_total || 0) || 0;
  const shippingMode = parseShippingMode(session);

  return {
    ok: true,
    source: "stripe",
    session_id: safeStr(session.id || ""),
    status: safeStr(session.status || "open", "open"),
    payment_status: normalizePaymentStatus(session.payment_status || "unpaid"),
    currency: String(session.currency || "mxn").toUpperCase(),
    amount_subtotal_cents: amountSubtotal,
    amount_total_cents: amountTotal,
    amount_subtotal_mxn: amountSubtotal / 100,
    amount_total_mxn: amountTotal / 100,
    customer_email: parseCustomerEmail(session),
    customer_name: parseCustomerName(session),
    customer_phone: parseCustomerPhone(session),
    shipping_mode: shippingMode,
    shipping_country: parseShippingCountry(session),
    shipping_postal_code: parseShippingPostal(session),
    items_summary: parseLineItemsSummary(session),
    shipping_details: session.shipping_details || null,
    customer_details: session.customer_details || null,
    metadata: session.metadata || {},
  };
}

function buildSessionPatch(session) {
  const stripe = normalizeStripeSession(session);
  if (!stripe) return null;

  const paymentStatus = normalizePaymentStatus(stripe.payment_status);
  const orderStatus = normalizeOrderStatus(paymentStatus, paymentStatus === "paid" ? "paid" : "pending_payment");

  return {
    stripe_session_id: stripe.session_id,
    checkout_session_id: stripe.session_id,
    stripe_payment_intent_id: safeStr(
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || ""
    ),
    status: orderStatus,
    payment_status: paymentStatus,
    paid_at: paymentStatus === "paid" ? nowIso() : null,
    refunded_at: paymentStatus === "refunded" ? nowIso() : null,
    customer_email: stripe.customer_email,
    customer_name: stripe.customer_name,
    customer_phone: stripe.customer_phone,
    shipping_mode: stripe.shipping_mode,
    shipping_country: stripe.shipping_country,
    shipping_postal_code: stripe.shipping_postal_code,
    amount_subtotal_cents: stripe.amount_subtotal_cents,
    amount_total_cents: stripe.amount_total_cents,
    amount_total_mxn: stripe.amount_total_mxn,
    items_summary: stripe.items_summary,
    shipping_details: stripe.shipping_details,
    customer_details: stripe.customer_details,
    metadata: stripe.metadata,
    updated_at: nowIso(),
  };
}

function buildPaymentIntentPatch(paymentIntent, nextStatus, extra = {}) {
  const paymentStatus = normalizePaymentStatus(
    extra?.payment_status || paymentIntent?.status || nextStatus || "unpaid"
  );

  return {
    stripe_payment_intent_id: paymentIntent?.id || null,
    payment_status: paymentStatus,
    status: normalizeOrderStatus(paymentStatus, nextStatus),
    paid_at: paymentStatus === "paid" ? nowIso() : null,
    refunded_at: paymentStatus === "refunded" ? nowIso() : null,
    ...extra,
  };
}

async function fetchOrderBySession(sb, sessionId) {
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .or(`checkout_session_id.eq.${sessionId},stripe_session_id.eq.${sessionId}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function fetchOrderByPaymentIntent(sb, paymentIntentId) {
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function updateOrderById(sb, orderId, patch) {
  if (!orderId) return null;

  const { data, error } = await sb
    .from("orders")
    .update({
      ...patch,
      updated_at: nowIso(),
    })
    .eq("id", orderId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function syncOrderFromSession(sb, session) {
  if (!session?.id) return null;

  const order = await fetchOrderBySession(sb, session.id);
  if (!order?.id) return null;

  const patch = buildSessionPatch(session);
  await updateOrderById(sb, order.id, patch);

  return { orderId: order.id, patch, order };
}

async function syncOrderFromPaymentIntent(sb, paymentIntentId, nextStatus, extra = {}) {
  if (!paymentIntentId) return null;

  const order = await fetchOrderByPaymentIntent(sb, paymentIntentId);
  if (!order?.id) return null;

  const patch = buildPaymentIntentPatch(
    typeof paymentIntentId === "object" ? paymentIntentId : { id: paymentIntentId },
    nextStatus,
    extra
  );

  await updateOrderById(sb, order.id, patch);

  return { orderId: order.id, patch, order };
}

async function attachAudit(sb, orgId, action, entity, entityId, summary, meta = {}) {
  try {
    await sb.from("audit_log").insert({
      organization_id: orgId,
      org_id: orgId,
      actor_email: "stripe-webhook@system",
      actor_user_id: null,
      action,
      entity,
      entity_id: entityId,
      summary,
      before: null,
      after: null,
      meta: {
        source: "api/stripe_webhook",
        ...meta,
      },
      ip: null,
      user_agent: null,
    });
  } catch (e) {
    console.error("[stripe_webhook] audit insert failed:", e?.message || e);
  }
}

async function maybeNotifyTelegram(message) {
  if (typeof sendTelegram !== "function") return;
  try {
    await sendTelegram(message);
  } catch {}
}

async function resolveWebhookOrgId(sb, event) {
  const md = event?.data?.object?.metadata || {};
  const candidates = [
    safeStr(md.org_id || md.organization_id || ""),
    safeStr(md.orgId || ""),
    safeStr(process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID || ""),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (/^[0-9a-f-]{36}$/i.test(candidate)) return candidate;
  }

  try {
    const orgId = await resolveScoreOrgId(sb);
    if (orgId) return orgId;
  } catch {}

  return "";
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

    const sig = getSignature(req.headers);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      return send(res, jsonResponse(400, { ok: false, error: "Webhook secret not configured" }, origin));
    }

    const rawBody = await readRawBody(req);
    const stripe = getStripeClient();

    if (!stripe) {
      return send(res, jsonResponse(500, { ok: false, error: "Stripe not configured" }, origin));
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (error) {
      console.error("[stripe_webhook] signature verification failed:", error?.message || error);
      return send(
        res,
        jsonResponse(400, { ok: false, error: `Webhook Error: ${error.message}` }, origin)
      );
    }

    if (!relevantEvents.has(event.type)) {
      return send(
        res,
        jsonResponse(
          200,
          { ok: true, received: true, ignored: true, reason: "irrelevant_event" },
          origin
        )
      );
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return send(res, jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin));
    }

    const orgId = await resolveWebhookOrgId(sb, event);
    const eventId = safeStr(event?.id || crypto.randomUUID());

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const synced = await syncOrderFromSession(sb, session);

        await attachAudit(
          sb,
          orgId,
          "stripe.webhook.checkout_session_completed",
          "orders",
          synced?.orderId || safeStr(session?.id || ""),
          "Stripe checkout.session.completed processed",
          {
            event_id: eventId,
            event_type: event.type,
            session_id: safeStr(session?.id || ""),
            payment_status: safeStr(session?.payment_status || "unpaid"),
            order_id: synced?.orderId || null,
          }
        );

        if (session?.payment_intent) {
          const piId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id;

          if (piId) {
            await syncOrderFromPaymentIntent(sb, piId, session.payment_status === "paid" ? "paid" : "pending_payment", {
              payment_status: session.payment_status || "unpaid",
              paid_at: session.payment_status === "paid" ? nowIso() : null,
            });
          }
        }

        await maybeNotifyTelegram(
          [
            "✅ <b>Stripe webhook</b>",
            `Evento: ${event.type}`,
            `Session: ${safeStr(session?.id || "")}`,
            `Pago: ${safeStr(session?.payment_status || "unpaid")}`,
          ].join("\n")
        );
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        const synced = await syncOrderFromSession(sb, session);

        if (session?.payment_intent) {
          const piId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id;

          if (piId) {
            await syncOrderFromPaymentIntent(sb, piId, "paid", {
              payment_status: "paid",
              paid_at: nowIso(),
            });
          }
        }

        await attachAudit(
          sb,
          orgId,
          "stripe.webhook.async_payment_succeeded",
          "orders",
          synced?.orderId || safeStr(session?.id || ""),
          "Stripe async payment succeeded processed",
          {
            event_id: eventId,
            event_type: event.type,
            session_id: safeStr(session?.id || ""),
            order_id: synced?.orderId || null,
          }
        );
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object;
        const synced = await syncOrderFromSession(sb, session);

        await attachAudit(
          sb,
          orgId,
          "stripe.webhook.async_payment_failed",
          "orders",
          synced?.orderId || safeStr(session?.id || ""),
          "Stripe async payment failed processed",
          {
            event_id: eventId,
            event_type: event.type,
            session_id: safeStr(session?.id || ""),
            order_id: synced?.orderId || null,
          }
        );
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const piId = safeStr(paymentIntent?.id || "");
        const synced = piId
          ? await syncOrderFromPaymentIntent(sb, piId, "paid", {
              payment_status: "paid",
              paid_at: nowIso(),
              stripe_payment_intent_id: piId,
            })
          : null;

        await attachAudit(
          sb,
          orgId,
          "stripe.webhook.payment_intent_succeeded",
          "orders",
          synced?.orderId || piId,
          "Stripe payment_intent.succeeded processed",
          {
            event_id: eventId,
            event_type: event.type,
            payment_intent_id: piId,
            order_id: synced?.orderId || null,
          }
        );
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const piId = safeStr(paymentIntent?.id || "");
        const synced = piId
          ? await syncOrderFromPaymentIntent(sb, piId, "failed", {
              payment_status: "failed",
              stripe_payment_intent_id: piId,
            })
          : null;

        await attachAudit(
          sb,
          orgId,
          "stripe.webhook.payment_intent_failed",
          "orders",
          synced?.orderId || piId,
          "Stripe payment_intent.payment_failed processed",
          {
            event_id: eventId,
            event_type: event.type,
            payment_intent_id: piId,
            order_id: synced?.orderId || null,
          }
        );
        break;
      }

      case "charge.succeeded": {
        const charge = event.data.object;
        const piId = safeStr(charge?.payment_intent || "");
        const synced = piId
          ? await syncOrderFromPaymentIntent(sb, piId, "paid", {
              payment_status: "paid",
              paid_at: nowIso(),
              stripe_charge_id: safeStr(charge?.id || ""),
            })
          : null;

        await attachAudit(
          sb,
          orgId,
          "stripe.webhook.charge_succeeded",
          "orders",
          synced?.orderId || piId || safeStr(charge?.id || ""),
          "Stripe charge.succeeded processed",
          {
            event_id: eventId,
            event_type: event.type,
            charge_id: safeStr(charge?.id || ""),
            payment_intent: piId || null,
            order_id: synced?.orderId || null,
          }
        );
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const piId = safeStr(charge?.payment_intent || "");
        const synced = piId
          ? await syncOrderFromPaymentIntent(sb, piId, "refunded", {
              payment_status: "refunded",
              refunded_at: nowIso(),
              stripe_charge_id: safeStr(charge?.id || ""),
            })
          : null;

        await attachAudit(
          sb,
          orgId,
          "stripe.webhook.charge_refunded",
          "orders",
          synced?.orderId || piId || safeStr(charge?.id || ""),
          "Stripe charge.refunded processed",
          {
            event_id: eventId,
            event_type: event.type,
            charge_id: safeStr(charge?.id || ""),
            payment_intent: piId || null,
            order_id: synced?.orderId || null,
          }
        );
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