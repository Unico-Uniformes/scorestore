"use strict";

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  geminiChat,
} = require("./_shared");

const SYSTEM = `Eres SCORE AI: un asistente de tienda para SCORE Store (merch oficial fabricado por Unico Uniformes).
Responde en espanol, breve y directo.
Puedes ayudar con: tallas, envios, pagos, cambios, cuidado de prendas y recomendaciones.
Si no sabes algo, dilo y sugiere contactar por WhatsApp/soporte.`;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return handleOptions();
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });

    const body = safeJsonParse(event.body);
    const message = String(body.message || body.text || "").trim();
    if (!message) return jsonResponse(400, { ok: false, error: "Mensaje vacio" });

    const r = await geminiChat({ message, systemInstruction: SYSTEM });
    if (!r.ok) {
      return jsonResponse(500, { ok: false, error: r.error || "AI error" });
    }

    const reply = String(r.text || "").trim() || "Listo.";
    return jsonResponse(200, { ok: true, reply });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: "Chat error", details: String(e?.message || e) });
  }
};
