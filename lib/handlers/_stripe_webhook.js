"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  initStripe,
  safeStr,
  resolveScoreOrgId,
  readRawBody,
  sendTelegram,
} = require("../_shared");

const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ||
  process.env.STRIPE_ENDPOINT_SECRET ||
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
  return req?.headers?.origin || req?.headers?.Origin || "";
}

function getHeader(headers, name) {
  const h = headers || {};
  const lower = String(name || "").toLowerCase();
  const upper = String(name || "").toUpperCase();
  return safeStr(h[name] || h[lower] || h[upper] || "");
}

function getStripeSignature(req) {
  return (
    getHeader(req?.headers || {}, "stripe-signature") ||
    getHeader(req?.headers || {}, "Stripe-Signature") ||
    ""
  );
}

function normalizeShipMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "pickup") return "pickup";
  if (m === "pickup_local") return "pickup_local";
  if (m === "envia_us") return "envia_us";
  if (m === "envia_mx") return "envia_mx";
  if (m === "delivery") return "delivery";
  return m || "pickup";
}

function nowIso() {
  return new Date().toISOString();
}

function buildOrderPatchFromSession(session) {
  const paymentStatus = safeStr(session?.payment_status || "unpaid").toLowerCase();
  const status = paymentStatus === "paid"
    ? "paid"
    : paymentStatus === "no_payment_required"
      ? "paid"
      : safeStr(session?.status || "open").toLowerCase();

  const shipping = session?.shipping_details || null;
  const customer = session?.customer_details || null;
  const pi = session?.payment_intent || null;
  const paymentIntentId = typeof pi === "string" ? pi : pi?.id || "";

  const subtotal = Number(session?.amount_subtotal || 0) || 0;
  const shippingCents = Number(session?.shipping_cost?.amount_total || 0) || 0;
  const discount = Number(session?.total_details?.amount_discount || 0) || 0;
  const total = Number(session?.amount_total || 0) || 0;

  return {
    stripe_session_id: safeStr(session?.id || ""),
    checkout_session_id: safeStr(session?.id || ""),
    stripe_payment_intent_id: safeStr(paymentIntentId),
    payment_status: paymentStatus,
    status,
    customer_email: safeStr(session?.customer_email || customer?.email || ""),
    customer_name: safeStr(customer?.name || ""),
    customer_phone: safeStr(customer?.phone || ""),
    shipping_mode: normalizeShipMode(session?.metadata?.shipping_mode || shipping?.mode || ""),
    shipping_country: safeStr(shipping?.address?.country || session?.shipping_address_collection?.allowed_countries?.[0] || "MX"),
    shipping_postal_code: safeStr(shipping?.address?.postal_code || ""),
    amount_subtotal_cents: subtotal,
    amount_discount_cents: discount,
    amount_shipping_cents: shippingCents,
    amount_total_cents: total,
    amount_subtotal_mxn: subtotal / 100,
    amount_discount_mxn: discount / 100,
    amount_shipping_mxn: shippingCents / 100,
    amount_total_mxn: total / 100,
    currency: safeStr(session?.currency || "MXN", "MXN"),
    promo_code: safeStr(session?.metadata?.promo_code || ""),
    items_summary: safeStr(session?.metadata?.items_summary || ""),
    shipping_details: shipping,
    customer_details: customer,
    metadata: session?.metadata || {},
    paid_at: paymentStatus === "paid" ? nowIso() : null,
    updated_at: nowIso(),
  };
}

