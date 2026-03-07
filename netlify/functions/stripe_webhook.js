"use strict";

const { initStripe, jsonResponse, supabaseAdmin } = require("./_shared");

const DEFAULT_SCORE_ORG_ID = "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";

const safeStr = (v, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function rawBodyFromEvent(event) {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || "", "base64");
  }
  return Buffer.from(event.body || "", "utf8");
}

function pickOrgId(metadata) {
  const orgId = safeStr(metadata?.org_id || metadata?.organization_id || "").trim();
  return orgId || DEFAULT_SCORE_ORG_ID;
}

function pickShippingMode(sessionOrMeta) {
  return safeStr(
    sessionOrMeta?.metadata?.shipping_mode ||
    sessionOrMeta?.metadata?.ship_mode ||
    sessionOrMeta?.shipping_mode ||
    ""
  ).trim();
}

function pickPostalCode(sessionOrMeta) {
  return safeStr(
    sessionOrMeta?.metadata?.postal_code ||
    sessionOrMeta?.postal_code ||
    ""
  ).trim();
}

function normalizeAddress(address) {
  if (!address || typeof address !== "object") return null;
  return {
    line1: safeStr(address.line1 || ""),
    line2: safeStr(address.line2 || ""),
    city: safeStr(address.city || ""),
    state: safeStr(address.state || ""),
    postal_code: safeStr(address.postal_code || ""),
    country: safeStr(address.country || ""),
  };
}

function normalizeCustomer(session) {
  return {
    email: safeStr(session?.customer_details?.email || session?.customer_email || ""),
    name: safeStr(session?.customer_details?.name || session?.shipping_details?.name || "Cliente"),
    phone: safeStr(session?.customer_details?.phone || ""),
  };
}

function normalizeCurrency(v) {
  return safeStr(v || "mxn").toUpperCase();
}

async function listLineItems(stripe, sessionId) {
  try {
    const li = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      expand: ["data.price.product"],
    });

    return (Array.isArray(li?.data) ? li.data : [])
      .map((row) => {
        const productObj = row?.price?.product && typeof row.price.product === "object" ? row.price.product : null;
        const meta = productObj?.metadata || {};

        return {
          sku: safeStr(meta.sku || meta.SKU || ""),
          size: safeStr(meta.size || meta.talla || ""),
          name: safeStr(productObj?.name || row?.description || "Producto Oficial"),
          qty: safeNum(row?.quantity, 0),
          unit_amount_mxn: safeNum(row?.price?.unit_amount, 0) / 100,
          amount_total_mxn: safeNum(row?.amount_total, 0) / 100,
          currency: normalizeCurrency(row?.currency || "mxn"),
        };
      })
      .filter((x) => x.qty > 0);
  } catch {
    return [];
  }
}

