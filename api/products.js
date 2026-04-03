// api/products.js
"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
} = require("./_shared");

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function send(res, payload) {
  const out = payload || {};
  out.headers = out.headers || {};

  for (const [k, v] of Object.entries(noStoreHeaders)) {
    out.headers[k] = v;
  }

  res.statusCode = out.statusCode || 200;
  for (const [k, v] of Object.entries(out.headers)) {
    res.setHeader(k, v);
  }

  res.end(out.body || "");
}

function normalizeText(v) {
  return safeStr(v).trim();
}

function normalizeBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["true", "1"].includes(s)) return true;
    if (["false", "0"].includes(s)) return false;
  }
  return false;
}

function normalizeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProduct(row) {
  return {
    id: row.id,
    name: normalizeText(row.name),
    slug: normalizeText(row.slug),
    sku: normalizeText(row.sku),
    description: normalizeText(row.description),
    price_cents:
      Number(row.price_cents) ||
      Math.round(Number(row.price_mxn || 0) * 100) ||
      0,
    price_mxn:
      Number(row.price_mxn) ||
      (Number(row.price_cents || 0) / 100) ||
      0,
    currency: "MXN",
    stock: normalizeNumber(row.stock, 0),
    active:
      row.active !== false &&
      row.is_active !== false &&
      !row.deleted_at,
    category: normalizeText(row.category),
    tags: Array.isArray(row.tags) ? row.tags : [],
    images: Array.isArray(row.images) ? row.images : [],
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function getQuery(req, key) {
  try {
    if (req.query && key in req.query) {
      const v = req.query[key];
      return Array.isArray(v) ? v[0] : v;
    }
  } catch {}

  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "*";

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "GET") {
      return send(
        res,
        jsonResponse(405, { ok: false, error: "Method not allowed" }, origin)
      );
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return send(
        res,
        jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin)
      );
    }

    // filtros
    const search = normalizeText(getQuery(req, "search") || "");
    const category = normalizeText(getQuery(req, "category") || "");
    const activeOnly = normalizeBool(getQuery(req, "active") ?? true);
    const limit = Math.min(100, Math.max(1, Number(getQuery(req, "limit") || 50)));
    const offset = Math.max(0, Number(getQuery(req, "offset") || 0));

    let query = sb
      .from("products")
      .select("*")
      .range(offset, offset + limit - 1)
      .order("created_at", { ascending: false });

    if (activeOnly) {
      query = query.is("deleted_at", null).eq("active", true);
    }

    if (category) {
      query = query.eq("category", category);
    }

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,sku.ilike.%${search}%,description.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const products = (data || []).map(normalizeProduct);

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          products,
          total: products.length,
          limit,
          offset,
        },
        origin
      )
    );
  } catch (err) {
    return send(
      res,
      jsonResponse(
        500,
        {
          ok: false,
          error: err?.message || "products_failed",
        },
        origin
      )
    );
  }
};