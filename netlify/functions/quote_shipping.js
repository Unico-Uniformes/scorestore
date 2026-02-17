"use strict";

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  validateZip,
  itemsQtyFromAny,
  getEnviaQuote,
  getFallbackShipping,
} = require("./_shared");

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return handleOptions();
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });

    const body = safeJsonParse(event.body);

    // Backward compat:
    // - destination_zip (old)
    // - postal_code (new)
    const zip = String(body.postal_code || body.destination_zip || "").trim();
    const mode = String(body.shipping_mode || "envia_mx").toLowerCase();

    if (!validateZip(zip)) return jsonResponse(400, { ok: false, error: "Codigo postal invalido" });

    const country =
      String(body.country || "")
        .trim()
        .toUpperCase() || (mode === "envia_us" ? "US" : "MX");

    const items_qty = itemsQtyFromAny(body.items_qty || body.items || 1);

    let quote = await getEnviaQuote({ zip, country, items_qty, items: body.items });
    if (!quote?.ok || !(Number(quote?.amount_mxn) > 0)) {
      quote = getFallbackShipping(country, items_qty);
    }

    const amount_mxn = Number(quote.amount_mxn || 0) || 0;

    return jsonResponse(200, {
      ok: true,
      provider: quote.provider || "envia",
      country,
      items_qty,
      amount_mxn,
      amount: Math.round(amount_mxn * 100),
      amount_cents: Math.round(amount_mxn * 100),
      label: quote.label || "Standard",
      carrier: quote.carrier || null,
      raw: quote.raw || null,
    });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: "Quote error", details: String(e?.message || e) });
  }
};
