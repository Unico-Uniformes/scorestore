exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok:false, error:"Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const destination = body.destination || {};
    const items = Array.isArray(body.items) ? body.items : [];

    const cp = String(destination.postal_code || "").trim();
    const city = String(destination.city || "").trim();
    const state = String(destination.state || "").trim();

    if (!/^\d{5}$/.test(cp) || !city || !state) {
      return json(400, { ok:false, error:"destination inválido. Requiere postal_code(5), city, state." });
    }

    const apiKey = process.env.ENVIA_API_KEY;
    if (!apiKey) {
      return json(503, { ok:false, error:"ENVIA_API_KEY no configurada" });
    }

    // ORIGEN (Único Uniformes / Score Store) — AJUSTA EN ENV VARS
    const origin = {
      postal_code: String(process.env.ENVIA_ORIGIN_POSTAL || "22000"),
      city: String(process.env.ENVIA_ORIGIN_CITY || "Tijuana"),
      state: String(process.env.ENVIA_ORIGIN_STATE || "Baja California"),
      country_code: String(process.env.ENVIA_ORIGIN_COUNTRY || "MX")
    };

    // Paquete base (merch). Para PRO: ajusta peso/dimensiones por SKU en tu admin app.
    const pkg = {
      content: "Score Store Merch",
      amount: Math.max(1, items.reduce((a,i)=>a + Number(i.qty||0), 0)),
      type: "box",
      dimensions: {
        length: Number(process.env.ENVIA_PKG_L || 32),
        width: Number(process.env.ENVIA_PKG_W || 24),
        height: Number(process.env.ENVIA_PKG_H || 8)
      },
      weight: Number(process.env.ENVIA_PKG_WEIGHT || 1.0)
    };

    const payload = {
      origin,
      destination: {
        postal_code: cp,
        city,
        state,
        country_code: "MX"
      },
      packages: [pkg]
    };

    // Endpoint típico de Envía (puede variar por cuenta/región)
    const endpoint = String(process.env.ENVIA_RATE_ENDPOINT || "https://api.envia.com/ship/rate/");
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      return json(502, { ok:false, error:"Envía.com rate failed", details: data || null });
    }

    // Normalización: escoge el más barato disponible
    const rates = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    if (!rates.length) {
      return json(404, { ok:false, error:"Sin cotizaciones disponibles", details: data });
    }

    const sorted = rates
      .map(r => ({
        carrier: r.carrier || r.carrier_name || "Carrier",
        service: r.service || r.service_name || "Servicio",
        total: Number(r.total || r.total_amount || r.price || 0)
      }))
      .filter(r => Number.isFinite(r.total) && r.total > 0)
      .sort((a,b)=>a.total-b.total);

    if (!sorted.length) {
      return json(404, { ok:false, error:"Cotizaciones inválidas", details: data });
    }

    const best = sorted[0];
    const total_cents = Math.round(best.total * 100);

    return json(200, {
      ok: true,
      quote: {
        carrier: best.carrier,
        service: best.service,
        total_cents
      }
    });

  } catch (e) {
    return json(500, { ok:false, error:"Server error", message: String(e && e.message ? e.message : e) });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    },
    body: JSON.stringify(body)
  };
}
