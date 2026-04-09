// lib/handlers/_catalog.js
"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
  safeJsonParse,
  readJsonFile,
  resolveScoreOrgId,
  readPublicSiteSettings,
  sendTelegram,
  normalizeQty,
  itemsQtyFromAny,
  normalizeReply,
  extractActionMarkers,
  callGemini,
} = require("../_shared");

const { rateLimit } = require("../_rate_limit");

const GEMINI_API_KEY        = process.env.GEMINI_API_KEY        || "";
const GEMINI_MODEL          = process.env.GEMINI_MODEL          || "gemini-2.5-flash-lite";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";

const MAX_MESSAGE_LEN = 1800;
const MAX_REPLY_LEN   = 1400;

// ── Logo mapping — igual que main.js CATEGORY_CONFIG ────────────────────────
const CATEGORY_LOGO_MAP = {
  BAJA1000: "/assets/logo-baja1000.webp",
  BAJA500:  "/assets/logo-baja500.webp",
  BAJA400:  "/assets/logo-baja400.webp",
  SF250:    "/assets/logo-sf250.webp",
};

const CATEGORY_NAME_MAP = {
  BAJA1000: "BAJA 1000",
  BAJA500:  "BAJA 500",
  BAJA400:  "BAJA 400",
  SF250:    "SAN FELIPE 250",
};

function getCategoryLogo(uiId) {
  return CATEGORY_LOGO_MAP[uiId] || "/assets/logo-score.webp";
}

function getCategoryName(uiId, fallback) {
  return CATEGORY_NAME_MAP[uiId] || fallback || uiId?.replace(/_/g, " ") || "Colección";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function send(res, payload) {
  const out   = payload || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"]        = "no-cache";
  out.headers["Expires"]       = "0";
  res.statusCode = out.statusCode || 200;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body || "");
}

function getOrigin(req) {
  return req?.headers?.origin || req?.headers?.Origin || "";
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function money(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "$0.00";
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value / 100);
}

function clampText(v, max = MAX_MESSAGE_LEN) {
  return String(v ?? "").trim().slice(0, max);
}

function normalizeLower(v) {
  return safeStr(v).trim().toLowerCase();
}

function parseBody(req) {
  const body = req?.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return {};
}

function parseMode(req, body) {
  const url = new URL(req.url, "http://localhost");
  const q = safeStr(url.searchParams.get("mode") || url.searchParams.get("type") || "").trim().toLowerCase();
  const b = safeStr(body?.mode || body?.type || body?.assistant || "").trim().toLowerCase();
  return b || q || (body?.message ? "assistant" : "catalog");
}

function parseOrgId(req, body) {
  const url = new URL(req.url, "http://localhost");
  return safeStr(
    body?.org_id || body?.orgId || body?.organization_id ||
    url.searchParams.get("org_id") || url.searchParams.get("orgId") || ""
  ).trim();
}

function parseMessage(body = {}) {
  const msg = body?.message ?? body?.prompt ?? body?.text ?? body?.input ?? "";
  return clampText(msg);
}

function parseContext(body = {}) {
  const ctx = body?.context && typeof body.context === "object" ? body.context : {};
  return {
    currentProduct: safeStr(ctx.currentProduct || ctx.product || ctx.currentSku || body?.currentProduct || ""),
    currentSku:     safeStr(ctx.currentSku     || ctx.sku     || body?.currentSku     || ""),
    cartItems:      safeStr(ctx.cartItems       || ctx.cart    || body?.cartItems       || ""),
    cartTotal:      safeStr(ctx.cartTotal       || ctx.total   || body?.cartTotal       || ""),
    shipMode:       safeStr(ctx.shipMode        || ctx.shippingMode || body?.shipMode   || ""),
    orderId:        safeStr(ctx.orderId         || ctx.order_id || body?.orderId        || ""),
    actionHint:     safeStr(ctx.actionHint      || ctx.action  || body?.actionHint     || ""),
    category:       safeStr(ctx.category        || ctx.section || body?.category        || ""),
  };
}

function normalizeAssetPath(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  s = s.replaceAll("\\", "/");
  return s.startsWith("/") ? s : `/${s.replace(/^\/+/, "")}`;
}

function getProductSku(p)  { return safeStr(p?.sku  || p?.id   || p?.slug  || p?.title || p?.name || "").trim(); }
function getProductName(p) { return safeStr(p?.name || p?.title || "Producto SCORE").trim(); }
function getProductDescription(p) { return safeStr(p?.description || "").trim(); }