function buildOrderPatchFromPaymentIntent(paymentIntent, charge, current = {}) {
  const paymentStatus = safeStr(paymentIntent?.status || "unpaid").toLowerCase();
  const status = paymentStatus === "succeeded"
    ? "paid"
    : paymentStatus === "refunded"
      ? "refunded"
      : paymentStatus === "requires_payment_method"
        ? "failed"
        : safeStr(current?.status || "open").toLowerCase();

  const latestCharge = charge || paymentIntent?.latest_charge || null;
  const latestChargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id || "";

  const amount = Number(paymentIntent?.amount || 0) || 0;

  return {
    stripe_payment_intent_id: safeStr(paymentIntent?.id || ""),
    payment_status: paymentStatus === "succeeded" ? "paid" : paymentStatus,
    status,
    stripe_charge_id: safeStr(latestChargeId),
    customer_email: safeStr(paymentIntent?.receipt_email || paymentIntent?.charges?.data?.[0]?.billing_details?.email || current?.customer_email || ""),
    customer_name: safeStr(paymentIntent?.charges?.data?.[0]?.billing_details?.name || current?.customer_name || ""),
    customer_phone: safeStr(paymentIntent?.shipping?.phone || current?.customer_phone || ""),
    amount_total_cents: amount || current?.amount_total_cents || 0,
    amount_total_mxn: (amount || current?.amount_total_cents || 0) / 100,
    updated_at: nowIso(),
    paid_at: paymentStatus === "succeeded" ? nowIso() : current?.paid_at || null,
    refunded_at: paymentStatus === "refunded" ? nowIso() : current?.refunded_at || null,
    metadata: paymentIntent?.metadata || current?.metadata || {},
  };
}

