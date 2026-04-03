// api/product_by_slug.js
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

function normalize(row) {
  return {
    id: row.id,
    name: safeStr(row.name),
    slug: safeStr(row.slug),
    sku: safeStr(row.sku),
    description: safeStr(row.description),
    price_cents: Number(row.price_cents || 0),
    price_mxn: Number(row.price_mxn || row.price_cents / 100 || 0),
    stock: Number(row.stock || 0),
    category: safeStr(row.category),
    images: Array.isArray(row.images) ? row.images : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    active: row.active !== false,
    seo: {
      title: safeStr(row.seo_title || row.name),
      description: safeStr(row.seo_description || row.description),
    },
  };
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
    const url = new URL(req.url, "http://x");
    const slug = safeStr(url.searchParams.get("slug"));

    if (!slug) {
      return send(res, jsonResponse(400, { ok: false, error: "slug_required" }, origin));
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("products")
      .select("*")
      .eq("slug", slug)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return send(res, jsonResponse(404, { ok: false, error: "not_found" }, origin));
    }

    return send(res, jsonResponse(200, { ok: true, product: normalize(data) }, origin));
  } catch (e) {
    return send(res, jsonResponse(500, { ok: false, error: "product_failed" }, origin));
  }
};