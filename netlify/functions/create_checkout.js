"use strict";

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  clampInt,
  normalizeQty,
  itemsQtyFromAny,
  getBaseUrl,
  validateZip,
  getCatalogIndex,
  getEnviaQuote,
  getFallbackShipping,
  initStripe,
  isSupabaseConfigured,
  supabaseAdmin,
} = require("./_shared");

exports.handler = async (event) => {
  const origin = event?.headers?.origin;

  try {
    if (event.httpMethod === "OPTIONS") return handleOptions(event);
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);

    const stripe = initStripe();
    const baseUrl = getBaseUrl(event);

    const body = safeJsonParse(event.body) || {};
    const items = normalizeQty(body.items);
    const shipping_mode = String(body.shipping_mode || "pickup").trim(); // pickup | envia_mx | envia_us
    const postal_code = String(body.postal_code || "").trim();
    const promo_code = String(body.promo_code || "").trim();

    if (!items.length) return jsonResponse(400, { ok: false, error: "Carrito vacío" }, origin);

    // Cargar catálogo real (server-side) para evitar manipulación de precios
    const { index } = getCatalogIndex();

    const line_items = [];
    for (const it of items) {
      const p = index.get(it.sku);
      if (!p) return jsonResponse(400, { ok: false, error: `SKU inválido: ${it.sku}` }, origin);

      const title = String(p?.title || p?.name || "Producto").trim();
      const priceCents = Number.isFinite(Number(p?.price_cents))
        ? Math.round(Number(p.price_cents))
        : 0;

      if (!priceCents || priceCents < 0) return jsonResponse(400, { ok: false, error: `Precio inválido para ${it.sku}` }, origin);

      const desc = it.size ? `${title} · Talla ${it.size}` : title;

      line_items.push({
        quantity: clampInt(it.qty, 1, 99),
        price_data: {
          currency: "mxn",
          unit_amount: priceCents,
          product_data: {
            name: desc,
          },
        },
      });
    }

    const items_qty = itemsQtyFromAny(items);
    let shipping = { ok: true, provider: "pickup", label: "Recoger en fábrica (Tijuana)", country: "MX", amount_cents: 0, amount_mxn: 0 };

    if (shipping_mode === "envia_mx" || shipping_mode === "envia_us") {
      const country = shipping_mode === "envia_us" ? "US" : "MX";
      const zip = validateZip(postal_code, country);
      if (!zip) return jsonResponse(400, { ok: false, error: "CP/ZIP inválido" }, origin);

      try {
        shipping = await getEnviaQuote({ zip, country, items_qty });
      } catch (e) {
        shipping = { ...getFallbackShipping(country, items_qty), warning: String(e?.message || e) };
      }
    }

    // Stripe Checkout Session
    const sessionPayload = {
      mode: "payment",
      payment_method_types: ["card", "oxxo"],
      line_items,
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/index.html#catalog`,
      metadata: {
        shipping_mode,
        postal_code: postal_code || "",
        promo_code: promo_code || "",
        items_qty: String(items_qty || 0),
        items: JSON.stringify(items).slice(0, 4500),
        shipping_label: String(shipping.label || ""),
        shipping_provider: String(shipping.provider || ""),
        shipping_country: String(shipping.country || ""),
        shipping_amount_cents: String(shipping.amount_cents || 0),
      },
    };

    // Si es envío, Stripe debe pedir dirección (y el webhook la usa para generar guía)
    if (shipping_mode === "envia_mx") {
      sessionPayload.shipping_address_collection = { allowed_countries: ["MX"] };
    } else if (shipping_mode === "envia_us") {
      sessionPayload.shipping_address_collection = { allowed_countries: ["US"] };
    }

    // Mostrar costo de envío dentro de Stripe
    if ((shipping_mode === "envia_mx" || shipping_mode === "envia_us") && Number(shipping.amount_cents || 0) > 0) {
      sessionPayload.shipping_options = [
        {
          shipping_rate_data: {
            display_name: shipping.label || (shipping_mode === "envia_us" ? "Envío USA" : "Envío México"),
            fixed_amount: { amount: Number(shipping.amount_cents), currency: "mxn" },
            type: "fixed_amount",
          },
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    // (Opcional) guardar “pre-order” como pending (no rompe si no hay tabla)
    if (isSupabaseConfigured()) {
      const sb = supabaseAdmin();
      if (sb) {
        try {
          await sb.from("orders").insert({
            stripe_session_id: session.id,
            status: "pending",
            shipping_mode,
            postal_code: postal_code || null,
            shipping_amount_cents: Number(shipping.amount_cents || 0),
            items,
          });
        } catch (e) {
          console.log("[orders] warn insert pending:", e?.message || e);
        }
      }
    }

    return jsonResponse(200, { ok: true, url: session.url, id: session.id }, origin);
  } catch (e) {
    return jsonResponse(500, { ok: false, error: String(e?.message || e) }, origin);
  }
};