function getProductPriceCents(p) {
  if (Number.isFinite(Number(p?.price_cents))) return Math.max(0, Math.round(Number(p.price_cents)));
  if (Number.isFinite(Number(p?.price_mxn)))   return Math.max(0, Math.round(Number(p.price_mxn)   * 100));
  if (Number.isFinite(Number(p?.base_mxn)))    return Math.max(0, Math.round(Number(p.base_mxn)    * 100));
  return 0;
}

function getProductImages(p) {
  const raw = Array.isArray(p?.images)
    ? p.images
    : typeof p?.images === "string"
      ? safeJsonParse(p.images, [])
      : [];
  const list = [];
  if (p?.image_url || p?.img || p?.image) list.push(p.image_url || p.img || p.image);
  for (const img of raw) list.push(img);
  return [...new Set(list.map(normalizeAssetPath).filter(Boolean))];
}

function getProductSectionUi(p) {
  const raw = safeStr(
    p?.uiSection || p?.sectionId || p?.section_id || p?.category || p?.collection || p?.sub_section || ""
  ).trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("1000") || raw === "EDICION_2025" || raw === "EDICION_2026") return "BAJA1000";
  if (raw.includes("500"))  return "BAJA500";
  if (raw.includes("400"))  return "BAJA400";
  if (raw.includes("250") || raw.includes("SF")) return "SF250";
  return raw.replace(/[^A-Z0-9]/g, "");
}

function getStockLabel(p) {
  const stock = safeNum(p?.stock, null);
  if (!Number.isFinite(stock)) return "Disponible";
  if (stock <= 0) return "Sin stock por ahora";
  if (stock <= 3) return "Últimas piezas";
  return "Disponible";
}

// FIX CRÍTICO: normalizeCategory ahora usa el logo correcto por carrera
function normalizeCategory(row) {
  const id = safeStr(row?.id || row?.uiId || row?.section_id || row?.sectionId || "").trim().toUpperCase();
  if (!id) return null;

  // Mapeo de uiId a BAJA1000/BAJA500/etc para logos correctos
  let uiId = id;
  if (id.includes("1000") || id === "EDICION_2025" || id === "EDICION_2026") uiId = "BAJA1000";
  else if (id.includes("500"))  uiId = "BAJA500";
  else if (id.includes("400"))  uiId = "BAJA400";
  else if (id.includes("250") || id.startsWith("SF")) uiId = "SF250";

  return {
    id:         uiId,
    uiId,
    name:       safeStr(row?.name || row?.title || getCategoryName(uiId, id.replace(/_/g, " "))).trim(),
    logo:       normalizeAssetPath(row?.logo || row?.image || getCategoryLogo(uiId)),
    section_id: safeStr(row?.section_id || row?.sectionId || uiId).trim(),
    count:      safeNum(row?.count, 0),
    active:     row?.active == null ? true : !!row.active,
  };
}

