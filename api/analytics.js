// api/analytics.js
"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
} = require("./_shared");

function send(res, payload) {
  const out = payload || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store";

  res.statusCode = out.statusCode || 200;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body || "");
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "*";

  if (req.method === "OPTIONS") {
    return send(res, handleOptions({ headers: req.headers }));
  }

  if (req.method !== "GET") {
    return send(res, jsonResponse(405, { ok: false }, origin));
  }

  try {
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("orders")
      .select("amount_total_cents,status,created_at");

    if (error) throw error;

    let revenue = 0;
    let orders = 0;
    let refunded = 0;

    for (const o of data || []) {
      if (o.status === "paid" || o.status === "fulfilled") {
        revenue += Number(o.amount_total_cents || 0);
        orders++;
      }
      if (o.status === "refunded") {
        refunded++;
      }
    }

    return send(
      res,
      jsonResponse(200, {
        ok: true,
        revenue_mxn: revenue / 100,
        orders,
        refunded,
      }, origin)
    );
  } catch (e) {
    return send(res, jsonResponse(500, { ok: false, error: "analytics_failed" }, origin));
  }
};