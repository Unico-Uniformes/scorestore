"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  normalizeQty,
  itemsQtyFromAny,
  getBaseUrl,
  readJsonFile,
  validateZip,
  isUuid,
  safeStr,
  getEnviaQuote,
  getFallbackShipping,
  initStripe,
  makeCheckoutIdempotencyKey,
  resolveScoreOrgId,
  readPublicSiteSettings,
  sendTelegram,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP_DISPLAY,
} = require("./_shared");

const DEFAULT_CURRENCY = "MXN";
const MAX_ITEMS = 120;
const MAX_QTY_PER_ITEM = 99;

const { rateLimit } = require("./_rate_limit");
const { checkIdempotency, saveIdempotency } = require("./_idempotency");

// 🔒 Protección doble insert (memoria local)
const orderInsertLock = new Set();

function send(res, payload) {
  res.statusCode = payload.statusCode || 200;
  for (const [key, value] of Object.entries(payload.headers || {})) {
    res.setHeader(key, value);
  }
  res.end(payload.body || "");
}

function getOrigin(req) {
  return req?.headers?.origin || req?.headers?.Origin || "";
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

function clampInt(v, min, max, fallback = min) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeText(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? fallback : String(v);
  return s.trim();
}

function sanitizeItems(rawItems) {
  const items = normalizeQty(rawItems).slice(0, MAX_ITEMS);

  return items.map((it) => ({
    sku: normalizeText(it.sku).toUpperCase(),
    qty: clampInt(it.qty, 1, MAX_QTY_PER_ITEM, 1),
    size: normalizeText(it.size),
    priceCents: clampInt(it.priceCents, 0, 999999999),
    title: normalizeText(it.title),
  }));
}

// 🔥 PROMOS SEGURAS (DB manda)
function resolvePromoVerdict({ promoCode, subtotalCents }) {
  const promos = readJsonFile("data/promos.json") || { rules: [] };

  const code = normalizeText(promoCode).toUpperCase();
  const rule = promos.rules.find(
    (r) => r.code === code && r.active !== false
  );

  if (!rule) return { discount: 0 };

  let discount = 0;

  if (rule.type === "percent") {
    discount = Math.round(subtotalCents * Number(rule.value || 0));
  } else {
    discount = Math.round(Number(rule.value || 0) * 100);
  }

  return {
    discount: Math.min(discount, subtotalCents),
    code,
  };
}

async function lookupProducts(sb, items) {
  const skus = items.map((i) => i.sku);

  const { data } = await sb
    .from("products")
    .select("*")
    .in("sku", skus);

  const map = new Map();

  for (const p of data || []) {
    if (p.active === false || p.deleted_at) continue;
    map.set(p.sku.toUpperCase(), p);
  }

  return map;
}

// 🔥 PRECIO SOLO DESDE DB
function getPrice(product) {
  if (product.price_cents) return Number(product.price_cents);
  if (product.price_mxn) return Math.round(product.price_mxn * 100);
  return 0;
}

async function main(req, res) {
  const origin = getOrigin(req);

  try {
    // 🔥 RATE LIMIT
    const rl = rateLimit(req);
    if (!rl.ok) {
      return send(res, jsonResponse(429, { ok: false, error: rl.error }, origin));
    }

    // 🔥 IDEMPOTENCY
    const idemKey = req.headers["idempotency-key"];
    const idemCheck = checkIdempotency(idemKey);

    if (!idemCheck.ok) {
      return send(res, jsonResponse(200, idemCheck.cached, origin));
    }

    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false }, origin));
    }

    const body = getBody(req);
    const sb = supabaseAdmin();
    const stripe = initStripe();

    const orgId = await resolveScoreOrgId(sb, body.org_id);
    if (!isUuid(orgId)) throw new Error("Invalid org");

    const items = sanitizeItems(body.items);
    if (!items.length) throw new Error("Carrito vacío");

    const productMap = await lookupProducts(sb, items);

    let subtotal = 0;

    for (const item of items) {
      const product = productMap.get(item.sku);

      if (!product) throw new Error(`Producto no existe: ${item.sku}`);
      if (product.stock < item.qty) throw new Error(`Sin stock: ${item.sku}`);

      const price = getPrice(product);
      if (!price) throw new Error(`Precio inválido: ${item.sku}`);

      subtotal += price * item.qty;
    }

    const promo = resolvePromoVerdict({
      promoCode: body.promo_code,
      subtotalCents: subtotal,
    });

    const total = subtotal - promo.discount;

    const baseUrl = getBaseUrl(req);

    const lineItems = items.map((item) => {
      const product = productMap.get(item.sku);

      return {
        quantity: item.qty,
        price_data: {
          currency: "mxn",
          product_data: {
            name: product.name,
            metadata: {
              sku: item.sku,
              size: item.size,
            },
          },
          unit_amount: getPrice(product),
        },
      };
    });

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        success_url: `${baseUrl}/success.html`,
        cancel_url: `${baseUrl}/cancel.html`,
      },
      {
        idempotencyKey: makeCheckoutIdempotencyKey({ items, total }),
      }
    );

    // 🔒 PREVENCIÓN DOBLE INSERT
    if (!orderInsertLock.has(session.id)) {
      orderInsertLock.add(session.id);

      await sb.from("orders").insert([
        {
          stripe_session_id: session.id,
          total_cents: total,
          subtotal_cents: subtotal,
          discount_cents: promo.discount,
          items,
          created_at: new Date().toISOString(),
        },
      ]);
    }

    const responsePayload = {
      ok: true,
      checkout_url: session.url,
      session_id: session.id,
    };

    saveIdempotency(idemKey, responsePayload);

    // 📲 TELEGRAM
    if (sendTelegram) {
      await sendTelegram(`🛒 Nuevo checkout: ${session.id}`);
    }

    return send(res, jsonResponse(200, responsePayload, origin));
  } catch (err) {
    return send(
      res,
      jsonResponse(500, { ok: false, error: err.message }, origin)
    );
  }
}

module.exports = main;