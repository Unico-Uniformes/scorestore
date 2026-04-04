// api/ai.js
"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
  isUuid,
  resolveScoreOrgId,
  readPublicSiteSettings,
  sendTelegram,
} = require("./_shared");
const { requireAdmin } = require("./_auth");

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
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
  return req?.headers?.origin || req?.headers?.Origin || "*";
}

function getBearerToken(req) {
  const h = req?.headers?.authorization || req?.headers?.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

function json(statusCode, data, origin = "*") {
  return jsonResponse(statusCode, data, origin);
}

function clampText(v, max = MAX_MESSAGE_LEN) {
  return String(v ?? "").trim().slice(0, max);
}

function normalizeBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  return fallback;
}

function parseOrgId(body = {}, req = null) {
  const fromBody = safeStr(body?.org_id || body?.orgId || body?.organization_id || "").trim();
  if (fromBody) return fromBody;

  try {
    const url = req?.url ? new URL(req.url, "http://localhost") : null;
    const fromQuery = safeStr(url?.searchParams.get("org_id") || url?.searchParams.get("orgId") || "").trim();
    if (fromQuery) return fromQuery;
  } catch {}

  return "";
}

function parseMessage(body = {}) {
  const raw = body?.message ?? body?.prompt ?? body?.text ?? body?.input ?? "";
  return clampText(raw);
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
  };
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeText(v) {
  return safeStr(v).trim();
}

function extractActionMarkers(text) {
  const raw = String(text || "");
  const actions = [];
  const regex = /\[ACTION:([A-Z_]+)(?::([^\]]+))?\]/g;

  for (const match of raw.matchAll(regex)) {
    actions.push({
      action: safeStr(match[1]).toUpperCase(),
      value: safeStr(match[2]).trim(),
    });
  }

  return actions;
}

