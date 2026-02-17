// netlify/functions/create_checkout.js
// SCORE STORE — Stripe Checkout (PROD)
// ⚠️ NO pongas llaves secretas en el repo. Usa Netlify Environment Variables.

const Stripe = require("stripe");
const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  baseUrl,
  encodeUrl,
  normalizeZip,
  normalizeQty,
  readJson,
  getEnviaQuote,
} = require("./_shared");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function toCentsMXN(mxn) {
  const n = Number(mxn);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function findPromoRule(promosDb, codeRaw) {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!code) return null;

  const rules = Array.isArray(promosDb?.rules)
    ? promosDb.rules
    : Array.isArray(promosDb?.promos)
    ? promosDb.promos
    : [];

  const rule = rules.find(
    (r) => String(r?.code || "").trim().toUpperCase() === code && r?.active
  );
  if (!rule) return null;

  const type = String(rule.type || "").toLowerCase();

  if (type === "percent") {
    const v = Number(rule.value);
    const pct = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    return { ...rule, code, type: "percent", value: pct };
  }

  if (type === "fixed_mxn") {
    const v = Number(rule.value);
    const mxn = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
    return { ...rule, code, type: "fixed_mxn", value: mxn };
  }

  if (type === "free_shipping") {
    return { ...rule, code, type: "free_shipping", value: 1 };
  }

  return null;
}

async function createOneTimeCoupon(stripe, rule) {
  const meta = {
    source: "scorestore",
    promo_code: rule.code,
    description: String(rule.description || "").slice(0, 450),
  };

  if (rule.type === "percent") {
    const pct = Math.round(Number(rule.value) * 100);
    if (!pct || pct <= 0) return null;
    return stripe.coupons.create({
      duration: "once",
      percent_off: pct,
      name: rule.code,
      metadata: meta,
    });
  }

  if (rule.type === "fixed_mxn") {
    const cents = toCentsMXN(rule.value);
    if (!cents || cents <= 0) return null;
    return stripe.coupons.create({
      duration: "once",
      amount_off: cents,
      currency: "mxn",
      name: rule.code,
      metadata: meta,
    });
  }

  return null;
}

