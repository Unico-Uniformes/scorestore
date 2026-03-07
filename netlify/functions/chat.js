"use strict";

/**
 * =========================================================
 * chat.js (Netlify Function)
 *
 * ALINEADO A SITE_SETTINGS + CONTACTO DINÁMICO
 * - Gemini auth correcta: x-goog-api-key header
 * - Default model actualizado: gemini-2.5-flash-lite
 * - Fallback automático si el modelo no existe
 * - Ya no depende solo de hardcodes de contacto
 * =========================================================
 */

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  readPublicSiteSettings,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP_DISPLAY,
} = require("./_shared");

const sanitizeContext = (str) => {
  return String(str || "Ninguno")
    .replace(/[\[\]{}<>\\\n\r]/g, " ")
    .trim()
    .substring(0, 180);
};

async function callGemini({ apiKey, model, systemText, userText }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const payload = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  try {
    if (event.httpMethod === "OPTIONS") return handleOptions(event);

    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);
    }

    const body = safeJsonParse(event.body) || {};
    const message = String(body.message || "").trim().substring(0, 1200);
    const context = body.context || {};

    if (!message) {
      return jsonResponse(
        400,
        { ok: false, error: "Se requiere un mensaje válido." },
        origin
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        200,
        { ok: false, error: "El módulo de inteligencia no está conectado." },
        origin
      );
    }

    const site = await readPublicSiteSettings().catch(() => null);
    const contact = site?.contact || {};
    const currentEmail = String(contact.email || SUPPORT_EMAIL || "").trim();
    const currentWhatsapp = String(contact.whatsapp_display || SUPPORT_WHATSAPP_DISPLAY || "").trim();
    const currentSupportHours = String(site?.home?.support_hours || "").trim();

    const preferredModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
    const fallbackModel = "gemini-2.5-flash";

    const safeProduct = sanitizeContext(
      context.currentProduct ||
      context.currentSku ||
      context.product ||
      "Ninguno"
    );

    const safeCartItems = sanitizeContext(
      context.cartItems ||
      context.cart ||
      "Sin productos detectados"
    );

    const safeTotal = sanitizeContext(
      context.cartTotal ||
      context.total ||
      "No disponible"
    );

    const safeShipMode = sanitizeContext(
      context.shipMode ||
      context.shippingMode ||
      "No definido"
    );

    const sys = `Eres SCORE AI, el agente comercial premium de Score Store, tienda oficial de merch SCORE International.
Tu meta principal es asistir, resolver dudas y empujar la compra sin inventar información.

TONO:
- Seguro
- Elegante
- Claro
- Corto pero útil
- En español mexicano
- Nada de texto robótico

REGLAS DURAS:
- NUNCA inventes precios, stock ni promos si no vienen en el contexto.
- Si no sabes un dato exacto, dilo directo.
- No prometas descuentos no confirmados.
- No inventes tiempos de envío exactos; explica que la tarifa y tránsito se calculan en checkout.
- Si te piden contacto humano, usa SOLO estos datos vigentes:
  Correo: ${currentEmail || "No disponible"}
  WhatsApp: ${currentWhatsapp || "No disponible"}
  Horario: ${currentSupportHours || "No especificado"}

CONTEXTO ACTUAL DEL USUARIO:
- Producto actual: ${safeProduct}
- Carrito actual: ${safeCartItems}
- Total visible: ${safeTotal}
- Modo de envío visible: ${safeShipMode}

CONTEXTO OPERATIVO REAL DE LA TIENDA:
- Checkout con Stripe
- OXXO Pay disponible
- Envíos por Envia.com a MX y USA
- Pickup en fábrica en Tijuana cuando aplique

COMANDOS DE ACCIÓN:
Si detectas intención clarísima de compra sobre el producto actual, agrega EXACTAMENTE al final:
[ACTION:ADD_TO_CART:${safeProduct}]

Si detectas intención clarísima de abrir carrito o pagar, agrega EXACTAMENTE al final:
[ACTION:OPEN_CART]

No pongas ambos a menos que sea estrictamente necesario.`;

    let r = await callGemini({
      apiKey,
      model: preferredModel,
      systemText: sys,
      userText: message,
    });

    if (!r.ok) {
      const errMsg = String(r?.data?.error?.message || "");
      const looksLikeModelIssue = r.status === 404 || /model.*not found/i.test(errMsg);

      if (looksLikeModelIssue && preferredModel !== fallbackModel) {
        r = await callGemini({
          apiKey,
          model: fallbackModel,
          systemText: sys,
          userText: message,
        });
      }
    }

    if (!r.ok) {
      const msg = r?.data?.error?.message || "Error conectando con el clúster de IA.";
      return jsonResponse(200, { ok: false, error: String(msg) }, origin);
    }

    const data = r.data || {};
    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "SCORE AI no pudo generar respuesta. Intenta de nuevo.";

    return jsonResponse(
      200,
      {
        ok: true,
        reply: String(reply).trim(),
      },
      origin
    );
  } catch (e) {
    return jsonResponse(
      200,
      {
        ok: false,
        error: "Sistemas tácticos de IA temporalmente fuera de línea.",
      },
      origin
    );
  }
};