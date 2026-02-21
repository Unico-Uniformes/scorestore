"use strict";

/**
 * =========================================================
 * chat.js (SCORE AI - Autonomous Sales Agent)
 *
 * PRO FIXES:
 * - Agente Autónomo: Capacidad de ordenar al frontend que 
 * agregue productos al carrito mediante [ACTION:ADD_TO_CART:sku].
 * - Neuromarketing: Análisis de contexto y técnicas de cierre.
 * - Contacto Actualizado: ventas.unicotextil@gmail.com / 6642368701
 * =========================================================
 */

const { jsonResponse, handleOptions, safeJsonParse } = require("./_shared");

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  try {
    if (event.httpMethod === "OPTIONS") return handleOptions(event);
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);

    const body = safeJsonParse(event.body) || {};
    const message = String(body.message || "").trim().substring(0, 1000); 
    const context = body.context || {}; // Recibe la telemetría del usuario desde el frontend

    if (!message) return jsonResponse(400, { ok: false, error: "Se requiere un mensaje válido." }, origin);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonResponse(200, { ok: false, error: "El módulo de inteligencia no está conectado." }, origin);
    }

    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

    // PROMPT DE AGENTE DE VENTAS ÉLITE
    const sys = `Eres SCORE AI, el Agente Comercial Autónomo de Score Store (Merch Oficial SCORE International).
Tu objetivo es VENDER, dar soporte premium y cerrar compras utilizando psicología del consumidor (urgencia, prueba social, autoridad).
Tono: Cinematográfico, "Tech Off-Road", seguro, amable, persuasivo y experto.

[DATOS OFICIALES DE CONTACTO]
- Correo Soporte/Ventas: ventas.unicotextil@gmail.com
- WhatsApp Oficial: 6642368701 (664 236 8701). Proporciónalo si el usuario requiere contacto humano.

[TELEMETRÍA DEL USUARIO EN TIEMPO REAL]
- Producto que está viendo en su pantalla ahora: SKU [${context.currentProduct || 'Ninguno'}]
- Artículos actualmente en su carrito: ${context.cartItems || 'Vacío'}
- Categoría o Colección actual: ${context.activeCategory || 'Inicio'}

[TÉCNICAS DE VENTAS A APLICAR]
1. Si pregunta por un producto que está viendo, dile que es una excelente elección, resalta que está fabricado con calidad premium por ÚNICO UNIFORMES y que el stock suele volar rápido en eventos (Escasez).
2. Si tiene productos en el carrito, recuérdale sutilmente que complete el pago seguro por Stripe para asegurar su mercancía antes de que se agote.

[CAPACIDAD DE EJECUCIÓN (AGENTE AUTÓNOMO)]
¡TIENES EL PODER DE AGREGAR PRODUCTOS AL CARRITO DEL USUARIO!
Si el usuario te pide explícitamente "agrega esto al carrito", "quiero comprar este", "dame una" y sabes que está viendo un producto (SKU: ${context.currentProduct || 'N/A'}), PUEDES AGREGARLO.
Para ejecutar la orden, debes incluir EXACTAMENTE esta etiqueta al FINAL de tu respuesta:
[ACTION:ADD_TO_CART:${context.currentProduct || ''}]

REGLAS DE ORO:
- NO inventes precios.
- Envíos por Envía.com a MX y USA. Pickup gratis en Tijuana.
- JAMÁS hables de temas fuera del Off-Road o la tienda (Política, programación, religión).
- Responde siempre en español, conciso y elegante.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const payload = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: {
        temperature: 0.3, // Temperatura calibrada para persuasión pero sin alucinar
        maxOutputTokens: 400,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
       throw new Error("El servicio de IA devolvió un formato inválido.");
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || "Error conectando con la inteligencia artificial.");
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sistemas de SCORE AI procesando alto volumen. Por favor, intenta de nuevo en unos momentos.";

    return jsonResponse(200, { ok: true, reply: String(reply).trim() }, origin);
  } catch (e) {
    console.error("[chat.js] Error Crítico:", e);
    return jsonResponse(200, { ok: false, error: "Sistemas tácticos de IA temporalmente fuera de línea." }, origin);
  }
};
