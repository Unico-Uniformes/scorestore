"use strict";

/**
 * =========================================================
 * quote_shipping.js (Netlify Function)
 * Endpoint: /.netlify/functions/quote_shipping
 *
 * SECURE V2026-02-21 PRO:
 * - Sanitización estricta por Regex.
 * - Prevención de inyección y sobrecarga logística.
 * =========================================================
 */

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  getEnviaQuote,
  getFallbackShipping,
  validateZip,
} = require("./_shared");

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  try {
    if (event.httpMethod === "OPTIONS") return handleOptions(event);
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);

    const body = safeJsonParse(event.body) || {};
    
    // Sanitización estricta Regex anti-inyección
    const zipRaw = String(body.postal_code || "").trim().substring(0, 15).replace(/[^a-zA-Z0-9-]/g, '');
    const country = String(body.country || "MX").trim().toUpperCase().substring(0, 2).replace(/[^A-Z]/g, '');
    const items = Array.isArray(body.items) ? body.items : [];

    const items_qty = items.reduce((sum, item) => sum + Math.max(1, (Number(item.qty) || 1)), 0);

    // Bloqueo de abuso (Máximo 200 items físicos calculables por caja)
    if (items_qty <= 0 || items_qty > 200) {
        return jsonResponse(400, { ok: false, error: "Volumen de artículos fuera de rango para cotización automática." }, origin);
    }

    const zip = validateZip(zipRaw, country);
    if (!zip) return jsonResponse(400, { ok: false, error: "Código Postal / ZIP no tiene el formato correcto." }, origin);

    try {
      const quote = await getEnviaQuote({ zip, country, items_qty });
      return jsonResponse(200, quote, origin);
    } catch (enviaError) {
      console.warn("[quote_shipping] Servicio de Envía.com no respondió a tiempo. Usando matriz de contingencia (fallback):", enviaError.message);
      const fallback = getFallbackShipping(country, items_qty);
      return jsonResponse(200, fallback, origin);
    }
  } catch (error) {
    console.error("Shipping Quote Error Interno:", error);
    return jsonResponse(500, { ok: false, error: "Servidores logísticos saturados. Intenta en unos segundos." }, origin);
  }
};