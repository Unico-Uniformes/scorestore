"use strict";

const shared = require("./_shared");

const jsonResponse = shared.jsonResponse;
const handleOptions = shared.handleOptions;
const supabaseAdmin = shared.supabaseAdmin;
const getCatalogIndex = shared.getCatalogIndex;
const initStripe = shared.initStripe;
const makeCheckoutIdempotencyKey = shared.makeCheckoutIdempotencyKey;
const normalizeQty = shared.normalizeQty || ((items) => (Array.isArray(items) ? items : []));
const itemsQtyFromAny =
  shared.itemsQtyFromAny ||
  ((items) => (Array.isArray(items) ? items.reduce((s, i) => s + Number(i?.qty || 0), 0) : 0));
const readJsonFile = shared.readJsonFile;
const safeStr = shared.safeStr || ((v, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d));
const sendTelegram = shared.sendTelegram;
const getFallbackShipping = shared.getFallbackShipping;
const getEnviaQuote = shared.getEnviaQuote;
const resolveScoreOrgId = shared.resolveScoreOrgId;

const withNoStore = (resp) => {
  const out = resp || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"] = "no-cache";
  out.headers["Expires"] = "0";
  return out;
};

const send = (res, resp) => {
  const out = withNoStore(resp);
  if (out.headers) {
    Object.keys(out.headers).forEach((key) => res.setHeader(key, out.headers[key]));
  }
  res.status(out.statusCode || 200).send(out.body);
};

