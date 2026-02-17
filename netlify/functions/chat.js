// netlify/functions/chat.js
// Score AI (Gemini)

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  mustEnv,
  geminiChat,
} = require("./_shared");

exports.handler = async (event) => {
  const opt = handleOptions(event);
  if (opt) return opt;

  try {
    const GEMINI_API_KEY = mustEnv("GEMINI_API_KEY");

    const body = safeJsonParse(event.body);
    const message = String(body?.message || "").trim();
    if (!message) return jsonResponse(400, { ok: false, error: "Mensaje vacío." });

    const system = `Eres Score AI, asistente de SCORE STORE (merch oficial de SCORE International, fabricado por Único Uniformes).
Responde en español, directo, comercial y útil.
Ayudas con: tallas, envíos (pickup / local TJ / Envia MX / Envia US), pagos (Stripe), dudas del catálogo.
Si falta información, sugiere WhatsApp (Linktree) o correo ventas.unicotextil@gmail.com.`;

    const prompt = `${system}\n\nUsuario: ${message}\n\nRespuesta:`;
    const reply = await geminiChat({ apiKey: GEMINI_API_KEY, prompt });

    return jsonResponse(200, { ok: true, answer: reply, reply });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { ok: false, error: err?.message || "Error en Score AI." });
  }
};
