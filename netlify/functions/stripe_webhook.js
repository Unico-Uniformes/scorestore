"use strict";

/**
 * =========================================================
 * stripe_webhook.js (Netlify Function)
 *
 * FIXES v2026-02-21:
 * - Manejo correcto de pagos "delayed" (OXXO): NO generar guía hasta pago confirmado.
 *   Stripe recomienda escuchar checkout.session.completed + checkout.session.async_payment_succeeded
 *   y opcional async_payment_failed. (docs: Checkout fulfillment)
 * - Persistencia segura en Supabase (orders + shipping_labels) con UPSERT (idempotente).
 * - Prevención de guías duplicadas: si ya existe tracking_number para stripe_session_id, no re-generar.
 * =========================================================
 */

const {
  jsonResponse,
  readRawBody,
  initStripe,
  isSupabaseConfigured,
  supabaseAdmin,
  createEnviaLabel,
  normalizeEnviaLabelResponse,
  sendTelegram,
} = require("./_shared");

const safeUpper = (v) => String(v || "").toUpperCase().trim();

const nowIso = () => new Date().toISOString();

const upsertOrder = async (sb, session, status) => {
  const meta = session.metadata || {};
  const customer = session.customer_details || {};
  const shipping = session.shipping_details || {};
  const addr = shipping.address || {};

  const row = {
    stripe_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_customer_id: session.customer || null,

    email: customer.email || session.customer_email || null,
    customer_name: customer.name || shipping.name || "Cliente",
    phone: customer.phone || null,

    currency: safeUpper(session.currency || "mxn"),
    amount_total_mxn: Number(session.amount_total || 0) / 100,
    amount_subtotal_mxn: Number(session.amount_subtotal || 0) / 100,
    amount_shipping_mxn: Number(meta.shipping_amount_cents || 0) / 100,
    promo_code: meta.promo_code || "Ninguno",
    items_summary: meta.items_summary || "Sin detalles",

    shipping_mode: meta.shipping_mode || null,
    postal_code: meta.postal_code || addr.postal_code || null,

    status,
    updated_at: nowIso(),

    metadata: {
      shipping_address: addr || null,
      // Para UnicOs: guardar raw_session completo puede ser grande, pero útil en auditoría.
      // Si quieres reducir tamaño, elimina raw_session.
      raw_session: session,
    },
  };

  // Idempotente por constraint UNIQUE(stripe_session_id)
  await sb.from("orders").upsert(row, { onConflict: "stripe_session_id" });
};

