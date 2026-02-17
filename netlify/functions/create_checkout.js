"use strict";

const Stripe = require("stripe");

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  validateZip,
  normalizeQty,
  itemsQtyFromAny,
  getEnviaQuote,
  getFallbackShipping,
  getOrgIdFromEvent,
  isSupabaseConfigured,
  supabase,
  supabaseAdmin,
  readJson,
  baseUrl,
  encodeUrl,
} = require("./_shared");

function normCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function toCentsFromCatalog(p) {
  if (Number.isFinite(p?.price_cents)) return Math.round(Number(p.price_cents));
  if (Number.isFinite(p?.baseMXN)) return Math.round(Number(p.baseMXN) * 100);
  return 0;
}

function clampSize(s) {
  const t = String(s || "").trim().slice(0, 12);
  return t || "M";
}

async function getOrCreateCoupon(stripe, promo) {
  const code = normCode(promo?.code);
  if (!code) return null;

  const cid = `PROMO_${code}`.slice(0, 50);

  try {
    const existing = await stripe.coupons.retrieve(cid);
    if (existing && !existing.deleted) return existing.id;
  } catch {
    // ignore
  }

  const params = {
    id: cid,
    name: code,
    duration: "once",
    metadata: { source: "scorestore", promo_code: code },
  };

  if (promo.type === "percent") {
    const raw = Number(promo.value || 0);
    const percent = raw <= 1 ? raw * 100 : raw;
    params.percent_off = Math.max(1, Math.min(100, Math.round(percent)));
  } else if (promo.type === "fixed_mxn") {
    params.amount_off = Math.max(1, Math.round(Number(promo.value || 0) * 100));
    params.currency = "mxn";
  } else {
    return null;
  }

  const created = await stripe.coupons.create(params);
  return created.id;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return handleOptions();
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
    if (!STRIPE_SECRET_KEY) {
      return jsonResponse(500, { ok: false, error: "STRIPE_SECRET_KEY no configurada" });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const body = safeJsonParse(event.body);
    const itemsIn = Array.isArray(body.items) ? body.items : [];
    if (!itemsIn.length) return jsonResponse(400, { ok: false, error: "Carrito vacio" });

    const shipping_mode = String(body.shipping_mode || "pickup").toLowerCase();
    const postal_code = String(body.postal_code || "").trim();
    const promo_code = normCode(body.promo_code || "");

    const org_id = getOrgIdFromEvent(event);

    // Load catalog
    const catalog = readJson("data/catalog.json");
    const prods = Array.isArray(catalog?.products) ? catalog.products : [];

    const skuMap = new Map(
      prods.map((p) => {
        const sku = String(p.sku || p.id || "").trim();
        return [sku, { ...p, sku, price_cents: toCentsFromCatalog(p) }];
      })
    );

    const siteBase = baseUrl(event);

    // Build line items
    const line_items = [];
    for (const it of itemsIn) {
      const sku = String(it?.sku || "").trim();
      const qty = normalizeQty(it?.qty);
      const size = clampSize(it?.size);

      const p = skuMap.get(sku);
      if (!p) return jsonResponse(400, { ok: false, error: `SKU invalido: ${sku}` });
      if (!p.price_cents) return jsonResponse(400, { ok: false, error: `Producto sin precio: ${sku}` });

      line_items.push({
        quantity: qty,
        price_data: {
          currency: "mxn",
          unit_amount: p.price_cents,
          product_data: {
            name: String(p.name || "Producto").slice(0, 250),
            description: size ? `Talla: ${size}` : undefined,
            images: p.img ? [encodeUrl(siteBase, p.img)] : undefined,
            metadata: {
              sku: p.sku,
              product_id: String(p.id || ""),
              size,
              section: String(p.sectionId || ""),
            },
          },
        },
      });
    }

    const items_qty = itemsQtyFromAny(itemsIn);

    // Shipping
    let shippingAmountCents = 0;
    let shippingLabel = "";
    let shippingCountry = "MX";

    if (shipping_mode === "envia_mx" || shipping_mode === "envia_us") {
      if (!validateZip(postal_code)) return jsonResponse(400, { ok: false, error: "Codigo postal invalido" });
      shippingCountry = shipping_mode === "envia_us" ? "US" : "MX";

      let quote = await getEnviaQuote({ zip: postal_code, country: shippingCountry, items_qty });
      if (!quote?.ok || !(Number(quote?.amount_mxn) > 0)) {
        quote = getFallbackShipping(shippingCountry, items_qty);
      }

      const mxn = Number(quote?.amount_mxn || 0) || 0;
      shippingAmountCents = Math.max(0, Math.round(mxn * 100));
      shippingLabel = String(quote?.label || "Standard");
    }

    if (shipping_mode === "pickup") {
      shippingAmountCents = 0;
      shippingCountry = "MX";
      shippingLabel = "Pickup";
    }

    if (shipping_mode === "local_tj") {
      // Uber/Didi / mensajeria local (se coordina). Si quieres cobrar fijo: define LOCAL_TJ_FLAT_MXN.
      const flat = Number(process.env.LOCAL_TJ_FLAT_MXN || 0) || 0;
      shippingAmountCents = Math.max(0, Math.round(flat * 100));
      shippingCountry = "MX";
      shippingLabel = "Local TJ";
    }

    // Promo
    let couponId = null;
    if (promo_code) {
      const promosDb = readJson("data/promos.json");
      const rules = Array.isArray(promosDb?.rules)
        ? promosDb.rules
        : Array.isArray(promosDb?.promos)
        ? promosDb.promos
        : [];

      const promo = rules.find(
        (p) => normCode(p?.code) === promo_code && (p?.active === true || p?.active === 1)
      );

      if (!promo) return jsonResponse(400, { ok: false, error: "Codigo promocional invalido" });

      const subtotalMxn = line_items.reduce((sum, li) => sum + (li.price_data.unit_amount * li.quantity) / 100, 0);
      const min = Number(promo?.min_subtotal_mxn || 0) || 0;
      if (min > 0 && subtotalMxn < min) {
        return jsonResponse(400, { ok: false, error: `Minimo ${min} MXN para aplicar` });
      }

      if (promo.type === "free_shipping") {
        shippingAmountCents = 0;
      } else if (promo.type === "percent" || promo.type === "fixed_mxn") {
        couponId = await getOrCreateCoupon(stripe, promo);
      }
    }

    // Session params
    const params = {
      mode: "payment",
      locale: "es",
      payment_method_types: ["card", "oxxo"],
      line_items,
      success_url: `${siteBase}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBase}/cancel.html`,
      phone_number_collection: { enabled: true },
      customer_creation: "if_required",
      metadata: {
        source: "scorestore",
        org_id,
        shipping_mode,
        postal_code: postal_code || "",
        promo_code: promo_code || "",
        items_qty: String(items_qty),
        shipping_label: shippingLabel || "",
      },
    };

    if (couponId) params.discounts = [{ coupon: couponId }];

    // Shipping UI in Stripe (only when user expects shipping)
    if (shipping_mode !== "pickup") {
      params.shipping_address_collection = {
        allowed_countries:
          shipping_mode === "envia_us" ? ["US"] : shipping_mode === "envia_mx" ? ["MX"] : ["MX"],
      };

      // Show shipping rate in Stripe if > 0
      if (shippingAmountCents > 0) {
        params.shipping_options = [
          {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: { amount: shippingAmountCents, currency: "mxn" },
              display_name:
                shipping_mode === "envia_us"
                  ? `Envio USA (Envia${shippingLabel ? " - " + shippingLabel : ""})`
                  : shipping_mode === "envia_mx"
                  ? `Envio Nacional (Envia${shippingLabel ? " - " + shippingLabel : ""})`
                  : `Local TJ (${shippingLabel || "a coordinar"})`,
              metadata: {
                shipping_mode,
                postal_code: postal_code || "",
                provider: shipping_mode.startsWith("envia") ? "envia" : "local",
              },
            },
          },
        ];
      }
    }

    const session = await stripe.checkout.sessions.create(params);

    // Supabase optional insert
    try {
      if (isSupabaseConfigured() && (supabaseAdmin || supabase)) {
        const db = supabaseAdmin || supabase;
        await db.from("orders").insert({
          org_id,
          created_at: new Date().toISOString(),
          stripe_session_id: session.id,
          status: "checkout_created",
          shipping_mode,
          postal_code: postal_code || null,
          promo_code: promo_code || null,
          items: itemsIn,
        });
      }
    } catch (e) {
      // Do not block checkout if DB insert fails
      console.warn("[orders insert]", e?.message || e);
    }

    return jsonResponse(200, { ok: true, url: session.url, session_id: session.id });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: "Error creando checkout", details: String(e?.message || e) });
  }
};
