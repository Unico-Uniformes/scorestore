"use strict";

const shared = require("./_shared");

const jsonResponse = shared.jsonResponse;
const handleOptions = shared.handleOptions;
const supabaseAdmin = shared.supabaseAdmin;
const getBaseUrl = shared.getBaseUrl;
const getCatalogIndex = shared.getCatalogIndex;
const initStripe = shared.initStripe;
const makeCheckoutIdempotencyKey = shared.makeCheckoutIdempotencyKey;
const normalizeQty = shared.normalizeQty || ((items) => Array.isArray(items) ? items : []);
const itemsQtyFromAny = shared.itemsQtyFromAny || ((items) => Array.isArray(items) ? items.reduce((s, i) => s + Number(i?.qty || 0), 0) : 0);
const readJsonFile = shared.readJsonFile;
const safeStr = shared.safeStr || ((v, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d));
const sendTelegram = shared.sendTelegram;
const getFallbackShipping = shared.getFallbackShipping;

const DEFAULT_SCORE_ORG_ID = "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";

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

const promoKind = (promo) => {
  const type = String(promo?.type || "").trim().toLowerCase();
  if (type === "percent" || type === "percentage" || type === "percent_off") return "percent";
  if (type === "fixed_mxn" || type === "fixed" || type === "fixed_off") return "fixed";
  if (type === "free_shipping" || type === "freeshipping") return "free_shipping";
  return "unknown";
};

const computePromo = (promo, subtotalCents) => {
  if (!promo) return { promo: null, discount_cents: 0, free_shipping: false };

  const kind = promoKind(promo);
  const active = promo.active == null ? true : !!promo.active;
  if (!active) return { promo: null, discount_cents: 0, free_shipping: false };

  const minAmountMxn = Number(promo.min_amount_mxn || 0) || 0;
  if (Number(subtotalCents || 0) < moneyToCents(minAmountMxn)) {
    return { promo: null, discount_cents: 0, free_shipping: false };
  }

  if (kind === "free_shipping") {
    return { promo, discount_cents: 0, free_shipping: true };
  }

  if (kind === "percent") {
    const raw = Number(promo.value || 0);
    const rate = raw > 1 ? raw / 100 : raw;
    const discount = Math.max(0, Math.round(Number(subtotalCents || 0) * (Number.isFinite(rate) ? rate : 0)));
    return { promo, discount_cents: Math.min(Number(subtotalCents || 0), discount), free_shipping: false };
  }

  if (kind === "fixed") {
    const discount = Math.max(0, moneyToCents(Number(promo.value || 0)));
    return { promo, discount_cents: Math.min(Number(subtotalCents || 0), discount), free_shipping: false };
  }

  return { promo: null, discount_cents: 0, free_shipping: false };
};

const normalizeText = (s) => String(s ?? "").trim();
const normalizeUrl = (u) => {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("assets/")) return `/${s}`;
  if (s.startsWith("/assets/")) return s;
  return s.startsWith("/") ? s : `/${s}`;
};

