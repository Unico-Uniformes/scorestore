// api/categories.js
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
      .from("products")
      .select("category")
      .is("deleted_at", null)
      .eq("active", true);

    if (error) throw error;

    const categories = [
      ...new Set(
        (data || [])
          .map((x) => safeStr(x.category))
          .filter(Boolean)
      ),
    ];

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          categories,
          total: categories.length,
        },
        origin
      )
    );
  } catch (e) {
    return send(res, jsonResponse(500, { ok: false, error: "categories_failed" }, origin));
  }
};