exports.handler = async (event) => {
  const opt = handleOptions(event);
  if (opt) return opt;

  try {
    const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2024-06-20",
    });

    const origin = baseUrl(event);
    if (!origin) {
      return jsonResponse(400, {
        ok: false,
        error: "No se pudo determinar el origen del sitio.",
      });
    }

    const body = safeJsonParse(event.body);

    const itemsIn = Array.isArray(body?.items) ? body.items : [];
    if (!itemsIn.length) {
      return jsonResponse(400, { ok: false, error: "Carrito vacío." });
    }

    const shipping_mode = String(body?.shipping_mode || "pickup").trim();
    const postal_code = normalizeZip(body?.postal_code || "");
    const promo_code = String(body?.promo_code || "").trim().toUpperCase();

    // Catálogo
    const catalog = readJson("data/catalog.json");
    const products = Array.isArray(catalog?.products) ? catalog.products : [];

    const skuMap = new Map(
      products
        .filter((p) => p && (p.sku || p.id))
        .map((p) => [String(p.sku || p.id), p])
    );

    const line_items = [];
    let items_qty = 0;

    for (const it of itemsIn) {
      const qty = normalizeQty(it?.qty ?? it?.quantity ?? 1);
      const sku = String(it?.sku || it?.id || "").trim();
      if (!sku) continue;

      const p = skuMap.get(sku);
      if (!p) {
        return jsonResponse(400, {
          ok: false,
          error: `Producto inválido (SKU: ${sku}).`,
        });
      }

      const name = String(p.name || it?.name || "Producto");
      const type = String(p.type || "tee");
      const size = String(it?.size || "");

      const price_cents =
        typeof p.price_cents === "number" && Number.isFinite(p.price_cents)
          ? Math.max(0, Math.round(p.price_cents))
          : typeof p.baseMXN === "number" && Number.isFinite(p.baseMXN)
          ? toCentsMXN(p.baseMXN)
          : typeof p.price_mxn === "number" && Number.isFinite(p.price_mxn)
          ? toCentsMXN(p.price_mxn)
          : 0;

      if (!price_cents) {
        return jsonResponse(400, {
          ok: false,
          error: `Producto sin precio configurado (SKU: ${sku}).`,
        });
      }

      const imgRel = String(p.img || it?.img || "");
      const imgAbs = imgRel
        ? new URL(encodeUrl(imgRel.startsWith("/") ? imgRel : `/${imgRel}`), origin).toString()
        : null;

      line_items.push({
        quantity: qty,
        price_data: {
          currency: "mxn",
          unit_amount: price_cents,
          product_data: {
            name,
            images: imgAbs ? [imgAbs] : [],
            metadata: { sku, type, size },
          },
        },
      });

      items_qty += qty;
    }

    if (!line_items.length) {
      return jsonResponse(400, { ok: false, error: "No se pudieron validar productos." });
    }

    // Entrega / envío
    let shipping_amount_cents = 0;
    let shipping_label = "Pickup (fábrica)";
    let address_collection = null;

    if (shipping_mode === "pickup") {
      shipping_amount_cents = 0;
      shipping_label = "Pickup (fábrica)";
      address_collection = null;
    } else if (shipping_mode === "local_tj") {
      shipping_amount_cents = 0;
      shipping_label = "Local TJ (Uber/Didi)";
      address_collection = { allowed_countries: ["MX"] };
    } else if (shipping_mode === "envia_mx" || shipping_mode === "envia_us") {
      if (!postal_code) {
        return jsonResponse(400, { ok: false, error: "Código postal requerido para Envia." });
      }

      const quote = await getEnviaQuote({
        mode: shipping_mode,
        postal_code,
        items_qty: items_qty || Number(body?.items_qty || 1),
      });

      if (!quote?.ok) {
        return jsonResponse(400, { ok: false, error: quote?.error || "No se pudo cotizar envío." });
      }

      shipping_amount_cents = Number(quote.amount_cents || 0);
      shipping_label = `${quote.carrier || "Envia"} · ${quote.service || "Envío"}`;
      address_collection = { allowed_countries: [shipping_mode === "envia_us" ? "US" : "MX"] };
    } else {
      return jsonResponse(400, { ok: false, error: "Modo de entrega inválido." });
    }

    // Promos
    let discounts = undefined;
    let promoApplied = null;

    if (promo_code) {
      const promosDb = readJson("data/promos.json");
      const rule = findPromoRule(promosDb, promo_code);
      if (rule) {
        promoApplied = rule;
        if (rule.type === "free_shipping") {
          shipping_amount_cents = 0;
        } else {
          const coupon = await createOneTimeCoupon(stripe, rule);
          if (coupon?.id) discounts = [{ coupon: coupon.id }];
        }
      }
    }

    const sessionPayload = {
      mode: "payment",
      line_items,

      automatic_payment_methods: { enabled: true },
      phone_number_collection: { enabled: true },
      customer_creation: "if_required",

      allow_promotion_codes: false,
      discounts,

      metadata: {
        source: "scorestore",
        shipping_mode,
        postal_code: postal_code || "",
        promo_code: promoApplied?.code || "",
        promo_type: promoApplied?.type || "",
      },

      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    };

    if (address_collection) {
      sessionPayload.shipping_address_collection = address_collection;

      sessionPayload.shipping_options = [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: Math.max(0, Math.round(shipping_amount_cents)), currency: "mxn" },
            display_name: shipping_label,
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 8 },
            },
          },
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);
    return jsonResponse(200, { ok: true, url: session.url });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { ok: false, error: err?.message || "Error creando checkout." });
  }
};