function normalizeProduct(row) {
  if (!row || typeof row !== "object") return null;
  const images     = getProductImages(row);
  const sectionUi  = getProductSectionUi(row);

  return {
    ...row,
    id:          safeStr(row.id  || row.sku  || row.slug  || "").trim(),
    sku:         safeStr(row.sku || row.id   || row.slug  || "").trim(),
    name:        getProductName(row),
    title:       getProductName(row),
    description: getProductDescription(row),
    uiSection:   sectionUi || "SCORE",
    sectionId:   safeStr(row.sectionId   || row.section_id || "").trim(),
    section_id:  safeStr(row.section_id  || row.sectionId  || "").trim(),
    collection:  safeStr(row.collection  || row.sub_section || "").trim(),
    sub_section: safeStr(row.sub_section || row.collection  || "").trim(),
    category:    safeStr(row.category || "").trim(),
    rank:        Number.isFinite(Number(row.rank))  ? Math.round(Number(row.rank))  : 999,
    stock:       Number.isFinite(Number(row.stock)) ? Math.round(Number(row.stock)) : null,
    active:      row.active    == null ? true : !!row.active,
    is_active:   row.is_active == null ? true : !!row.is_active,
    deleted_at:  row.deleted_at || null,
    price_cents: getProductPriceCents(row),
    price_mxn:   Number.isFinite(Number(row.price_mxn)) ? Number(row.price_mxn) : getProductPriceCents(row) / 100,
    base_mxn:    Number.isFinite(Number(row.base_mxn))  ? Number(row.base_mxn)  : getProductPriceCents(row) / 100,
    img:         normalizeAssetPath(row.img       || row.image     || row.image_url || images[0] || ""),
    image_url:   normalizeAssetPath(row.image_url || row.img       || row.image     || images[0] || ""),
    image:       normalizeAssetPath(row.image     || row.image_url || row.img       || images[0] || ""),
    images,
    sizes: Array.isArray(row.sizes)
      ? row.sizes.map((x) => safeStr(x).trim()).filter(Boolean)
      : safeJsonParse(row.sizes, []).map((x) => safeStr(x).trim()).filter(Boolean),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

function attachCounts(sections, list) {
  const counts = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    const key = getProductSectionUi(p);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return (Array.isArray(sections) ? sections : []).map((s) => ({
    ...s,
    count: counts.get(s.uiId || s.id || "") || 0,
  }));
}

function buildSectionsFromProducts(list) {
  const map = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    const key = getProductSectionUi(p) || "SCORE";
    if (!map.has(key)) {
      map.set(key, {
        id:         key,
        uiId:       key,
        name:       getCategoryName(key),
        logo:       getCategoryLogo(key),   // ← FIX: logo correcto por carrera
        section_id: key,
        count:      0,
        active:     true,
      });
    }
    map.get(key).count += 1;
  }

  const ORDER = ["BAJA1000", "BAJA500", "BAJA400", "SF250"];
  return Array.from(map.values()).sort((a, b) => {
    const ia = ORDER.indexOf(a.uiId);
    const ib = ORDER.indexOf(b.uiId);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.name.localeCompare(b.name, "es");
  });
}

function statsFromProducts(list) {
  const items = Array.isArray(list) ? list : [];
  return {
    activeProducts:   items.filter((p) => p.active !== false && p.is_active !== false && !p.deleted_at).length,
    lowStockProducts: items.filter((p) => safeNum(p.stock, 999) > 0 && safeNum(p.stock, 999) <= 5).length,
    featuredProducts: items.filter((p) => safeNum(p.rank, 999) <= 12).length,
  };
}

function buildCatalogResponse(source = {}) {
  const rawProducts = Array.isArray(source.products) ? source.products : [];

  // FIX CRÍTICO: catalog.json usa "sections", no "categories"
  const rawCategories = Array.isArray(source.categories)
    ? source.categories
    : Array.isArray(source.sections)
      ? source.sections
      : [];

  const products   = rawProducts.map(normalizeProduct).filter(Boolean);
  const categories = (rawCategories.length ? rawCategories : buildSectionsFromProducts(products))
    .map(normalizeCategory)
    .filter(Boolean);

  return {
    products,
    categories: rawCategories.length ? attachCounts(categories, products) : categories,
    stats: statsFromProducts(products),
    store: {
      org_id:           safeStr(source?.store?.org_id           || source?.org_id           || ""),
      name:             safeStr(source?.store?.name             || source?.store?.hero_title || source?.hero_title || "SCORE STORE"),
      hero_title:       safeStr(source?.store?.hero_title       || source?.hero_title        || "SCORE STORE"),
      hero_image:       safeStr(source?.store?.hero_image       || source?.hero_image        || ""),
      promo_active:     !!(source?.store?.promo_active ?? source?.promo_active),
      promo_text:       safeStr(source?.store?.promo_text       || source?.promo_text        || ""),
      maintenance_mode: !!(source?.store?.maintenance_mode ?? source?.maintenance_mode),
      contact:          source?.store?.contact  || source?.contact  || {},
      home:             source?.store?.home     || source?.home     || {},
      socials:          source?.store?.socials  || source?.socials  || {},
    },
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function selectByOrgMany(sb, table, columns, orgId) {
  if (!sb) return [];
  const tries = orgId
    ? [`organization_id.eq.${orgId}`, `org_id.eq.${orgId}`]
    : [null];

  for (const filter of tries) {
    try {
      let q = sb.from(table).select(columns);
      if (filter) q = q.or(filter);
      const { data, error } = await q;
      if (!error && Array.isArray(data)) return data;
    } catch {}
  }
  return [];
}

async function loadCatalogFromJsonOrDb(orgId = "") {
  // Intenta JSON local primero
  const json = readJsonFile("data/catalog.json");
  if (json && (Array.isArray(json.products) || Array.isArray(json.categories) || Array.isArray(json.sections))) {
    return buildCatalogResponse(json);
  }

  // Fallback a Supabase
  const sb = supabaseAdmin();
  if (!sb) return buildCatalogResponse({ products: [], categories: [] });

  let resolvedOrgId = orgId;
  if (!resolvedOrgId) {
    try { resolvedOrgId = await resolveScoreOrgId(sb); } catch { resolvedOrgId = ""; }
  }

  const [settings, products, categories] = await Promise.all([
    typeof readPublicSiteSettings === "function"
      ? readPublicSiteSettings(sb, resolvedOrgId).catch(() => null)
      : Promise.resolve(null),
    selectByOrgMany(
      sb, "products",
      "id, name, title, sku, description, price_cents, price_mxn, base_mxn, stock, category, section_id, sub_section, rank, img, image_url, images, sizes, active, is_active, deleted_at, metadata",
      resolvedOrgId
    ),
    selectByOrgMany(sb, "site_categories", "*", resolvedOrgId).catch(() => []),
  ]);

  return buildCatalogResponse({ products, categories, org_id: resolvedOrgId, ...settings, store: settings || {} });
}

// ── AI prompt ─────────────────────────────────────────────────────────────────

function buildPublicPrompt({ store, stats, products, categories, context }) {
  const contact       = store?.contact || {};
  const home          = store?.home    || {};
  const socials       = store?.socials || {};
  const publicEmail   = safeStr(contact.email             || process.env.SUPPORT_EMAIL             || "ventas.unicotextil@gmail.com");
  const publicPhone   = safeStr(contact.phone             || process.env.SUPPORT_PHONE             || "6642368701");
  const publicWA      = safeStr(contact.whatsapp_display  || process.env.SUPPORT_WHATSAPP_DISPLAY  || "664 236 8701");
  const shippingNote  = safeStr(home.shipping_note        || "");
  const returnsNote   = safeStr(home.returns_note         || "");
  const promoText     = safeStr(store?.promo_text         || "");
  const heroTitle     = safeStr(store?.hero_title         || store?.name || "SCORE STORE");
  const mainMode      = !!store?.maintenance_mode;

  const productsPreview = (Array.isArray(products) ? products : [])
    .slice(0, 24)
    .map((p) => `- ${getProductName(p)} | SKU:${getProductSku(p)} | ${money(getProductPriceCents(p))} | ${getStockLabel(p)}`)
    .join("\n");

  const categoryPreview = (Array.isArray(categories) ? categories : [])
    .slice(0, 12)
    .map((c) => `- ${safeStr(c.name)} (${safeStr(c.uiId)})`)
    .join("\n");

  return `
Eres el asistente público de Score Store.
Objetivo: Ayudar a clientes a comprar. Responder breve, claro y comercial.
Reglas:
- No inventes stock, precios ni tiempos exactos.
- Si el cliente pide ayuda humana usa: Correo: ${publicEmail} · WhatsApp: ${publicWA} · Tel: ${publicPhone}
- Envíos: ${shippingNote || "Se calculan según destino."}
- Devoluciones: ${returnsNote || "Consultar soporte."}
- Mantenimiento activo: ${mainMode ? "sí" : "no"}
- Si hay intención de compra del producto actual: [ACTION:ADD_TO_CART:${safeStr(context.currentSku || context.currentProduct || "")}]
- Si quiere abrir carrito/pagar: [ACTION:OPEN_CART]

Tienda: ${heroTitle} | Promo: ${promoText || "Sin promo"} | Productos activos: ${stats?.activeProducts ?? "N/D"}

Categorías:
${categoryPreview || "- N/D"}

Productos:
${productsPreview || "- N/D"}

Contexto usuario:
- Producto: ${safeStr(context.currentProduct || "Ninguno")}
- SKU: ${safeStr(context.currentSku || "Ninguno")}
- Carrito: ${safeStr(context.cartItems || "Vacío")}
- Total: ${safeStr(context.cartTotal || "$0")}
- Envío: ${safeStr(context.shipMode || "-")}
`.trim();
}

function fallbackReply(message, store, contact) {
  const m        = normalizeLower(message);
  const email    = safeStr(contact?.email            || process.env.SUPPORT_EMAIL            || "ventas.unicotextil@gmail.com");
  const whatsapp = safeStr(contact?.whatsapp_display || process.env.SUPPORT_WHATSAPP_DISPLAY || "664 236 8701");
  const phone    = safeStr(contact?.phone            || process.env.SUPPORT_PHONE            || "6642368701");

  if (m.includes("envío") || m.includes("envio")) {
    return `Puedo ayudarte con envíos. Cotizamos a todo México y USA. Soporte: ${whatsapp} · ${email}`;
  }
  if (m.includes("promo") || m.includes("cupón") || m.includes("descuento")) {
    const pt = safeStr(store?.promo_text || "");
    return pt ? `Promo activa: ${pt}` : `No hay promoción activa en este momento.`;
  }
  if (m.includes("talla") || m.includes("medida") || m.includes("size")) {
    return `Las tallas van de S a XXL. Si me dices qué prenda, te ayudo a elegir.`;
  }
  if (m.includes("devol") || m.includes("cambio") || m.includes("return")) {
    return `Para cambios y devoluciones contáctanos: ${phone} · ${email}`;
  }
  return `Hola! Puedo ayudarte con catálogo, tallas, envío y checkout. Soporte humano: ${whatsapp} · ${email}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function handleCatalog(req) {
  const origin = getOrigin(req);
  const rl     = rateLimit(req);

  if (!rl.ok) {
    return jsonResponse(429, { ok: false, error: "rate_limited" }, origin);
  }

  const body = parseBody(req);
  const mode = parseMode(req, body);

  // Modo catálogo (GET / POST sin mensaje)
  if (mode !== "assistant") {
    const orgId   = parseOrgId(req, body);
    const catalog = await loadCatalogFromJsonOrDb(orgId);
    return jsonResponse(200, { ok: true, mode: "catalog", ...catalog }, origin);
  }

  // Modo asistente
  const message = parseMessage(body);
  if (!message) {
    return jsonResponse(400, { ok: false, error: "Se requiere un mensaje válido." }, origin);
  }

  const orgId   = parseOrgId(req, body);
  const context = parseContext(body);
  const catalog = await loadCatalogFromJsonOrDb(orgId);

  let resolvedOrgId = orgId || catalog?.store?.org_id || "";
  if (!resolvedOrgId) {
    const sb = supabaseAdmin();
    if (sb) {
      try { resolvedOrgId = await resolveScoreOrgId(sb); } catch { resolvedOrgId = ""; }
    }
  }

  const systemText = buildPublicPrompt({
    store:      catalog.store,
    stats:      catalog.stats,
    products:   catalog.products,
    categories: catalog.categories,
    context,
  });

  const preferredModel = safeStr(process.env.GEMINI_MODEL || GEMINI_MODEL).trim();
  const fallbackModel  = safeStr(process.env.GEMINI_FALLBACK_MODEL || GEMINI_FALLBACK_MODEL).trim();

  let replyText = "";
  let usedModel = preferredModel || "fallback";

  if (GEMINI_API_KEY) {
    try {
      replyText = await callGemini({ apiKey: GEMINI_API_KEY, model: preferredModel, systemText, userText: message });
    } catch (e) {
      const isModelIssue = /model.*not found|404/i.test(String(e?.message || ""));
      if (isModelIssue && fallbackModel && fallbackModel !== preferredModel) {
        usedModel = fallbackModel;
        replyText = await callGemini({ apiKey: GEMINI_API_KEY, model: fallbackModel, systemText, userText: message }).catch(() => "");
      } else {
        replyText = fallbackReply(message, catalog.store, catalog.store?.contact || {});
        usedModel = "fallback";
      }
    }
  } else {
    replyText = fallbackReply(message, catalog.store, catalog.store?.contact || {});
    usedModel = "fallback";
  }

  const rawReply = safeStr(replyText || fallbackReply(message, catalog.store, catalog.store?.contact || {}));
  const reply    = normalizeReply(rawReply).slice(0, MAX_REPLY_LEN);
  const actions  = extractActionMarkers(rawReply);

  if (actions.length && typeof sendTelegram === "function") {
    try {
      await sendTelegram([
        "💬 <b>Score Store AI</b>",
        `Org: ${resolvedOrgId || "N/D"}`,
        `Actions: ${actions.map((a) => `${a.action}${a.value ? `:${a.value}` : ""}`).join(", ")}`,
      ].join("\n"));
    } catch {}
  }

  return jsonResponse(200, {
    ok:    true,
    mode:  "assistant",
    org_id: resolvedOrgId || catalog.store?.org_id || "",
    reply,
    actions,
    model: usedModel,
    store: {
      name:         catalog.store?.name         || "SCORE STORE",
      hero_title:   catalog.store?.hero_title   || "SCORE STORE",
      promo_active: !!catalog.store?.promo_active,
      promo_text:   safeStr(catalog.store?.promo_text || ""),
    },
  }, origin);
}

module.exports = async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }
    if (req.method !== "GET" && req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, getOrigin(req)));
    }
    const payload = await handleCatalog(req);
    return send(res, payload);
  } catch (err) {
    return send(res, jsonResponse(500, { ok: false, error: err?.message || "Error procesando catálogo." }, getOrigin(req)));
  }
};

module.exports.default = module.exports;