function stripActionMarkers(text) {
  return String(text || "")
    .replace(/\[ACTION:[A-Z_]+(?::[^\]]+)?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeGeminiError(e) {
  const msg = String(e?.message || e || "");
  if (/model.*not found|404/i.test(msg)) {
    return "El modelo de IA configurado no está disponible. Revisa GEMINI_MODEL en Vercel.";
  }
  if (/api key|unauth|permission|denied|401|403/i.test(msg)) {
    return "La IA no tiene permiso o llave válida en este momento.";
  }
  return "La IA del panel no pudo completar la solicitud.";
}

function clampReply(reply) {
  return String(reply || "").trim().slice(0, MAX_REPLY_LEN);
}

function buildSystemPrompt({ orgName, role, settings, orders, products, audit, context }) {
  const contact = settings?.contact || {};
  const home = settings?.home || {};
  const socials = settings?.socials || {};

  const publicEmail = normalizeText(
    contact.email ||
      process.env.SUPPORT_EMAIL ||
      process.env.FACTORY_EMAIL ||
      "ventas.unicotextil@gmail.com"
  );

  const publicPhone = normalizeText(contact.phone || process.env.SUPPORT_PHONE || "6642368701");
  const publicWhatsApp = normalizeText(
    contact.whatsapp_display || process.env.SUPPORT_WHATSAPP_DISPLAY || "664 236 8701"
  );
  const supportHours = normalizeText(home.support_hours || "");
  const shippingNote = normalizeText(home.shipping_note || "");
  const returnsNote = normalizeText(home.returns_note || "");
  const promoText = normalizeText(settings?.promo_text || "");
  const heroTitle = normalizeText(settings?.hero_title || "SCORE STORE");
  const footerNote = normalizeText(home.footer_note || "");
  const maintenanceMode = normalizeBool(settings?.maintenance_mode, false);

  const safeProduct = normalizeText(context.currentProduct || "Ninguno");
  const safeSku = normalizeText(context.currentSku || "Ninguno");
  const safeCartItems = normalizeText(context.cartItems || "Sin datos");
  const safeTotal = normalizeText(context.cartTotal || "Sin datos");
  const safeShipMode = normalizeText(context.shipMode || "Sin datos");
  const safeOrderId = normalizeText(context.orderId || "Ninguno");
  const safeActionHint = normalizeText(context.actionHint || "Ninguna");
  const safeCategory = normalizeText(context.category || "No definida");

  return `
Eres SCORE AI, la agente comercial y operativa de Score Store.

OBJETIVO:
- Resolver dudas.
- Guiar a compra.
- Explicar el proceso de forma clara.
- Ayudar con carrito, pago, envío, tallas, promociones visibles y contacto.

TONO:
- Seguro.
- Claro.
- Comercial.
- Corto pero útil.
- Nada de tecnicismos.
- Nada de texto robótico.
- Sonido premium y confiable.

REGLAS DURAS:
- Nunca inventes precios, stock, promos ni tiempos exactos si no vienen en contexto.
- Si no sabes un dato, dilo directo y ofrece el siguiente paso útil.
- Si el usuario pide ayuda humana, usa solo estos datos vigentes:
  Correo: ${publicEmail}
  WhatsApp: ${publicWhatsApp}
  Teléfono: ${publicPhone}
  Horario: ${supportHours || "No especificado"}
- Si preguntan cómo comprar, explica el flujo real: elegir producto, talla, carrito, envío, pago y confirmación.
- Si preguntan por pagos, explica solo lo que sí está disponible: Stripe, tarjeta y OXXO Pay cuando aplique.
- Si preguntan por envíos, explica que se calculan según destino y que hay MX, USA y pickup cuando corresponda.
- Si hay notas públicas activas sobre envíos o cambios, puedes usarlas:
  Nota de envíos: ${shippingNote || "No disponible"}
  Nota de cambios o devoluciones: ${returnsNote || "No disponible"}
- Si preguntas por el sitio, referencia pública: ${heroTitle}
- Si preguntas por redes o contacto, no inventes: usa solo datos del contexto.
- Nunca prometas acciones del sistema que no fueron confirmadas por el backend.
- Si el modo mantenimiento está activo, menciónalo con prudencia.

CONTEXTO DE ORGANIZACIÓN:
- Organización activa: ${orgName || "Sin nombre"}
- Rol del usuario: ${role || "desconocido"}
- Hero / referencia pública: ${heroTitle}
- Promo visible: ${settings?.promo_active ? "activa" : "inactiva"}
- Promo text: ${promoText}
- Modo mantenimiento: ${maintenanceMode ? "sí" : "no"}
- Nota envíos: ${shippingNote}
- Nota devoluciones: ${returnsNote}
- Horario soporte: ${supportHours}
- Contacto público: ${publicEmail}
- Teléfono: ${publicPhone}
- WhatsApp: ${publicWhatsApp}
- Footer note pública: ${footerNote || "Sin nota"}
- Redes públicas: Facebook=${normalizeText(socials.facebook || "")}, Instagram=${normalizeText(socials.instagram || "")}, YouTube=${normalizeText(socials.youtube || "")}

RESUMEN OPERATIVO:
- Pedidos recientes: ${orders.totalOrders}
- Pedidos pagados: ${orders.paidOrders}
- Pedidos pendientes: ${orders.pendingOrders}
- Pedidos reembolsados: ${orders.refundedOrders}
- Valor visible reciente: ${orders.valueMXN} MXN
- Productos activos: ${products.activeProducts}
- Productos con stock bajo: ${products.lowStockProducts}
- Registros de auditoría recientes: ${audit.totalAudit}

USO DE CONTEXTO DEL USUARIO:
- Producto actual: ${safeProduct}
- SKU actual: ${safeSku}
- Carrito actual: ${safeCartItems}
- Total visible: ${safeTotal}
- Modo de envío visible: ${safeShipMode}
- Pedido en foco: ${safeOrderId}
- Sugerencia de acción: ${safeActionHint}
- Categoría/Sección visible: ${safeCategory}

INSTRUCCIONES:
- Si te preguntan por pedidos, usa el resumen operativo.
- Si te preguntan por catálogo, habla solo de productos visibles y stock.
- Si te preguntan por settings, usa el estado de promo, mantenimiento, hero y notas públicas.
- Si te preguntan por finanzas, habla en términos simples y con prudencia.
- Si te piden una acción, descríbela como paso claro y exacto.
- Si la información no está disponible, dilo sin rodeos.

COMANDOS DE ACCIÓN:
Si detectas intención clarísima de compra sobre el producto actual, agrega exactamente al final:
[ACTION:ADD_TO_CART:${safeProduct}]

Si detectas intención clarísima de abrir carrito o pagar, agrega exactamente al final:
[ACTION:OPEN_CART]

Usa comandos solo cuando de verdad ayuden.
`.trim();
}

function extractTextFromGeminiResponse(response) {
  try {
    const text = response?.text?.();
    if (typeof text === "string" && text.trim()) return text.trim();
  } catch {}

  const parts = response?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p) => safeStr(p?.text || ""))
    .join("")
    .trim();

  return text || "";
}

