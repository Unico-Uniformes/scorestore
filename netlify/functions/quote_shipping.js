const { jsonResponse, handleOptions, safeJsonParse, getEnviaQuote, validateZip } = require("./_shared");

// Input:
// { shipping_mode:"envia_mx"|"envia_us"|"pickup"|"local_tj", postal_code:"22000", items_qty: 3 }
// Output:
// { ok:true, amount_cents: 25000, service:"Nacional Estándar", carrier:"fedex" }

function normalizeMode(body) {
  const m = String(body?.shipping_mode || body?.mode || "").toLowerCase();
  if (m === "pickup") return "pickup";
  if (m === "local_tj" || m === "local" || m === "tijuana") return "local_tj";
  if (m === "envia_us" || m === "us" || m === "usa") return "envia_us";
  return "envia_mx";
}

function sumQty(body) {
  if (Number(body?.items_qty)) return Math.max(1, Math.round(Number(body.items_qty)));
  if (Array.isArray(body?.items) && body.items.length) {
    const s = body.items.reduce((a, it) => a + (Number(it?.qty ?? it?.quantity) || 1), 0);
    return Math.max(1, Math.round(s || 1));
  }
  return 1;
}

exports.handler = async (event) => {
  const opt = handleOptions(event);
  if (opt) return opt;

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = safeJsonParse(event.body || "{}") || {};
    const mode = normalizeMode(body);

    if (mode === "pickup") {
      return jsonResponse(200, { ok: true, amount_cents: 0, service: "Pickup en fábrica", carrier: "pickup" });
    }
    if (mode === "local_tj") {
      return jsonResponse(200, { ok: true, amount_cents: 0, service: "Envío local TJ (Uber/Didi)", carrier: "local" });
    }

    const postal_code = String(body?.postal_code || body?.zip || body?.cp || "").trim();
    if (!validateZip(postal_code)) {
      return jsonResponse(400, { ok: false, error: "Código postal inválido" });
    }

    const country = mode === "envia_us" ? "US" : "MX";
    const items_qty = sumQty(body);

    const q = await getEnviaQuote({ zip: postal_code, country, items_qty });

    const amount_mxn = Number(q?.amount_mxn ?? q?.amount ?? q?.cost ?? 0) || 0;
    const amount_cents = Math.max(0, Math.round(amount_mxn * 100));

    return jsonResponse(200, {
      ok: true,
      amount_cents,
      service: q?.label || (country === "US" ? "Internacional Estándar" : "Nacional Estándar"),
      carrier: q?.carrier || null,
      provider: q?.mode || "envia",
    });
  } catch (err) {
    // fallback suave para no romper el flujo
    const fallback_mxn = 250;
    return jsonResponse(200, {
      ok: true,
      amount_cents: fallback_mxn * 100,
      service: "Envío estimado (fallback)",
      carrier: null,
      provider: "fallback",
      note: err?.message || String(err),
    });
  }
};