async function fetchOrderBySession(sb, orgId, sessionId) {
  const sid = safeStr(sessionId || "").trim();
  if (!sid) return null;

  let query = sb.from("orders").select("*").or(`checkout_session_id.eq.${sid},stripe_session_id.eq.${sid}`);
  if (orgId) query = query.or(`organization_id.eq.${orgId},org_id.eq.${orgId}`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function fetchOrderByPaymentIntent(sb, orgId, paymentIntentId) {
  const pi = safeStr(paymentIntentId || "").trim();
  if (!pi) return null;

  let query = sb.from("orders").select("*").eq("stripe_payment_intent_id", pi);
  if (orgId) query = query.or(`organization_id.eq.${orgId},org_id.eq.${orgId}`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateOrderById(sb, id, patch) {
  if (!id) return;
  const { error } = await sb.from("orders").update(patch).eq("id", id);
  if (error) throw error;
}

async function logWebhook(sb, row) {
  try {
    await sb.from("webhook_logs").insert(row);
  } catch (error) {
    console.error("[stripe_webhook] webhook log failed:", error?.message || error);
  }
}

async function notifyTelegram(message) {
  if (typeof sendTelegram !== "function") return;
  try {
    await sendTelegram(message);
  } catch {}
}

async function parseEvent(req, rawBody, stripe) {
  const sig = getStripeSignature(req);
  if (stripe && STRIPE_WEBHOOK_SECRET && sig) {
    return stripe.webhooks.constructEvent(
      rawBody,
      sig,
      STRIPE_WEBHOOK_SECRET
    );
  }

  const text = rawBody ? rawBody.toString("utf8") : "";
  if (!text) throw new Error("Empty webhook body");
  return JSON.parse(text);
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

    const sb = supabaseAdmin();
    if (!sb) {
      return send(res, jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin));
    }

    const stripe = initStripe();
    const rawBody = await readRawBody(req);
    const event = await parseEvent(req, rawBody, stripe);

    const orgId = await resolveScoreOrgId(sb).catch(() => "");
    const eventId = safeStr(event?.id || "");
    const eventType = safeStr(event?.type || "");

    let processed = false;

    switch (eventType) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const sessionId = safeStr(session?.id || "");
        const paymentIntent = session?.payment_intent
          ? await stripe.paymentIntents.retrieve(
              typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id,
              { expand: ["charges.data.balance_transaction"] }
            ).catch(() => null)
          : null;

        const order =
          (await fetchOrderBySession(sb, orgId, sessionId).catch(() => null)) ||
          null;

        const patch = buildOrderPatchFromSession(session);

        if (paymentIntent?.id) {
          Object.assign(patch, buildOrderPatchFromPaymentIntent(paymentIntent, null, order || patch));
        }

        if (order?.id) {
          await updateOrderById(sb, order.id, patch).catch((error) => {
            console.error("[stripe_webhook] order update failed:", error?.message || error);
          });
        } else {
          await sb.from("orders").upsert(
            {
              id: sessionId,
              checkout_session_id: sessionId,
              stripe_session_id: sessionId,
              organization_id: orgId,
              ...patch,
            },
            { onConflict: "checkout_session_id" }
          ).catch(() => {});
        }

        await logWebhook(sb, {
          id: eventId,
          source: "stripe",
          provider: "stripe",
          event_type: eventType,
          organization_id: orgId,
          order_id: order?.id || sessionId,
          stripe_session_id: sessionId,
          raw: event,
          created_at: nowIso(),
          updated_at: nowIso(),
        });

        await notifyTelegram(
          [
            "🧾 <b>Stripe webhook</b>",
            `Evento: ${eventType}`,
            `Sesión: ${sessionId}`,
            `Org: ${orgId || "N/D"}`,
          ].join("\n")
        );

        processed = true;
        break;
      }

      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const pi = event.data.object;
        const piId = safeStr(pi?.id || "");
        const order = await fetchOrderByPaymentIntent(sb, orgId, piId).catch(() => null);

        const patch = buildOrderPatchFromPaymentIntent(
          pi,
          null,
          order || {}
        );

        if (order?.id) {
          await updateOrderById(sb, order.id, patch).catch((error) => {
            console.error("[stripe_webhook] order update failed:", error?.message || error);
          });
        }

        await logWebhook(sb, {
          id: eventId,
          source: "stripe",
          provider: "stripe",
          event_type: eventType,
          organization_id: orgId,
          order_id: order?.id || piId,
          stripe_payment_intent_id: piId,
          raw: event,
          created_at: nowIso(),
          updated_at: nowIso(),
        });

        processed = true;
        break;
      }

      case "charge.succeeded":
      case "charge.refunded": {
        const charge = event.data.object;
        const piId = safeStr(charge?.payment_intent || "");
        const order = piId
          ? await fetchOrderByPaymentIntent(sb, orgId, piId).catch(() => null)
          : null;

        const paymentIntent = piId
          ? await stripe.paymentIntents.retrieve(piId, {
              expand: ["charges.data.balance_transaction"],
            }).catch(() => null)
          : null;

        const patch = paymentIntent
          ? buildOrderPatchFromPaymentIntent(paymentIntent, charge, order || {})
          : {
              stripe_charge_id: safeStr(charge?.id || ""),
              updated_at: nowIso(),
            };

        if (order?.id) {
          await updateOrderById(sb, order.id, patch).catch((error) => {
            console.error("[stripe_webhook] order update failed:", error?.message || error);
          });
        }

        await logWebhook(sb, {
          id: eventId,
          source: "stripe",
          provider: "stripe",
          event_type: eventType,
          organization_id: orgId,
          order_id: order?.id || piId || safeStr(charge?.id || ""),
          stripe_payment_intent_id: piId || null,
          stripe_charge_id: safeStr(charge?.id || ""),
          raw: event,
          created_at: nowIso(),
          updated_at: nowIso(),
        });

        processed = true;
        break;
      }

      default: {
        await logWebhook(sb, {
          id: eventId,
          source: "stripe",
          provider: "stripe",
          event_type: eventType || "unknown",
          organization_id: orgId,
          raw: event,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        processed = true;
        break;
      }
    }

    return send(
      res,
      jsonResponse(200, { ok: true, received: true, processed }, origin)
    );
  } catch (error) {
    console.error("[stripe_webhook] error:", error?.message || error);
    return send(res, jsonResponse(500, { ok: false, error: "stripe_webhook_failed" }, getOrigin(req)));
  }
}

module.exports = main;
module.exports.default = main;