const getExistingLabel = async (sb, sessionId) => {
  try {
    const { data, error } = await sb
      .from("shipping_labels")
      .select("id, tracking_number, label_url, status")
      .eq("stripe_session_id", sessionId)
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
};

const upsertLabel = async (sb, sessionId, labelData, status = "created") => {
  const n = normalizeEnviaLabelResponse(labelData);
  const row = {
    stripe_session_id: sessionId,
    carrier: "envia",
    tracking_number: n.trackingNumber || null,
    label_url: n.labelUrl || null,
    status,
    updated_at: nowIso(),
    raw: n.raw || labelData || {},
  };
  await sb.from("shipping_labels").upsert(row, { onConflict: "stripe_session_id" });
};

const shouldFulfillNow = (eventType, session) => {
  // Para métodos instantáneos, checkout.session.completed suele llegar con payment_status=paid
  // Para métodos delayed (OXXO), debe llegar checkout.session.async_payment_succeeded cuando se confirma el pago.
  if (eventType === "checkout.session.async_payment_succeeded") return true;
  if (eventType === "checkout.session.completed") return String(session.payment_status) === "paid";
  return false;
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, "*");

    const stripe = initStripe();
    const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !whSecret) {
      console.log("[stripe_webhook] Missing signature or STRIPE_WEBHOOK_SECRET");
      // Responder 200 para que no reintente infinito en configuraciones incompletas.
      return jsonResponse(200, { received: true, warning: "Webhook secret missing" }, "*");
    }

    const buf = readRawBody(event);

    let evt;
    try {
      evt = stripe.webhooks.constructEvent(buf, sig, whSecret);
    } catch (err) {
      console.log("[stripe_webhook] Signature invalid:", err?.message || err);
      return jsonResponse(400, { received: false, error: "Invalid signature" }, "*");
    }

    const type = String(evt.type || "");
    const session = evt?.data?.object || {};
    if (!session?.id) return jsonResponse(200, { received: true }, "*");

    const meta = session.metadata || {};
    const shipping_mode = String(meta.shipping_mode || "pickup");
    const shipping_country = safeUpper(meta.shipping_country || session?.shipping_details?.address?.country || (shipping_mode === "envia_us" ? "US" : "MX"));
    const items_qty = Number(meta.items_qty || 0) || 0;

    // ---- Status mapping ----
    let orderStatus = "pending";

    if (type === "checkout.session.async_payment_failed") orderStatus = "payment_failed";
    else if (type === "checkout.session.async_payment_succeeded") orderStatus = "paid";
    else if (type === "checkout.session.completed") {
      orderStatus = String(session.payment_status) === "paid" ? "paid" : "pending_payment";
    } else {
      // Ignore other events (pero responde 200)
      return jsonResponse(200, { received: true, ignored: true }, "*");
    }

    // ---- Persist to Supabase (idempotente) ----
    if (isSupabaseConfigured()) {
      const sb = supabaseAdmin();
      if (sb) {
        try {
          await upsertOrder(sb, session, orderStatus);
        } catch (e) {
          console.log("[orders] warn upsert:", e?.message || e);
        }
      }
    }

    // ---- Fulfillment (Envía label) ----
    const shouldFulfill = shouldFulfillNow(type, session);
    const needsLabel = shipping_mode === "envia_mx" || shipping_mode === "envia_us";

    if (shouldFulfill && needsLabel) {
      const sb = isSupabaseConfigured() ? supabaseAdmin() : null;

      // Si tenemos Supabase, evitamos doble guía por reintentos.
      if (sb) {
        const existing = await getExistingLabel(sb, session.id);
        if (existing?.tracking_number || existing?.label_url) {
          try {
            await sendTelegram(
              `ℹ️ <b>Pago confirmado</b>\nSession: <code>${session.id}</code>\nModo: <b>${shipping_mode}</b>\nYa existe guía en sistema (no se re-generó).`
            );
          } catch {}
          return jsonResponse(200, { received: true }, "*");
        }
      }

      try {
        const labelData = await createEnviaLabel({ shipping_country, stripe_session: session, items_qty });
        if (sb) {
          try {
            await upsertLabel(sb, session.id, labelData, "created");
          } catch (e) {
            console.log("[shipping_labels] warn upsert:", e?.message || e);
          }
        }

        try {
          await sendTelegram(
            `✅ <b>Pago confirmado</b>\nSession: <code>${session.id}</code>\nModo: <b>${shipping_mode}</b>\nPaís: <b>${shipping_country}</b>\nGuía generada exitosamente en Envía.`
          );
        } catch {}
      } catch (e) {
        console.log("[envia] label error:", e?.message || e);

        if (isSupabaseConfigured()) {
          const sb2 = supabaseAdmin();
          if (sb2) {
            try {
              await upsertLabel(sb2, session.id, { error: String(e?.message || e) }, "failed");
            } catch {}
          }
        }

        try {
          await sendTelegram(
            `⚠️ <b>Pago confirmado</b> pero <b>falló la guía de Envía</b>\nSession: <code>${session.id}</code>\nError: <code>${String(e?.message || e).slice(0, 500)}</code>\n(Generar manual en UnicOs).`
          );
        } catch {}
      }
    } else {
      // Notificación: pago confirmado pickup o pago pendiente
      try {
        if (orderStatus === "paid" && shipping_mode === "pickup") {
          await sendTelegram(`✅ <b>Pago confirmado</b>\nSession: <code>${session.id}</code>\nModo: <b>pickup</b> (Recoger en fábrica)`);
        } else if (orderStatus === "pending_payment") {
          await sendTelegram(`🕒 <b>Pedido creado</b> (pago pendiente)\nSession: <code>${session.id}</code>\nMétodo: <b>${safeUpper(session.payment_method_types?.[0] || "N/A")}</b>\nEsperando confirmación de Stripe.`);
        } else if (orderStatus === "payment_failed") {
          await sendTelegram(`❌ <b>Pago fallido</b>\nSession: <code>${session.id}</code>\nSe requiere seguimiento del cliente.`);
        }
      } catch {}
    }

    return jsonResponse(200, { received: true }, "*");
  } catch (e) {
    console.log("[stripe_webhook] fatal:", e?.message || e);
    // Siempre 200 para evitar reintentos agresivos.
    return jsonResponse(200, { received: true, warning: String(e?.message || e) }, "*");
  }
};