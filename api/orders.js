// api/orders.js
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

function q(req, key) {
  try {
    const url = new URL(req.url, "http://x");
    return url.searchParams.get(key);
  } catch {
    return null;
  }
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

    const status = safeStr(q(req, "status"));
    const email = safeStr(q(req, "email"));
    const limit = Math.min(100, Number(q(req, "limit") || 50));
    const offset = Math.max(0, Number(q(req, "offset") || 0));

    let query = sb
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (email) query = query.ilike("customer_email", `%${email}%`);

    const { data, error } = await query;
    if (error) throw error;

    return send(
      res,
      jsonResponse(200, {
        ok: true,
        orders: data || [],
        total: (data || []).length,
      }, origin)
    );
  } catch (e) {
    return send(res, jsonResponse(500, { ok: false, error: "orders_failed" }, origin));
  }
};