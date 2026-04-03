// api/inventory.js
"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
} = require("./_shared");

function send(res, payload) {
  const out = payload || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store";

  res.statusCode = out.statusCode || 200;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body || "");
}

function parseBody(req) {
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "*";

  if (req.method === "OPTIONS") {
    return send(res, handleOptions({ headers: req.headers }));
  }

  try {
    const sb = supabaseAdmin();

    if (req.method === "POST") {
      const body = parseBody(req);
      const items = Array.isArray(body.items) ? body.items : [];

      if (!items.length) {
        return send(res, jsonResponse(400, { ok: false, error: "no_items" }, origin));
      }

      // obtener productos
      const skus = items.map((i) => safeStr(i.sku)).filter(Boolean);

      const { data, error } = await sb
        .from("products")
        .select("id,sku,stock")
        .in("sku", skus);

      if (error) throw error;

      const map = new Map((data || []).map((p) => [p.sku, p]));

      // validar stock
      for (const item of items) {
        const sku = safeStr(item.sku);
        const qty = Number(item.quantity || 1);

        const product = map.get(sku);

        if (!product) {
          return send(res, jsonResponse(400, { ok: false, error: `sku_not_found:${sku}` }, origin));
        }

        if (product.stock < qty) {
          return send(
            res,
            jsonResponse(
              400,
              {
                ok: false,
                error: "insufficient_stock",
                sku,
                available: product.stock,
              },
              origin
            )
          );
        }
      }

      // descontar stock (transaccional básico)
      for (const item of items) {
        const sku = safeStr(item.sku);
        const qty = Number(item.quantity || 1);

        const product = map.get(sku);

        await sb
          .from("products")
          .update({
            stock: product.stock - qty,
            updated_at: new Date().toISOString(),
          })
          .eq("sku", sku);
      }

      return send(res, jsonResponse(200, { ok: true, reserved: true }, origin));
    }

    return send(res, jsonResponse(405, { ok: false }, origin));
  } catch (e) {
    return send(res, jsonResponse(500, { ok: false, error: "inventory_failed" }, origin));
  }
};