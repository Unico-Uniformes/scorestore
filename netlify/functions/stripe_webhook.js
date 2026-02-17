"use strict";

const Stripe = require("stripe");

const {
  jsonResponse,
  handleOptions,
  readRawBody,
  createEnviaLabel,
  isEnviaConfigured,
  isSupabaseConfigured,
  supabase,
  supabaseAdmin,
  sendTelegram,
} = require("./_shared");

function pick(v, fb = "") {
  return String(v || fb || "");
}

function buildDestinationFromSession(session) {
  const ship = session?.shipping_details || {};
  const cust = session?.customer_details || {};

  const addr = ship?.address || cust?.address || {};

  return {
    name: pick(ship?.name || cust?.name, "Customer"),
    email: pick(cust?.email, ""),
    phone: pick(cust?.phone, ""),
    street: pick(addr?.line1, ""),
    number: "",
    district: pick(addr?.line2, ""),
    city: pick(addr?.city, ""),
    state: pick(addr?.state, ""),
    postal_code: pick(addr?.postal_code, ""),
    country_code: pick(addr?.country, "MX").toUpperCase(),
    reference: "",
  };
}

async function upsertOrder(db, payload) {
  // Best effort. Your schema may differ; this should not break webhooks.
  try {
    if (!db) return;

    // Prefer upsert if possible
    if (db?.from) {
      const { error } = await db
        .from("orders")
        .upsert(payload, { onConflict: "stripe_session_id" });
      if (!error) return;

      // Fallback: update then insert
      await db.from("orders").update(payload).eq("stripe_session_id", payload.stripe_session_id);
      await db.from("orders").insert(payload);
    }
  } catch (e) {
    console.warn("[orders upsert]", e?.message || e);
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return handleOptions();
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
    const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
    if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
      return jsonResponse(500, { ok: false, error: "Stripe webhook no configurado" });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"] || "";
    const raw = await readRawBody(event);

    let evt;
    try {
      evt = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      return jsonResponse(400, { ok: false, error: "Invalid signature", details: e?.message || String(e) });
    }

    const type = evt?.type || "";

    if (type === "checkout.session.completed") {
      const session = evt.data.object;
      const meta = session?.metadata || {};

      const shipping_mode = String(meta.shipping_mode || "").toLowerCase();
      const postal_code = String(meta.postal_code || "");
      const promo_code = String(meta.promo_code || "");
      const org_id = String(meta.org_id || "");
      const items_qty = Number(meta.items_qty || 1) || 1;

      const dest = buildDestinationFromSession(session);

      // Save / update order
      const db = supabaseAdmin || supabase;
      if (isSupabaseConfigured() && db) {
        await upsertOrder(db, {
          org_id: org_id || null,
          stripe_session_id: session.id,
          status: "paid",
          paid_at: new Date().toISOString(),
          currency: session.currency || "mxn",
          amount_total_cents: session.amount_total || null,
          amount_subtotal_cents: session.amount_subtotal || null,
          shipping_mode: shipping_mode || null,
          postal_code: postal_code || null,
          promo_code: promo_code || null,
          customer_email: session.customer_details?.email || null,
          customer_phone: session.customer_details?.phone || null,
          shipping_address: session.shipping_details?.address || session.customer_details?.address || null,
          shipping_name: session.shipping_details?.name || session.customer_details?.name || null,
        });
      }

      // Envia label only if needed
      let label = null;
      if (shipping_mode === "envia_mx" || shipping_mode === "envia_us") {
        if (isEnviaConfigured()) {
          label = await createEnviaLabel({
            stripe_session_id: session.id,
            destination: dest,
            meta: { items_qty },
          });

          // Persist label (best effort)
          try {
            if (isSupabaseConfigured() && db && label?.ok) {
              await db.from("shipping_labels").insert({
                org_id: org_id || null,
                stripe_session_id: session.id,
                created_at: new Date().toISOString(),
                carrier: label.carrier || null,
                tracking_number: label.tracking_number || null,
                label_url: label.label_url || null,
                raw: label.raw || null,
              });
            }
          } catch (e) {
            console.warn("[label insert]", e?.message || e);
          }
        } else {
          label = { ok: false, skipped: true, error: "ENVIA_API_KEY missing" };
        }
      }

      // Notify
      const msg =
        `✅ Pago confirmado\n` +
        `Session: ${session.id}\n` +
        `Total: ${(session.amount_total || 0) / 100} ${(session.currency || "MXN").toUpperCase()}\n` +
        `Entrega: ${shipping_mode || "pickup"} ${postal_code ? "(" + postal_code + ")" : ""}\n` +
        (label?.ok ? `📦 Label OK: ${label.tracking_number || ""}` : label ? `⚠️ Label: ${label.error || "skip"}` : "");

      await sendTelegram({ text: msg });

      return jsonResponse(200, { ok: true, received: true });
    }

    // Other events: accept
    return jsonResponse(200, { ok: true, received: true, type });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: "Webhook error", details: String(e?.message || e) });
  }
};
