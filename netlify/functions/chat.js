"use strict";

/**
 * =========================================================
 * chat.js (Netlify Function)
 *
 * SECURE V2026-02-26 (PRO)
 * - Gemini auth correcta: x-goog-api-key header
 * - Default model actualizado: gemini-2.5-flash-lite
 * - Manejo de error "model not found" con fallback automático
 * =========================================================
 */

const { jsonResponse, handleOptions, safeJsonParse } = require("./_shared");

const sanitizeContext = (str) => {
  return String(str || "Ninguno")
    .replace(/[\[\]{}<>\\\n\r]/g, " ")
    .trim()
    .substring(0, 150);
};

async function callGemini({ apiKey, model, systemText, userText }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const payload = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
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
    if (event.httpMethod !== "POST")
      return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);

    const body = safeJsonParse(event.body) || {};
    const message = String(body.message || "").trim().substring(0, 1000);
    const context = body.context || {};

    if (!message)
      return jsonResponse(400, { ok: false, error: "Se requiere un mensaje válido." }, origin);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      return jsonResponse(200, { ok: false, error: "El módulo de inteligencia no está conectado." }, origin);

    // Default actualizado (Feb 2026)
    const preferredModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
    const fallbackModel = "gemini-2.5-flash";

    const safeProduct = sanitizeContext(context.currentProduct);
    const safeCartItems = sanitizeContext(context.cartItems);
    const safeTotal = sanitizeContext(context.cartTotal);

    const sys = `Eres SCORE AI, el Agente Comercial Autónomo y Experto de Score Store (Merch Oficial SCORE International).
Tu objetivo principal es VENDER, asistir de forma premium y cerrar transacciones usando psicología del consumidor (escasez, prueba social, autoridad de marca).
Tono: "Tech Off-Road", cinematográfico, seguro, persuasivo, elegante y directo.

[DATOS OFICIALES DE CONTACTO CORPORATIVO]
- Correo Soporte/Ventas: ventas.unicotextil@gmail.com
- WhatsApp Oficial: 6642368701 (664 236 8701). Entrégalo si el usuario exige contacto humano, mayoreo o soporte complejo.

[TELEMETRÍA ACTUAL DEL USUARIO]
- Viendo actualmente: SKU (${safeProduct})
- En su carrito tiene: ${safeCartItems}
- Total en su carrito: ${safeTotal}

[CAPACIDADES DE AGENTE AUTÓNOMO - EJECUCIÓN EN VIVO]
TIENES EL PODER DE CONTROLAR LA PANTALLA DEL USUARIO MEDIANTE COMANDOS.
Si detectas intenciones claras, debes incluir EXACTAMENTE la etiqueta correspondiente al FINAL de tu respuesta.
- Si el usuario te pide: "agrega esto", "quiero comprar este", "dame una" (y sabes el SKU que está viendo: ${safeProduct}), usa: [ACTION:ADD_TO_CART:${safeProduct}]
- Si el usuario dice: "quiero pagar", "ver mi carrito", "dónde pago", "proceder", usa: [ACTION:OPEN_CART]

REGLAS DE ORO:
- NUNCA inventes precios.
- Envíos por Envía.com a MX/USA. Pickup gratis en fábrica en Tijuana.
- Responde siempre en español, elegante y conciso.`;

    // 1) intento con modelo preferido
    let r = await callGemini({
      apiKey,
      model: preferredModel,
      systemText: sys,
      userText: message,
    });

    // Si el modelo no existe / falla por modelo, hacemos fallback
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

    return jsonResponse(200, { ok: true, reply: String(reply).trim() }, origin);
  } catch (e) {
    return jsonResponse(
      200,
      { ok: false, error: "Sistemas tácticos de IA temporalmente fuera de línea." },
      origin
    );
  }
};