const parseBody = (req) => {
  if (!req) return {};
  if (req.body && typeof req.body === "object") return req.body;

  const raw = typeof req.body === "string" ? req.body : "";
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const clampInt = (v, min, max) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

const moneyToCents = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

const cleanCode = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");

const loadPromoRules = () => {
  try {
    const json = readJsonFile ? readJsonFile("data/promos.json") : null;
    const source = json && typeof json === "object" ? json : {};
    const rules = Array.isArray(source.rules) ? source.rules : Array.isArray(source.promos) ? source.promos : [];
    return rules
      .filter(Boolean)
      .map((rule) => ({
        code: cleanCode(rule.code),
        type: String(rule.type || "").trim().toLowerCase(),
        value: Number(rule.value || 0),
        description: String(rule.description || "").trim(),
        active: rule.active == null ? true : !!rule.active,
        min_amount_mxn: Number(rule.min_amount_mxn || 0) || 0,
        expires_at: rule.expires_at || null,
      }))
      .filter((rule) => rule.code);
  } catch {
    return [];
  }
};

const findPromo = (body) => {
  const code = cleanCode(
    body?.promo?.code ||
      body?.promo_code ||
      body?.coupon ||
      body?.coupon_code ||
      body?.discount_code ||
      ""
  );

  if (!code) return null;

  const rules = loadPromoRules();
  const found = rules.find((r) => cleanCode(r.code) === code) || null;
  if (!found) return null;

  return found;
};

const isExpired = (promo) => {
  if (!promo?.expires_at) return false;
  const d = new Date(promo.expires_at);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
};

const computePromo = (promo, subtotalCents) => {
  if (!promo) return { promo: null, discount_cents: 0, free_shipping: false };
  if (!promo.active) return { promo: null, discount_cents: 0, free_shipping: false };
  if (isExpired(promo)) return { promo: null, discount_cents: 0, free_shipping: false };

  if (subtotalCents < moneyToCents(promo.min_amount_mxn || 0)) {
    return { promo: null, discount_cents: 0, free_shipping: false };
  }

  const type = String(promo.type || "").toLowerCase();
  if (["free_shipping", "freeshipping"].includes(type)) {
    return { promo, discount_cents: 0, free_shipping: true };
  }

  if (["percent", "percentage", "percent_off"].includes(type)) {
    const raw = Number(promo.value || 0);
    const rate = raw > 1 ? raw / 100 : raw;
    const discount = Math.round(subtotalCents * (Number.isFinite(rate) ? rate : 0));
    return { promo, discount_cents: Math.max(0, Math.min(subtotalCents, discount)), free_shipping: false };
  }

  if (["fixed", "fixed_mxn", "fixed_off"].includes(type)) {
    const discount = moneyToCents(promo.value || 0);
    return { promo, discount_cents: Math.max(0, Math.min(subtotalCents, discount)), free_shipping: false };
  }

  return { promo: null, discount_cents: 0, free_shipping: false };
};

const normalizeText = (s) => String(s ?? "").trim();
const normalizeUrl = (u) => {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  return s.startsWith("/") ? s : `/${s}`;
};

const getCatalogMap = () => {
  try {
    const out = typeof getCatalogIndex === "function" ? getCatalogIndex() : null;
    if (out?.index instanceof Map) return out.index;
    if (out?.index && typeof out.index === "object") return new Map(Object.entries(out.index));
  } catch {}
  const raw = readJsonFile ? readJsonFile("data/catalog.json") : null;
  const products = Array.isArray(raw?.products) ? raw.products : [];
  const map = new Map();
  for (const p of products) {
    const sku = normalizeText(p?.sku);
    if (sku) map.set(sku, p);
  }
  return map;
};

const itemPriceCents = (item, catalogIndex) => {
  const sku = normalizeText(item?.sku);
  const fromCatalog = sku && catalogIndex?.get ? catalogIndex.get(sku) : null;

  const catalogPrice =
    Number(fromCatalog?.price_cents) ||
    (Number.isFinite(Number(fromCatalog?.price_mxn)) ? Math.round(Number(fromCatalog.price_mxn) * 100) : 0) ||
    (Number.isFinite(Number(fromCatalog?.base_mxn)) ? Math.round(Number(fromCatalog.base_mxn) * 100) : 0);

  const clientPrice =
    Number(item?.price_cents) ||
    (Number.isFinite(Number(item?.priceCents)) ? Math.round(Number(item.priceCents)) : 0) ||
    (Number.isFinite(Number(item?.price_mxn)) ? Math.round(Number(item.price_mxn) * 100) : 0);

  return Math.max(0, catalogPrice || clientPrice || 0);
};

const itemTitle = (item, catalogIndex) => {
  const sku = normalizeText(item?.sku);
  const fromCatalog = sku && catalogIndex?.get ? catalogIndex.get(sku) : null;
  return normalizeText(fromCatalog?.name || fromCatalog?.title || item?.name || item?.title || "Producto SCORE");
};

const itemImage = (item, catalogIndex) => {
  const sku = normalizeText(item?.sku);
  const fromCatalog = sku && catalogIndex?.get ? catalogIndex.get(sku) : null;
  const imgs = Array.isArray(fromCatalog?.images) ? fromCatalog.images : [];
  const candidate = imgs[0] || fromCatalog?.image_url || fromCatalog?.img || item?.image || "";
  return normalizeUrl(candidate);
};

const expandUnits = (items, catalogIndex) => {
  const units = [];
  for (const item of items) {
    const qty = clampInt(item?.qty, 1, 99);
    const priceCents = itemPriceCents(item, catalogIndex);
    const title = itemTitle(item, catalogIndex);
    const sku = normalizeText(item?.sku);
    const size = normalizeText(item?.size || "");
    for (let i = 0; i < qty; i += 1) {
      units.push({
        sku,
        title,
        size,
        price_cents: priceCents,
        image: itemImage(item, catalogIndex),
      });
    }
  }
  return units;
};

const allocateDiscount = (units, discountCents) => {
  const subtotal = units.reduce((sum, u) => sum + Number(u.price_cents || 0), 0);
  const totalDiscount = Math.max(0, Math.min(subtotal, Math.round(Number(discountCents || 0))));
  if (!totalDiscount || !subtotal) {
    return units.map((u) => ({ ...u, discount_cents: 0, net_cents: Math.max(0, Number(u.price_cents || 0)) }));
  }

  const raw = units.map((u) => {
    const exact = (Number(u.price_cents || 0) / subtotal) * totalDiscount;
    const floor = Math.floor(exact);
    return { ...u, exact, floor, frac: exact - floor };
  });

  let remainder = totalDiscount - raw.reduce((sum, u) => sum + u.floor, 0);
  raw.sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < raw.length && remainder > 0; i += 1, remainder -= 1) {
    raw[i].floor += 1;
  }

  return raw.map((u) => {
    const discount_cents = Math.min(Number(u.price_cents || 0), Math.max(0, u.floor));
    return {
      ...u,
      discount_cents,
      net_cents: Math.max(0, Number(u.price_cents || 0) - discount_cents),
    };
  });
};