async function upsertOrderFromSession(sb, stripe, session, extra = {}) {
  const orgId = pickOrgId(session?.metadata);
  const paymentIntentId =
    typeof session?.payment_intent === "string"
      ? session.payment_intent
      : safeStr(session?.payment_intent?.id || "");

  const customerId =
    typeof session?.customer === "string"
      ? session.customer
      : safeStr(session?.customer?.id || "");

  const totals = session?.total_details || {};
  const customer = normalizeCustomer(session);
  const items = await listLineItems(stripe, session.id);

  let amountRefundedMXN = 0;
  let stripeFeeMXN = null;
  let stripeNetMXN = null;
  let chargeId = null;
  let disputed = false;

  try {
    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge.balance_transaction"],
      });

      const charge = pi?.latest_charge || null;
      const bt = charge?.balance_transaction || null;

      chargeId = safeStr(charge?.id || "");
      amountRefundedMXN = safeNum(charge?.amount_refunded, 0) / 100;
      stripeFeeMXN = bt ? safeNum(bt?.fee, 0) / 100 : null;
      stripeNetMXN = bt ? safeNum(bt?.net, 0) / 100 : null;
      disputed = !!charge?.disputed;
    }
  } catch {}

  const paymentStatus = safeStr(session?.payment_status || "").toLowerCase();
  const currentStatus =
    extra?.forced_status ||
    (paymentStatus === "paid" ? "paid" : paymentStatus === "unpaid" ? "pending_payment" : "pending");

  const payload = {
    organization_id: orgId,
    stripe_session_id: safeStr(session?.id || ""),
    stripe_payment_intent_id: paymentIntentId || null,
    stripe_customer_id: customerId || null,
    stripe_charge_id: chargeId || null,

    email: customer.email || null,
    customer_name: customer.name || "Cliente",
    phone: customer.phone || null,

    currency: normalizeCurrency(session?.currency || "mxn"),
    amount_total_mxn: safeNum(session?.amount_total, 0) / 100,
    amount_subtotal_mxn: safeNum(session?.amount_subtotal, 0) / 100,
    amount_shipping_mxn: safeNum(totals?.amount_shipping, 0) / 100,
    amount_discount_mxn: safeNum(totals?.amount_discount, 0) / 100,
    amount_tax_mxn: safeNum(totals?.amount_tax, 0) / 100,

    refunded_mxn: amountRefundedMXN,
    stripe_fee_mxn: stripeFeeMXN,
    stripe_net_mxn: stripeNetMXN,
    disputed,

    shipping_total_mxn: safeNum(totals?.amount_shipping, 0) / 100,
    envia_cost_mxn:
      extra?.envia_cost_mxn != null
        ? safeNum(extra.envia_cost_mxn, 0)
        : null,

    shipping_status:
      extra?.shipping_status != null
        ? safeStr(extra.shipping_status)
        : null,

    tracking_number:
      extra?.tracking_number != null
        ? safeStr(extra.tracking_number)
        : null,

    carrier:
      extra?.carrier != null
        ? safeStr(extra.carrier)
        : null,

    shipment_status:
      extra?.shipment_status != null
        ? safeStr(extra.shipment_status)
        : null,

    status: currentStatus,
    items,
    metadata: {
      ...(session?.metadata || {}),
      shipping_mode: pickShippingMode(session),
      postal_code: pickPostalCode(session),
      shipping_address: normalizeAddress(session?.shipping_details?.address),
      shipping_name: safeStr(session?.shipping_details?.name || ""),
    },
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from("orders").upsert(payload, {
    onConflict: "stripe_session_id",
  });

  if (error) throw error;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const stripe = initStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return { statusCode: 500, body: "Missing STRIPE_WEBHOOK_SECRET" };
    }

    const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    if (!sig) {
      return { statusCode: 400, body: "Missing stripe-signature" };
    }

    const rawBody = rawBodyFromEvent(event);

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return { statusCode: 500, body: "Supabase not configured" };
    }

    const type = safeStr(stripeEvent?.type || "");
    const object = stripeEvent?.data?.object || {};

    if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
      const session = await stripe.checkout.sessions.retrieve(object.id, {
        expand: ["customer", "payment_intent", "shipping_details"],
      });

      await upsertOrderFromSession(sb, stripe, session, {
        forced_status: "paid",
      });
    }

    if (type === "checkout.session.async_payment_failed") {
      const session = await stripe.checkout.sessions.retrieve(object.id, {
        expand: ["customer", "payment_intent", "shipping_details"],
      });

      await upsertOrderFromSession(sb, stripe, session, {
        forced_status: "payment_failed",
      });
    }

    if (type === "charge.refunded") {
      const charge = object;
      const paymentIntentId = safeStr(charge?.payment_intent || "");
      if (paymentIntentId) {
        const { data: order } = await sb
          .from("orders")
          .select("stripe_session_id")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .limit(1)
          .maybeSingle();

        if (order?.stripe_session_id) {
          const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id, {
            expand: ["customer", "payment_intent", "shipping_details"],
          });

          await upsertOrderFromSession(sb, stripe, session, {
            forced_status: "refunded",
          });
        }
      }
    }

    if (type === "charge.dispute.created") {
      const charge = object;
      const paymentIntentId = safeStr(charge?.payment_intent || "");
      if (paymentIntentId) {
        await sb
          .from("orders")
          .update({
            disputed: true,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_payment_intent_id", paymentIntentId);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (e) {
    console.error("[stripe_webhook] error:", e?.message || e);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "stripe_webhook_failed" }),
    };
  }
};