async function callGemini({ apiKey, model, systemText, userText }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({
    model,
    systemInstruction: systemText,
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 1024,
    },
  });

  const result = await gm.generateContent(userText);
  const response = result?.response;
  const text = extractTextFromGeminiResponse(response);
  return { response, text };
}

async function authorize(req, sb, orgId) {
  const token = getBearerToken(req);
  const adminCheck = requireAdmin(req);

  if (!adminCheck?.ok) {
    return { ok: false, res: json(401, { ok: false, error: adminCheck?.error || "No autorizado" }) };
  }

  const { user, error: authErr } = await requireUserFromToken(sb, token);
  if (authErr || !user) {
    return { ok: false, res: json(401, { ok: false, error: "No autorizado" }) };
  }

  const role = await getMyRoleForOrg(sb, orgId, user);
  if (!role || !hasPerm(role, "ai")) {
    return { ok: false, res: json(403, { ok: false, error: "Permisos insuficientes" }) };
  }

  return { ok: true, user, role };
}

async function loadOrgContext(sb, orgId) {
  const [settingsRes, ordersRes, productsRes, auditRes] = await Promise.all([
    readPublicSiteSettings(sb, orgId).catch(() => null),
    sb
      .from("orders")
      .select("id, amount_total_mxn, payment_status, status, created_at")
      .or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("products")
      .select("id, name, sku, stock, is_active, active, deleted_at")
      .or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
      .is("deleted_at", null)
      .limit(100),
    sb
      .from("audit_log")
      .select("id, action, summary, created_at")
      .or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const orders = Array.isArray(ordersRes?.data) ? ordersRes.data : [];
  const products = Array.isArray(productsRes?.data) ? productsRes.data : [];
  const audit = Array.isArray(auditRes?.data) ? auditRes.data : [];

  const totalOrders = orders.length;
  const paidOrders = orders.filter((o) => {
    const status = safeStr(o?.status || o?.payment_status || "").toLowerCase();
    return status === "paid" || status === "fulfilled";
  }).length;

  const pendingOrders = orders.filter((o) => {
    const status = safeStr(o?.status || o?.payment_status || "").toLowerCase();
    return ["pending", "open", "unpaid", "pending_payment"].includes(status);
  }).length;

  const refundedOrders = orders.filter((o) => {
    const status = safeStr(o?.status || o?.payment_status || "").toLowerCase();
    return status === "refunded";
  }).length;

  const valueMXN = orders.reduce((sum, o) => sum + safeNum(o?.amount_total_mxn, 0), 0);
  const activeProducts = products.filter((p) => p?.active !== false && p?.is_active !== false && !p?.deleted_at).length;
  const lowStockProducts = products.filter((p) => safeNum(p?.stock, 999) > 0 && safeNum(p?.stock, 999) <= 5).length;

  return {
    settings: settingsRes || null,
    orders: {
      totalOrders,
      paidOrders,
      pendingOrders,
      refundedOrders,
      valueMXN: Math.round(valueMXN * 100) / 100,
    },
    products: {
      activeProducts,
      lowStockProducts,
    },
    audit: {
      totalAudit: audit.length,
    },
  };
}

async function main(req, res) {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return send(
        res,
        jsonResponse(200, {
          ok: false,
          error: "La IA no está conectada en este momento.",
        }, origin)
      );
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return send(
        res,
        jsonResponse(500, { ok: false, error: "Supabase no configurado" }, origin)
      );
    }

    const body = typeof req.body === "object" && req.body ? req.body : (await (async () => {
      try {
        return req.body ? JSON.parse(req.body) : {};
      } catch {
        return {};
      }
    })());

    const orgId = parseOrgId(body, req);
    const message = parseMessage(body);
    const context = parseContext(body);

    if (!isUuid(orgId)) {
      return send(res, jsonResponse(400, { ok: false, error: "org_id inválido" }, origin));
    }

    if (!message) {
      return send(res, jsonResponse(400, { ok: false, error: "Se requiere un mensaje válido." }, origin));
    }

    const auth = await authorize(req, sb, orgId);
    if (!auth.ok) return send(res, auth.res);

    const orgContext = await loadOrgContext(sb, orgId);
    const orgName =
      safeStr(orgContext?.settings?.organization?.name || orgContext?.settings?.organization?.slug || "") ||
      "Organización";

    const systemText = buildSystemPrompt({
      orgName,
      role: auth.role,
      settings: orgContext.settings,
      orders: orgContext.orders,
      products: orgContext.products,
      audit: orgContext.audit,
      context,
    });

    const preferredModel = safeStr(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
    const fallbackModel = safeStr(process.env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL).trim();

    let geminiResult;
    let usedModel = preferredModel;

    try {
      geminiResult = await callGemini({
        apiKey,
        model: preferredModel,
        systemText,
        userText: message,
      });
    } catch (e) {
      const errMsg = String(e?.message || e || "");
      const looksLikeModelIssue = /model.*not found|404/i.test(errMsg);

      if (looksLikeModelIssue && fallbackModel && fallbackModel !== preferredModel) {
        usedModel = fallbackModel;
        geminiResult = await callGemini({
          apiKey,
          model: fallbackModel,
          systemText,
          userText: message,
        });
      } else {
        return send(res, jsonResponse(200, { ok: false, error: normalizeGeminiError(e) }, origin));
      }
    }

    const rawReply = safeStr(geminiResult?.text || "No pude generar una respuesta en este momento.");
    const reply = clampReply(stripActionMarkers(rawReply));
    const actions = extractActionMarkers(rawReply);

    try {
      await writeAudit(sb, {
        organization_id: orgId,
        actor_email: normEmail(auth.user?.email),
        actor_user_id: auth.user?.id || null,
        action: "ai.chat",
        entity: "ai",
        entity_id: orgId,
        summary: clampText(message, 220),
        after: {
          reply_preview: clampText(reply, 400),
          actions,
        },
        meta: {
          role: auth.role,
          model: usedModel,
          source: "api/ai",
          context: {
            currentProduct: context.currentProduct || null,
            currentSku: context.currentSku || null,
            orderId: context.orderId || null,
            actionHint: context.actionHint || null,
          },
        },
        ip: req.headers?.["x-forwarded-for"] || null,
        user_agent: req.headers?.["user-agent"] || null,
      });
    } catch {}

    if (typeof sendTelegram === "function") {
      try {
        if (actions.length) {
          await sendTelegram(
            [
              "🤖 <b>Acción IA detectada</b>",
              `Org: ${orgName}`,
              `Role: ${auth.role}`,
              `Actions: ${actions.map((a) => `${a.action}${a.value ? `:${a.value}` : ""}`).join(", ")}`,
            ].join("\n")
          );
        }
      } catch {}
    }

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          reply,
          actions,
          model: usedModel,
          org_id: orgId,
          org_name: orgName,
        },
        origin
      )
    );
  } catch (e) {
    return send(
      res,
      jsonResponse(
        500,
        { ok: false, error: String(e?.message || e) },
        origin
      )
    );
  }
}

module.exports = main;
module.exports.default = main;
module.exports.POST = async (req, res) => main(req, res);
module.exports.GET = async () => jsonResponse(405, { ok: false, error: "Method not allowed" });
module.exports.OPTIONS = async () => jsonResponse(204, {});