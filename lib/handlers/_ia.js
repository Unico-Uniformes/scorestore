"use strict";

const {
  jsonResponse,
  handleOptions,
  safeStr,
  readJsonFile,
  supabaseAdmin,
  resolveScoreOrgId,
  readPublicSiteSettings,
  normalizeReply,
  extractActionMarkers,
  callGemini,
  sendTelegram,
  rateLimit,
  normalizeQty,
  itemsQtyFromAny,
} = require("../_shared");

const catalogHandler = require("./_catalog.js");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";

const MAX_MESSAGE_LEN = 1800;
const MAX_REPLY_LEN = 1400;

function send(res, payload) {
  const out = payload || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"] = "no-cache";
  out.headers["Expires"] = "0";

  res.statusCode = out.statusCode || 200;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body || "");
}

function getOrigin(req) {
  return req?.headers?.origin || req?.headers?.Origin || "";
}

function parseBody(req) {
  const body = req?.body;

  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return {};
}

function clampText(v, max = MAX_MESSAGE_LEN) {
  return String(v ?? "").trim().slice(0, max);
}

function normalizeLower(v) {
  return safeStr(v).trim().toLowerCase();
}

function money(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "$0.00";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function normalizeAssetPath(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  s = s.replaceAll("\\", "/");
  return s.startsWith("/") ? s : `/${s.replace(/^\/+/, "")}`;
}

function getProductSku(p) {
  return safeStr(p?.sku || p?.id || p?.slug || p?.title || p?.name || "").trim();
}

function getProductName(p) {
  return safeStr(p?.name || p?.title || "Producto SCORE").trim();
}

function getProductDescription(p) {
  return safeStr(p?.description || "").trim();
}

function getProductPriceCents(p) {
  if (Number.isFinite(Number(p?.price_cents))) return Math.max(0, Math.round(Number(p.price_cents)));
  if (Number.isFinite(Number(p?.price_mxn))) return Math.max(0, Math.round(Number(p.price_mxn) * 100));
  if (Number.isFinite(Number(p?.base_mxn))) return Math.max(0, Math.round(Number(p.base_mxn) * 100));
  return 0;
}

function getProductImages(p) {
  const raw = Array.isArray(p?.images)
    ? p.images
    : typeof p?.images === "string"
      ? safeStr(p.images, "[]")
          .trim()
      : [];

  const list = [];
  if (p?.image_url || p?.img || p?.image) list.push(p.image_url || p.img || p.image);
  if (Array.isArray(raw)) for (const img of raw) list.push(img);

  return [...new Set(list.map(normalizeAssetPath).filter(Boolean))];
}

function getProductSectionUi(p) {
  const raw = safeStr(
    p?.uiSection || p?.sectionId || p?.section_id || p?.category || p?.collection || p?.sub_section || ""
  )
    .trim()
    .toUpperCase();

  if (!raw) return "";
  if (raw.includes("1000")) return "BAJA1000";
  if (raw.includes("500")) return "BAJA500";
  if (raw.includes("400")) return "BAJA400";
  if (raw.includes("250") || raw.includes("SF")) return "SF250";
  return raw.replace(/[^A-Z0-9]/g, "");
}

function getStockLabel(p) {
  const stock = Number(p?.stock);
  if (!Number.isFinite(stock)) return "Disponible";
  if (stock <= 0) return "Sin stock por ahora";
  if (stock <= 3) return "Últimas piezas";
  return "Disponible";
}

function normalizeProduct(row) {
  if (!row || typeof row !== "object") return null;

  const images = getProductImages(row);
  const sectionUi = getProductSectionUi(row);

  return {
    ...row,
    id: safeStr(row.id || row.sku || row.slug || "").trim(),
    sku: safeStr(row.sku || row.id || row.slug || "").trim(),
    name: getProductName(row),
    title: getProductName(row),
    description: getProductDescription(row),
    uiSection: sectionUi || "SCORE",
    sectionId: safeStr(row.sectionId || row.section_id || "").trim(),
    section_id: safeStr(row.section_id || row.sectionId || "").trim(),
    collection: safeStr(row.collection || row.sub_section || "").trim(),
    sub_section: safeStr(row.sub_section || row.collection || "").trim(),
    category: safeStr(row.category || "").trim(),
    rank: Number.isFinite(Number(row.rank)) ? Math.round(Number(row.rank)) : 999,
    stock: Number.isFinite(Number(row.stock)) ? Math.round(Number(row.stock)) : null,
    active: row.active == null ? true : !!row.active,
    is_active: row.is_active == null ? true : !!row.is_active,
    deleted_at: row.deleted_at || null,
    price_cents: getProductPriceCents(row),
    price_mxn: Number.isFinite(Number(row.price_mxn)) ? Number(row.price_mxn) : getProductPriceCents(row) / 100,
    base_mxn: Number.isFinite(Number(row.base_mxn)) ? Number(row.base_mxn) : getProductPriceCents(row) / 100,
    img: normalizeAssetPath(row.img || row.image || row.image_url || images[0] || ""),
    image_url: normalizeAssetPath(row.image_url || row.img || row.image || images[0] || ""),
    image: normalizeAssetPath(row.image || row.image_url || row.img || images[0] || ""),
    images,
    sizes: Array.isArray(row.sizes)
      ? row.sizes.map((x) => safeStr(x).trim()).filter(Boolean)
      : [],
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

function buildSectionsFromProducts(list) {
  const map = new Map();

  for (const p of Array.isArray(list) ? list : []) {
    const key = getProductSectionUi(p) || "SCORE";

    if (!map.has(key)) {
      map.set(key, {
        id: key,
        uiId: key,
        name: key.replace(/_/g, " "),
        logo: "/assets/logo-score.webp",
        section_id: key,
        count: 0,
        active: true,
      });
    }

    map.get(key).count += 1;
  }

  return Array.from(map.values()).sort((a, b) => {
    const order = ["BAJA1000", "BAJA500", "BAJA400", "SF250"];
    const ia = order.indexOf(a.uiId);
    const ib = order.indexOf(b.uiId);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.name.localeCompare(b.name, "es");
  });
}

function buildCatalogResponse(source = {}) {
  const rawProducts = Array.isArray(source.products) ? source.products : [];
  const rawCategories = Array.isArray(source.categories) ? source.categories : [];
  const products = rawProducts.map(normalizeProduct).filter(Boolean);
  const categories = rawCategories.length ? rawCategories : buildSectionsFromProducts(products);

  return {
    products,
    categories,
    stats: {
      activeProducts: products.filter((p) => p.active !== false && p.is_active !== false && !p.deleted_at).length,
      lowStockProducts: products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= 5).length,
      featuredProducts: products.filter((p) => Number(p.rank) <= 12).length,
    },
    store: {
      org_id: safeStr(source?.store?.org_id || source?.org_id || ""),
      name: safeStr(source?.store?.name || source?.store?.hero_title || source?.hero_title || "SCORE STORE"),
      hero_title: safeStr(source?.store?.hero_title || source?.hero_title || "SCORE STORE"),
      hero_image: safeStr(source?.store?.hero_image || source?.hero_image || ""),
      promo_active: !!(source?.store?.promo_active ?? source?.promo_active),
      promo_text: safeStr(source?.store?.promo_text || source?.promo_text || ""),
      maintenance_mode: !!(source?.store?.maintenance_mode ?? source?.maintenance_mode),
      contact: source?.store?.contact || source?.contact || {},
      home: source?.store?.home || source?.home || {},
      socials: source?.store?.socials || source?.socials || {},
    },
  };
}

async function loadSnapshot(orgId = "") {
  const json = readJsonFile("data/catalog.json");
  if (json && (Array.isArray(json.products) || Array.isArray(json.categories))) {
    return buildCatalogResponse(json);
  }

  const sb = supabaseAdmin();
  if (!sb) return buildCatalogResponse({ products: [], categories: [] });

  let resolvedOrgId = orgId;
  if (!resolvedOrgId) {
    try {
      resolvedOrgId = await resolveScoreOrgId(sb);
    } catch {
      resolvedOrgId = "";
    }
  }

  const [settings, productsRes, categoriesRes] = await Promise.all([
    readPublicSiteSettings(sb, resolvedOrgId).catch(() => null),
    sb
      .from("products")
      .select(
        "id, name, title, sku, description, price_cents, price_mxn, base_mxn, stock, category, section_id, sub_section, rank, img, image_url, images, sizes, active, is_active, deleted_at, metadata, created_at, updated_at"
      )
      .or(`org_id.eq.${resolvedOrgId},organization_id.eq.${resolvedOrgId}`)
      .order("rank", { ascending: true })
      .limit(100),
    sb
      .from("site_settings")
      .select("*")
      .or(`org_id.eq.${resolvedOrgId},organization_id.eq.${resolvedOrgId}`)
      .maybeSingle(),
  ]);

  const products = Array.isArray(productsRes?.data) ? productsRes.data : [];
  const categories = Array.isArray(categoriesRes?.data) ? categoriesRes.data : [];

  return buildCatalogResponse({
    products,
    categories,
    org_id: resolvedOrgId,
    ...settings,
    store: settings || {},
  });
}

function parseMessage(body = {}) {
  const msg = body?.message ?? body?.prompt ?? body?.text ?? body?.input ?? body?.query ?? body?.question ?? "";
  return clampText(msg);
}

function parseContext(body = {}) {
  const ctx = body?.context && typeof body.context === "object" ? body.context : {};
  return {
    currentProduct: safeStr(ctx.currentProduct || ctx.product || ctx.currentSku || body?.currentProduct || ""),
    currentSku: safeStr(ctx.currentSku || ctx.sku || body?.currentSku || ""),
    cartItems: safeStr(ctx.cartItems || ctx.cart || body?.cartItems || ""),
    cartTotal: safeStr(ctx.cartTotal || ctx.total || body?.cartTotal || ""),
    shipMode: safeStr(ctx.shipMode || ctx.shippingMode || body?.shipMode || ""),
    orderId: safeStr(ctx.orderId || ctx.order_id || body?.orderId || ""),
    actionHint: safeStr(ctx.actionHint || ctx.action || body?.actionHint || ""),
    category: safeStr(ctx.category || ctx.section || body?.category || ""),
    history: Array.isArray(body?.messages) ? body.messages.slice(-12) : [],
  };
}

function buildPublicPrompt({ store, stats, products, categories, context }) {
  const contact = store?.contact || {};
  const home = store?.home || {};
  const socials = store?.socials || {};

  const publicEmail = safeStr(contact.email || process.env.SUPPORT_EMAIL || "ventas.unicotextil@gmail.com");
  const publicPhone = safeStr(contact.phone || process.env.SUPPORT_PHONE || "6642368701");
  const publicWhatsApp = safeStr(
    contact.whatsapp_display || process.env.SUPPORT_WHATSAPP_DISPLAY || "664 236 8701"
  );
  const supportHours = safeStr(home.support_hours || "");
  const shippingNote = safeStr(home.shipping_note || "");
  const returnsNote = safeStr(home.returns_note || "");
  const promoText = safeStr(store?.promo_text || "");
  const heroTitle = safeStr(store?.hero_title || store?.name || "SCORE STORE");
  const maintenanceMode = !!store?.maintenance_mode;

  const productsPreview = (Array.isArray(products) ? products : [])
    .slice(0, 24)
    .map((p) => {
      const stock = safeStr(getStockLabel(p));
      return `- ${getProductName(p)} | SKU:${getProductSku(p)} | ${money(getProductPriceCents(p))} | ${stock}`;
    })
    .join("\n");

  const categoryPreview = (Array.isArray(categories) ? categories : [])
    .slice(0, 12)
    .map((c) => `- ${safeStr(c.name)} (${safeStr(c.uiId)})`)
    .join("\n");

  const historyText = Array.isArray(context.history) && context.history.length
    ? context.history
        .map((m) => {
          const role = safeStr(m.role || m.sender || "user").toLowerCase();
          const text = clampText(m.content || m.text || m.message || "", 220);
          return `${role.toUpperCase()}: ${text}`;
        })
        .join("\n")
    : "Sin historial previo.";

  return `
Eres el asistente público de Score Store.

Objetivo:
- Ayudar a clientes a comprar.
- Resolver dudas sobre productos, tallas, envíos, pagos, promo y contacto.
- Responder breve, claro y comercial.

Reglas:
- No inventes stock, precios ni tiempos exactos.
- Si no sabes un dato, dilo directo.
- Si el cliente pide ayuda humana, usa solo estos datos:
  Correo: ${publicEmail}
  WhatsApp: ${publicWhatsApp}
  Teléfono: ${publicPhone}
  Horario: ${supportHours || "No especificado"}
- Si preguntan por envíos, usa la nota pública:
  ${shippingNote || "No disponible"}
- Si preguntan por devoluciones, usa la nota pública:
  ${returnsNote || "No disponible"}
- Si el modo mantenimiento está activo, menciónalo con prudencia.
- Si ves intención clara de compra del producto actual, termina con:
  [ACTION:ADD_TO_CART:${safeStr(context.currentSku || context.currentProduct || "")}]
- Si el usuario quiere abrir carrito o pagar, termina con:
  [ACTION:OPEN_CART]

Contexto público:
- Tienda: ${heroTitle}
- Promo visible: ${promoText || "Sin promo activa"}
- Mantenimiento: ${maintenanceMode ? "sí" : "no"}
- Productos activos: ${stats?.activeProducts ?? "N/D"}
- Productos con stock bajo: ${stats?.lowStockProducts ?? "N/D"}
- Categorías visibles:
${categoryPreview || "- N/D"}

Productos visibles:
${productsPreview || "- N/D"}

Contexto del usuario:
- Producto actual: ${safeStr(context.currentProduct || "Ninguno")}
- SKU actual: ${safeStr(context.currentSku || "Ninguno")}
- Carrito: ${safeStr(context.cartItems || "Sin datos")}
- Total visible: ${safeStr(context.cartTotal || "Sin datos")}
- Modo envío: ${safeStr(context.shipMode || "Sin datos")}
- Pedido foco: ${safeStr(context.orderId || "Ninguno")}
- Sugerencia: ${safeStr(context.actionHint || "Ninguna")}
- Sección/categoría: ${safeStr(context.category || "No definida")}

Historial reciente:
${historyText}

Redes públicas:
- Facebook: ${safeStr(socials.facebook || "")}
- Instagram: ${safeStr(socials.instagram || "")}
- YouTube: ${safeStr(socials.youtube || "")}
`.trim();
}

function fallbackReply(message, store, contact) {
  const m = normalizeLower(message);
  const email = safeStr(contact?.email || process.env.SUPPORT_EMAIL || "ventas.unicotextil@gmail.com");
  const whatsapp = safeStr(
    contact?.whatsapp_display || process.env.SUPPORT_WHATSAPP_DISPLAY || "664 236 8701"
  );
  const phone = safeStr(contact?.phone || process.env.SUPPORT_PHONE || "6642368701");
  const shippingNote = safeStr(store?.home?.shipping_note || "");
  const returnsNote = safeStr(store?.home?.returns_note || "");
  const promoText = safeStr(store?.promo_text || "");

  if (m.includes("envío") || m.includes("envio")) {
    return `Puedo ayudarte con envíos. ${shippingNote || "Se calculan según destino y método disponible."} Soporte: ${whatsapp} · ${email}`;
  }

  if (m.includes("promo") || m.includes("cupón") || m.includes("cupon") || m.includes("descuento")) {
    return promoText
      ? `Promo visible: ${promoText}`
      : `No veo una promoción activa en este momento. Puedo ayudarte a revisar el carrito.`;
  }

  if (m.includes("talla") || m.includes("medida") || m.includes("size")) {
    return `Las tallas dependen del producto. Si me dices la prenda te ayudo a elegir.`;
  }

  if (m.includes("devol") || m.includes("cambio") || m.includes("return")) {
    return returnsNote
      ? returnsNote
      : `Los cambios y devoluciones dependen del caso. Soporte: ${phone} · ${email}`;
  }

  return `Estoy listo para ayudarte con catálogo, tallas, envío y checkout. Si necesitas soporte humano: ${whatsapp} · ${email}`;
}

function buildProxyRequest(req, body, channel) {
  return {
    ...req,
    body: {
      ...(body || {}),
      mode: "assistant",
      type: "assistant",
      assistant: channel,
      message: parseMessage(body),
      context: parseContext(body),
    },
  };
}

async function main(req, res) {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method === "GET") {
      const sb = supabaseAdmin();
      const orgId = sb ? await resolveScoreOrgId(sb).catch(() => "") : "";

      return send(
        res,
        jsonResponse(
          200,
          {
            ok: true,
            endpoint: "ia",
            mode: "assistant",
            available: true,
            org_id: orgId,
            model: GEMINI_API_KEY ? GEMINI_MODEL : "fallback",
          },
          origin
        )
      );
    }

    if (req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    }

    const rl = rateLimit(req);
    if (!rl.ok) {
      return send(res, jsonResponse(429, { ok: false, error: "rate_limited" }, origin));
    }

    const body = parseBody(req);
    const message = parseMessage(body);
    if (!message) {
      return send(res, jsonResponse(400, { ok: false, error: "Se requiere un mensaje válido." }, origin));
    }

    const snapshot = await loadSnapshot(safeStr(body.org_id || body.organization_id || ""));
    const context = parseContext(body);

    let resolvedOrgId = safeStr(body.org_id || body.organization_id || "");
    if (!resolvedOrgId && snapshot?.store?.org_id) resolvedOrgId = snapshot.store.org_id;
    if (!resolvedOrgId) {
      const sb = supabaseAdmin();
      if (sb) {
        try {
          resolvedOrgId = await resolveScoreOrgId(sb);
        } catch {
          resolvedOrgId = "";
        }
      }
    }

    const systemText = buildPublicPrompt({
      store: snapshot.store,
      stats: snapshot.stats,
      products: snapshot.products,
      categories: snapshot.categories,
      context,
    });

    const preferredModel = safeStr(process.env.GEMINI_MODEL || GEMINI_MODEL).trim();
    const fallbackModel = safeStr(process.env.GEMINI_FALLBACK_MODEL || GEMINI_FALLBACK_MODEL).trim();

    let replyText = "";
    let usedModel = preferredModel || "fallback";

    if (GEMINI_API_KEY) {
      try {
        replyText = await callGemini({
          apiKey: GEMINI_API_KEY,
          model: preferredModel,
          systemText,
          userText: message,
        });
      } catch (e) {
        const errMsg = String(e?.message || e || "");
        const looksLikeModelIssue = /model.*not found|404/i.test(errMsg);

        if (looksLikeModelIssue && fallbackModel && fallbackModel !== preferredModel) {
          usedModel = fallbackModel;
          replyText = await callGemini({
            apiKey: GEMINI_API_KEY,
            model: fallbackModel,
            systemText,
            userText: message,
          });
        } else {
          replyText = fallbackReply(message, snapshot.store, snapshot.store?.contact || {});
          usedModel = "fallback";
        }
      }
    } else {
      replyText = fallbackReply(message, snapshot.store, snapshot.store?.contact || {});
      usedModel = "fallback";
    }

    const rawReply = safeStr(replyText || fallbackReply(message, snapshot.store, snapshot.store?.contact || {}));
    const reply = normalizeReply(rawReply).slice(0, MAX_REPLY_LEN);
    const actions = extractActionMarkers(rawReply);

    if (actions.length && typeof sendTelegram === "function") {
      try {
        await sendTelegram(
          [
            "💬 <b>Score Store IA</b>",
            `Org: ${resolvedOrgId || snapshot.store?.org_id || "N/D"}`,
            `Actions: ${actions.map((a) => `${a.action}${a.value ? `:${a.value}` : ""}`).join(", ")}`,
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
          endpoint: "ia",
          mode: "assistant",
          org_id: resolvedOrgId || snapshot.store?.org_id || "",
          reply,
          actions,
          model: usedModel,
          store: {
            name: snapshot.store?.name || "SCORE STORE",
            hero_title: snapshot.store?.hero_title || "SCORE STORE",
            promo_active: !!snapshot.store?.promo_active,
            promo_text: safeStr(snapshot.store?.promo_text || ""),
          },
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
          error: err?.message || "No fue posible responder desde IA.",
        },
        origin
      )
    );
  }
}

module.exports = main;
module.exports.default = main;