const itemPriceCents = (item, catalogIndex) => {
  const sku = normalizeText(item?.sku);
  const fromCatalog = sku && catalogIndex?.get ? catalogIndex.get(sku) : null;

  const fromCatalogPrice =
    Number(fromCatalog?.price_cents) ||
    (Number.isFinite(Number(fromCatalog?.price_mxn)) ? Math.round(Number(fromCatalog.price_mxn) * 100) : 0) ||
    (Number.isFinite(Number(fromCatalog?.base_mxn)) ? Math.round(Number(fromCatalog.base_mxn) * 100) : 0);

  const clientPrice =
    Number(item?.price_cents) ||
    (Number.isFinite(Number(item?.priceCents)) ? Math.round(Number(item.priceCents)) : 0) ||
    (Number.isFinite(Number(item?.price_mxn)) ? Math.round(Number(item.price_mxn) * 100) : 0);

  return Math.max(0, fromCatalogPrice || clientPrice || 0);
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

const getCatalogMap = () => {
  try {
    const fn = getCatalogIndex;
    if (typeof fn === "function") {
      const out = fn();
      if (out?.index instanceof Map) return out.index;
      if (out?.index && typeof out.index === "object") return new Map(Object.entries(out.index));
    }
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

const resolveOrgId = async (sb) => {
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(envId).trim())) {
    return String(envId).trim();
  }

  let orgId = DEFAULT_SCORE_ORG_ID;

  try {
    const { data: byId } = await sb.from("organizations").select("id").eq("id", orgId).limit(1).maybeSingle();
    if (byId?.id) return orgId;

    const { data: byName } = await sb
      .from("organizations")
      .select("id")
      .ilike("name", "%score%")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (byName?.id) orgId = byName.id;
  } catch {}

  return orgId;
};

const getFallbackShippingQuote = (country, qty) => {
  const c = String(country || "MX").toUpperCase();
  const q = clampInt(qty || 1, 1, 99);

  const fallback = typeof getFallbackShipping === "function"
    ? getFallbackShipping(c, q)
    : null;

  if (fallback && Number.isFinite(Number(fallback.amount_cents))) {
    return {
      ok: true,
      provider: fallback.provider || "fallback",
      label: fallback.label || (c === "US" ? "Envío USA (estimado)" : "Envío MX (estimado)"),
      country: c,
      amount_cents: Number(fallback.amount_cents) || 0,
      amount_mxn: Number(fallback.amount_mxn) || ((Number(fallback.amount_cents) || 0) / 100),
    };
  }

  const base = c === "US" ? 850 : 250;
  const perItem = 50;
  const priceMXN = Math.max(0, base + Math.max(0, q - 1) * perItem);
  return {
    ok: true,
    provider: "fallback",
    label: c === "US" ? "Envío USA (estimado)" : "Envío MX (estimado)",
    country: c,
    amount_cents: Math.round(priceMXN * 100),
    amount_mxn: priceMXN,
  };
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
    return {
      ...u,
      exact,
      floor,
      frac: exact - floor,
    };
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

const buildItemsSummary = (items) => {
  return items
    .map((it) => {
      const name = normalizeText(it?.title || it?.name || "Producto");
      const qty = clampInt(it?.qty, 1, 99);
      const size = normalizeText(it?.size || "");
      return `${qty} x ${name}${size ? ` [${size}]` : ""}`;
    })
    .join(" | ");
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

const parseShipping = (body, customer, totalQty) => {
  const ship = body?.shipping && typeof body.shipping === "object" ? body.shipping : {};
  const mode = String(ship.mode || body?.ship_mode || body?.shipping_mode || "pickup").toLowerCase().trim() === "delivery" ? "delivery" : "pickup";
  const country = String(ship.country || customer.country || "MX").toUpperCase() || "MX";
  const postal = normalizeText(ship.postal || customer.postal || "");
  const quote = ship.quote && typeof ship.quote === "object" ? ship.quote : null;

  let amount_cents = Number(ship.amount_cents || ship.amount || quote?.amount_cents || quote?.amount || 0) || 0;

  if (mode === "delivery" && amount_cents <= 0) {
    const fallback = getFallbackShippingQuote(country, totalQty);
    amount_cents = Number(fallback.amount_cents || 0) || 0;
    return {
      mode,
      country,
      postal,
      amount_cents,
      quote: fallback,
    };
  }

  if (mode === "pickup") {
    return {
      mode,
      country,
      postal,
      amount_cents: 0,
      quote: { ok: true, provider: "pickup", label: "Pickup", amount_cents: 0, amount_mxn: 0 },
    };
  }

  return {
    mode,
    country,
    postal,
    amount_cents: Math.max(0, amount_cents),
    quote: quote || { ok: true, provider: "manual", amount_cents: Math.max(0, amount_cents), amount_mxn: Math.max(0, amount_cents) / 100 },
  };
};

const parsePromo = (body) => {
  const promo = body?.promo && typeof body.promo === "object" ? body.promo : null;
  if (!promo) return null;

  const code = cleanCode(promo.code);
  if (!code) return null;

  return {
    code,
    type: String(promo.type || "").trim().toLowerCase(),
    value: promo.value,
    description: String(promo.description || "").trim(),
    active: promo.active == null ? true : !!promo.active,
    min_amount_mxn: Number(promo.min_amount_mxn || 0) || 0,
    expires_at: promo.expires_at || null,
  };
};

module.exports = async (req, res) => {
  const origin = req.headers.origin || req.headers.Origin || "*";

  if (req.method === "OPTIONS") {
    const optionsRes =
      handleOptions?.({ headers: { origin } }) ||
      {
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
    return send(
      res,
      jsonResponse(400, { ok: false, error: "Completa nombre, correo y teléfono." }, origin)
    );
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

  const promo = parsePromo(body);
  const promoVerdict = computePromo(promo, subtotal_cents);

  const shipping = parseShipping(body, customer, totalQty);
  const shipping_cents = promoVerdict.free_shipping ? 0 : Math.max(0, Number(shipping.amount_cents || 0) || 0);

  const discountedUnits = allocateDiscount(units, promoVerdict.discount_cents);
  const discountedSubtotal_cents = discountedUnits.reduce((sum, u) => sum + Number(u.net_cents || 0), 0);
  const total_cents = Math.max(0, discountedSubtotal_cents + shipping_cents);

  if (total_cents <= 0) {
    return send(
      res,
      jsonResponse(
        400,
        {
          ok: false,
          error: "El total de la orden no puede ser cero.",
        },
        origin
      )
    );
  }

  const paymentMethod = String(body.payment_method || body.paymentMethod || "card").toLowerCase().trim();
  const selectedPaymentMethod = paymentMethod === "oxxo" ? "oxxo" : "card";

  const baseUrl = getBaseUrl?.(req) || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://scorestore.vercel.app";
  const successUrl = `${baseUrl.replace(/\/+$/, "")}/success.html?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl.replace(/\/+$/, "")}/cancel.html`;

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
            oxxo: {
              expires_after_days: 3,
            },
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
    const session = await stripe.checkout.sessions.create(sessionParams, checkoutIdempotencyKey ? { idempotencyKey: checkoutIdempotencyKey } : undefined);

    try {
      const sb = typeof supabaseAdmin === "function" ? supabaseAdmin() : null;
      if (sb) {
        const orgId = await resolveOrgId(sb);
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
          discount_cents: promoVerdict.discount_cents || 0,
          shipping_cents,
          total_cents,
          currency: "MXN",
          promo_code: promoVerdict.promo?.code || "",
          items_summary: metadata.items_summary,
          items_json: JSON.stringify(
            normalizedItems.map((item) => ({
              sku: item.sku,
              qty: clampInt(item.qty, 1, 99),
              size: normalizeText(item.size || ""),
            }))
          ),
          metadata,
          org_id: orgId,
          organization_id: orgId,
          created_at: new Date().toISOString(),
        };

        await sb.from("orders").insert([row]);
      }
    } catch {}

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