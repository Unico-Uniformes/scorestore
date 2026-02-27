"use strict";

/**
 * =========================================================
 * chat.js (Netlify Function)
 *
 * SECURE V2026-02-26 (PRO)
 * - Prompt injection: contexto sanitizado (sin llaves/brackets/saltos).
 * - Gemini 1.0/1.5 ya está retirado (responde 404). Default actualizado.
 * - Implementación alineada con endpoint oficial `models:generateContent`.
 *   https://generativelanguage.googleapis.com/v1beta/models/*:generateContent
 * =========================================================
 */

const { jsonResponse, handleOptions, safeJsonParse } = require("./_shared");

// Sanitización para reducir prompt-injection (quita caracteres de control)
const sanitizeContext = (str) =>
  String(str || "Ninguno")
    .replace(/[\[\]{}<>\\\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 180);

// Feb 2026: default robusto (2.5) para evitar 404 por modelos retirados.
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  try {
    if (event.httpMethod === "OPTIONS") return handleOptions(event);
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);
    }

    const body = safeJsonParse(event.body) || {};
    const message = String(body.message || "").trim().substring(0, 1000);
    const context = body.context || {};

    if (!message) {
      return jsonResponse(400, { ok: false, error: "Se requiere un mensaje válido." }, origin);
    }

    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return jsonResponse(200, { ok: false, error: "El módulo de inteligencia no está conectado." }, origin);
    }

    const model = String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

    // Contexto del usuario (sanitizado)
    const safeProduct = sanitizeContext(context.currentProduct);
    const safeCartItems = sanitizeContext(context.cartItems);
    const safeTotal = sanitizeContext(context.cartTotal);

    const sys = `Eres SCORE AI, el Agente Comercial Autónomo y Experto de Score Store (Merch Oficial SCORE International).
Tu objetivo principal es VENDER, asistir premium y cerrar transacciones.
Tono: Tech Off-Road, cinematográfico, seguro, persuasivo, elegante y directo.

[DATOS OFICIALES]
- Correo Soporte/Ventas: ventas.unicotextil@gmail.com
- WhatsApp Oficial: 6642368701

[TELEMETRÍA]
- Viendo: SKU (${safeProduct})
- Carrito: ${safeCartItems}
- Total: ${safeTotal}

[COMANDOS]
Si el usuario quiere comprar el SKU que está viendo (${safeProduct}), termina tu respuesta con:
[ACTION:ADD_TO_CART:${safeProduct}]
Si el usuario quiere pagar o ver carrito, termina con:
[ACTION:OPEN_CART]

Reglas:
- No inventes precios.
- Envíos por Envía (MX/USA) y Pickup gratis en Tijuana.
- Responde siempre en español, conciso.`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

    const payload = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 420 },
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // recomendado: header en lugar de query param
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = String(data?.error?.message || "");

      if (res.status === 404) {
        return jsonResponse(
          200,
          {
            ok: false,
            error:
              "La IA está configurada con un modelo que ya no existe. Ajusta GEMINI_MODEL (recomendado: gemini-2.5-flash-lite).",
            detail: msg.slice(0, 240) || "Model not found",
          },
          origin
        );
      }

      return jsonResponse(
        200,
        {
          ok: false,
          error: "SCORE AI no respondió. Intenta otra vez.",
          detail: msg.slice(0, 240) || `HTTP ${res.status}`,
        },
        origin
      );
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "SCORE AI está ocupado. Intenta otra vez en un momento.";

    return jsonResponse(200, { ok: true, reply: String(reply).trim() }, origin);
  } catch (_e) {
    return jsonResponse(200, { ok: false, error: "Sistemas tácticos de IA temporalmente fuera de línea." }, origin);
  }
};