const parseCustomer = (body) => {
  const customer = body?.customer && typeof body.customer === "object" ? body.customer : {};
  return {
    name: normalizeText(customer.name || body?.name || ""),
    email: normalizeText(customer.email || body?.email || ""),
    phone: normalizeText(customer.phone || body?.phone || ""),
    address: normalizeText(customer.address || body?.address || ""),
    postal: normalizeText(customer.postal || body?.postal || body?.shipPostal || ""),
    country: normalizeText(customer.country || body?.country || "MX").toUpperCase() || "MX",
    notes: normalizeText(customer.notes || body?.notes || ""),
  };
};

const parseShipping = async (body, customer, totalQty) => {
  const ship = body?.shipping && typeof body.shipping === "object" ? body.shipping : {};
  const mode =
    String(ship.mode || body?.ship_mode || body?.shipping_mode || "pickup").toLowerCase().trim() ===
    "delivery"
      ? "delivery"
      : "pickup";

  const country = String(ship.country || customer.country || "MX").toUpperCase() || "MX";
  const postal = normalizeText(ship.postal || customer.postal || body?.postal || body?.shipPostal || "");
  const fallback = typeof getFallbackShipping === "function" ? getFallbackShipping(country, totalQty) : null;

  if (mode === "pickup") {
    return {
      mode,
      country,
      postal,
      amount_cents: 0,
      quote: { ok: true, provider: "pickup", label: "Pickup", amount_cents: 0, amount_mxn: 0 },
    };
  }

  if (!postal) {
    return {
      mode,
      country,
      postal,
      amount_cents: Number(fallback?.amount_cents || 0) || 0,
      quote: fallback || { ok: true, provider: "fallback", label: "Envío estimado", amount_cents: 0, amount_mxn: 0 },
    };
  }

  try {
    const quote =
      typeof getEnviaQuote === "function"
        ? await getEnviaQuote({ zip: postal, country, items_qty: totalQty })
        : null;

    if (quote && Number.isFinite(Number(quote.amount_cents))) {
      const amount_cents = Math.max(0, Math.round(Number(quote.amount_cents) || 0));
      return {
        mode,
        country,
        postal,
        amount_cents,
        quote: {
          ok: quote.ok !== false,
          provider: quote.provider || "envia",
          label: quote.label || "Envío",
          country,
          amount_cents,
          amount_mxn: Number.isFinite(Number(quote.amount_mxn)) ? Number(quote.amount_mxn) : amount_cents / 100,
          raw: quote.raw ?? null,
        },
      };
    }
  } catch {}

  return {
    mode,
    country,
    postal,
    amount_cents: Number(fallback?.amount_cents || 0) || 0,
    quote: fallback || { ok: true, provider: "fallback", label: "Envío estimado", amount_cents: 0, amount_mxn: 0 },
  };
};

const buildItemsSummary = (items) =>
  items
    .map((it) => {
      const name = normalizeText(it?.title || it?.name || "Producto");
      const qty = clampInt(it?.qty, 1, 99);
      const size = normalizeText(it?.size || "");
      return `${qty} x ${name}${size ? ` [${size}]` : ""}`;
    })
    .join(" | ");

const resolveOrgId = async (sb) => {
  if (typeof resolveScoreOrgId === "function") {
    try {
      return await resolveScoreOrgId(sb);
    } catch {}
  }
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(envId).trim())) {
    return String(envId).trim();
  }
  return "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";
};

