// netlify/functions/create_checkout.js
// SCORE STORE — Stripe Checkout (PROD)

const Stripe = require("stripe");
const fs = require("fs");
const path = require("path");

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  baseUrl,
  normalizeZip,
  normalizeQty,
  quoteShipping,
} = require("./_shared");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function encodeUrl(u) {
  try { return encodeURI(String(u || "")); } catch { return String(u || ""); }
}

function defaultPriceByType(type) {
  const t = String(type || "tee").toLowerCase();
  if (t === "cap") return 290;
  if (t === "shirt") return 690;
  if (t === "hoodie") return 890;
  if (t === "jacket") return 1290;
  return 390;
}

function toCentsMXN(mxn) {
  const n = Number(mxn);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function readJson(relPath) {
  const abs = path.join(process.cwd(), relPath);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function findPromoRule(promosDb, codeRaw) {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!code) return null;

  const rules = Array.isArray(promosDb?.rules) ? promosDb.rules : [];
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
      apiVersion: "2023-10-16",
    });

    const origin = baseUrl(event);
    if (!origin) {
      return jsonResponse(400, { ok: false, error: "No se pudo determinar el origen del sitio." });
    }

    const body = safeJsonParse(event.body);
    const itemsIn = Array.isArray(body?.items) ? body.items : [];
    if (!itemsIn.length) return jsonResponse(400, { ok: false, error: "Carrito vacío." });

    const shipping_mode = String(body?.shipping_mode || "pickup").trim();
    const postal_code = normalizeZip(body?.postal_code || "");
    const promo_code = String(body?.promo_code || "").trim().toUpperCase();

    const catalog = readJson("data/catalog.json");
    const products = Array.isArray(catalog?.products) ? catalog.products : [];
    const skuMap = new Map(
      products
        .filter((p) => p && (p.sku || p.id))
        .map((p) => [String(p.sku || p.id), p])
    );

    const line_items = [];
    const compactItems = [];

    for (const it of itemsIn) {
      const qty = normalizeQty(it?.qty ?? it?.quantity ?? 1);
      const sku = String(it?.sku || it?.id || "").trim();
      if (!sku) continue;

      const p = skuMap.get(sku);
      if (!p) return jsonResponse(400, { ok: false, error: `Producto inválido (SKU: ${sku}).` });

      const name = String(p.name || it?.name || "Producto");
      const type = String(p.type || it?.type || "tee");

      const price_mxn =
        typeof p.price === "number" && Number.isFinite(p.price)
          ? p.price
          : typeof p.price_mxn === "number" && Number.isFinite(p.price_mxn)
          ? p.price_mxn
          : typeof p.price_cents === "number" && Number.isFinite(p.price_cents)
          ? p.price_cents / 100
          : defaultPriceByType(type);

      const unit_amount = toCentsMXN(price_mxn);

      const imgRel = String(p.img || it?.img || "");
      const imgAbs = imgRel
        ? new URL(encodeUrl(imgRel.startsWith("/") ? imgRel : `/${imgRel}`), origin).toString()
        : null;

      line_items.push({
        quantity: qty,
        price_data: {
          currency: "mxn",
          unit_amount,
          product_data: {
            name,
            images: imgAbs ? [imgAbs] : [],
            metadata: {
              sku,
              type,
              size: String(it?.size || ""),
            },
          },
        },
      });

      compactItems.push({ sku, qty, size: String(it?.size || ""), name });
    }

    if (!line_items.length) return jsonResponse(400, { ok: false, error: "No se pudieron validar productos." });

    let shipping_amount_cents = 0;
    let shipping_label = "Pickup";
    let address_collection = null;

    if (shipping_mode === "pickup") {
      shipping_amount_cents = 0;
      shipping_label = "Pickup (fábrica)";
      address_collection = null;
    } else if (shipping_mode === "local_tj") {
      shipping_amount_cents = 0;
      shipping_label = "Envío local TJ (Uber/Didi)";
      address_collection = { allowed_countries: ["MX"] };
    } else if (shipping_mode === "envia_mx" || shipping_mode === "envia_us") {
      if (!postal_code) return jsonResponse(400, { ok: false, error: "Código postal requerido para Envia." });

      const quote = await quoteShipping({
        mode: shipping_mode,
        postal_code,
        items: compactItems.map((x) => ({ qty: x.qty })),
      });

      if (!quote?.ok) {
        return jsonResponse(400, { ok: false, error: quote?.error || "No se pudo cotizar envío. Intenta de nuevo." });
      }

      shipping_amount_cents = Number(quote.amount_cents || 0);
      shipping_label = `${quote.carrier || "Envia"} · ${quote.service || "Envío"}`;
      address_collection = { allowed_countries: [shipping_mode === "envia_us" ? "US" : "MX"] };
    } else {
      return jsonResponse(400, { ok: false, error: "Modo de entrega inválido." });
    }

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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      discounts,

      phone_number_collection: { enabled: true },
      customer_creation: "if_required",

      shipping_address_collection: address_collection || undefined,

      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shipping_amount_cents, currency: "mxn" },
            display_name: shipping_label,
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 8 },
            },
          },
        },
      ],

      allow_promotion_codes: false,

      metadata: {
        source: "scorestore",
        shipping_mode,
        postal_code: postal_code || "",
        promo_code: promoApplied?.code || "",
        promo_type: promoApplied?.type || "",
      },

      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    return jsonResponse(200, { ok: true, url: session.url });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { ok: false, error: err?.message || "Error creando checkout." });
  }
};