module.exports = async (req, res) => {
  const origin = req.headers.origin || req.headers.Origin || "*";

  if (req.method === "OPTIONS") {
    const optionsRes =
      handleOptions?.({ headers: { origin } }) || {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: "",
      };
    return send(res, optionsRes);
  }

  if (req.method !== "POST") {
    return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
  }

  const body = parseBody(req);
  const customer = parseCustomer(body);

  if (!customer.name || !customer.email || !customer.phone) {
    return send(res, jsonResponse(400, { ok: false, error: "Completa nombre, correo y teléfono." }, origin));
  }

  const rawItems = Array.isArray(body.items) ? body.items : Array.isArray(body.cart) ? body.cart : [];
  const normalizedItems = normalizeQty(rawItems);
  const totalQty = itemsQtyFromAny(normalizedItems);

  if (!normalizedItems.length || totalQty <= 0) {
    return send(res, jsonResponse(400, { ok: false, error: "Tu carrito está vacío." }, origin));
  }

  const catalogIndex = getCatalogMap();
  const units = expandUnits(normalizedItems, catalogIndex);
  const subtotal_cents = units.reduce((sum, u) => sum + Number(u.price_cents || 0), 0);

  const promo = findPromo(body);
  const promoVerdict = computePromo(promo, subtotal_cents);

  const shipping = await parseShipping(body, customer, totalQty);
  const shipping_cents = promoVerdict.free_shipping ? 0 : Math.max(0, Number(shipping.amount_cents || 0) || 0);

  const discountedUnits = allocateDiscount(units, promoVerdict.discount_cents);
  const discountedSubtotal_cents = discountedUnits.reduce((sum, u) => sum + Number(u.net_cents || 0), 0);
  const total_cents = Math.max(0, discountedSubtotal_cents + shipping_cents);

  if (total_cents <= 0) {
    return send(res, jsonResponse(400, { ok: false, error: "El total de la orden no puede ser cero." }, origin));
  }

  const paymentMethod = String(body.payment_method || body.paymentMethod || "card").toLowerCase().trim();
  const selectedPaymentMethod = paymentMethod === "oxxo" ? "oxxo" : "card";

  const baseUrl =
    (typeof shared.getBaseUrl === "function" ? shared.getBaseUrl(req) : "") ||
    (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL || String(process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL).replace(/^https?:\/\//, "")}`
      : "https://scorestore.vercel.app");

  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const successUrl = `${cleanBaseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${cleanBaseUrl}/cancel.html`;

  const lineItems = discountedUnits.map((u, idx) => ({
    quantity: 1,
    price_data: {
      currency: "mxn",
      unit_amount: Math.max(1, Math.round(Number(u.net_cents || 0))),
      product_data: {
        name: `${u.title}${u.size ? ` · ${u.size}` : ""}`,
        description: u.sku ? `SKU: ${u.sku}` : undefined,
        images: u.image ? [u.image] : undefined,
        metadata: {
          sku: u.sku || "",
          size: u.size || "",
          unit_index: String(idx + 1),
        },
      },
    },
  }));

  if (shipping_cents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "mxn",
        unit_amount: Math.max(1, Math.round(shipping_cents)),
        product_data: {
          name: shipping.quote?.label ? `Envío · ${shipping.quote.label}` : "Envío",
          description: shipping.mode === "delivery" ? "Entrega a domicilio" : "Recolección en tienda",
        },
      },
    });
  }

  const stripe = initStripe();

  const metadata = {
    source: "scorestore-vercel",
    shipping_mode: shipping.mode,
    shipping_country: shipping.country || "",
    shipping_postal: shipping.postal || "",
    subtotal_cents: String(subtotal_cents),
    discount_cents: String(promoVerdict.discount_cents || 0),
    shipping_cents: String(shipping_cents || 0),
    total_cents: String(total_cents),
    items_count: String(discountedUnits.length),
    items_qty: String(totalQty),
    items_summary: buildItemsSummary(normalizedItems).slice(0, 450),
    customer_name: customer.name.slice(0, 120),
    customer_email: customer.email.slice(0, 120),
    customer_phone: customer.phone.slice(0, 40),
    promo_code: promoVerdict.promo?.code || "",
  };

  const sessionParams = {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: lineItems,
    customer_email: customer.email,
    payment_method_types: selectedPaymentMethod === "oxxo" ? ["oxxo"] : ["card"],
    payment_method_collection: "always",
    billing_address_collection: "required",
    phone_number_collection: { enabled: true },
    allow_promotion_codes: false,
    locale: "es",
    metadata,
    shipping_address_collection:
      shipping.mode === "delivery"
        ? {
            allowed_countries: ["MX", "US"],
          }
        : undefined,
    payment_method_options:
      selectedPaymentMethod === "oxxo"
        ? {
            oxxo: { expires_after_days: 3 },
          }
        : undefined,
  };

  const checkoutIdempotencyKey = makeCheckoutIdempotencyKey
    ? makeCheckoutIdempotencyKey(
        {
          customer_email: customer.email,
          subtotal_cents,
          discount_cents: promoVerdict.discount_cents || 0,
          shipping_cents,
          total_cents,
          items_summary: metadata.items_summary,
          payment_method: selectedPaymentMethod,
        },
        body.req_id || body.request_id || ""
      )
    : undefined;

  try {
    const session = await stripe.checkout.sessions.create(
      sessionParams,
      checkoutIdempotencyKey ? { idempotencyKey: checkoutIdempotencyKey } : undefined
    );

    try {
      const sb = typeof supabaseAdmin === "function" ? supabaseAdmin() : null;
      if (sb) {
        const orgId = await resolveOrgId(sb);
        const itemsJson = normalizedItems.map((item) => ({
          sku: item.sku,
          qty: clampInt(item.qty, 1, 99),
          size: normalizeText(item.size || ""),
        }));

        const row = {
          stripe_session_id: session.id,
          checkout_session_id: session.id,
          status: session.status || "open",
          payment_status: session.payment_status || "unpaid",
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone,
          shipping_mode: shipping.mode,
          shipping_country: shipping.country,
          shipping_postal_code: shipping.postal,
          subtotal_cents,
          amount_subtotal_cents: subtotal_cents,
          discount_cents: promoVerdict.discount_cents || 0,
          amount_discount_cents: promoVerdict.discount_cents || 0,
          shipping_cents,
          amount_shipping_cents: shipping_cents,
          total_cents,
          amount_total_cents: total_cents,
          amount_subtotal_mxn: subtotal_cents / 100,
          amount_discount_mxn: (promoVerdict.discount_cents || 0) / 100,
          amount_shipping_mxn: shipping_cents / 100,
          amount_total_mxn: total_cents / 100,
          currency: "MXN",
          promo_code: promoVerdict.promo?.code || "",
          items_summary: metadata.items_summary,
          items: itemsJson,
          items_json: itemsJson,
          customer_details: {
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
          },
          shipping_details: {
            mode: shipping.mode,
            country: shipping.country,
            postal: shipping.postal,
            quote: shipping.quote || null,
          },
          metadata,
          org_id: orgId,
          organization_id: orgId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await sb.from("orders").insert([row]);
      }
    } catch (e) {
      console.error("[create_checkout] order insert failed:", e?.message || e);
    }

    if (typeof sendTelegram === "function") {
      try {
        await sendTelegram(
          [
            "🛒 <b>Nuevo checkout creado</b>",
            `Cliente: ${customer.name}`,
            `Email: ${customer.email}`,
            `Total: $${(total_cents / 100).toFixed(2)} MXN`,
            `Pago: ${selectedPaymentMethod.toUpperCase()}`,
            `Sesión: ${session.id}`,
          ].join("\n")
        );
      } catch {}
    }

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          url: session.url,
          checkout_url: session.url,
          session_id: session.id,
          id: session.id,
          payment_status: session.payment_status || "unpaid",
          status: session.status || "open",
          currency: "MXN",
          subtotal_cents,
          discount_cents: promoVerdict.discount_cents || 0,
          shipping_cents,
          total_cents,
          customer_email: customer.email,
          shipping_mode: shipping.mode,
        },
        origin
      )
    );
  } catch (err) {
    return send(
      res,
      jsonResponse(
        500,
        {
          ok: false,
          error: err?.message || "No fue posible crear el checkout.",
        },
        origin
      )
    );
  }
};