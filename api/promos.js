"use strict";

const { jsonResponse, handleOptions, readJsonFile } = require("./_shared");

const DEFAULT_PROMOS = {
  rules: [
    {
      code: "SCORE25",
      type: "percent",
      value: 0.25,
      description: "25% OFF por Inauguración",
      active: true,
      min_amount_mxn: 1000,
      expires_at: "2026-12-31T23:59:59Z",
    },
    {
      code: "BAJA25",
      type: "percent",
      value: 0.25,
      description: "25% OFF Cupón Baja",
      active: true,
      min_amount_mxn: 0,
      expires_at: "2026-12-31T23:59:59Z",
    },
    {
      code: "SCORE10",
      type: "percent",
      value: 0.1,
      description: "10% OFF Fans",
      active: true,
      min_amount_mxn: 500,
      expires_at: "2027-01-01T00:00:00Z",
    },
    {
      code: "BAJA200",
      type: "fixed_mxn",
      value: 200,
      description: "$200 MXN OFF en tu carrito",
      active: true,
      min_amount_mxn: 1500,
      expires_at: null,
    },
    {
      code: "ENVIOFREE",
      type: "free_shipping",
      value: 0,
      description: "Envío Gratis a todo México",
      active: true,
      min_amount_mxn: 2000,
      expires_at: null,
    },
  ],
};

const withNoStore = (resp) => {
  const out = resp || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"] = "no-cache";
  out.headers["Expires"] = "0";
  return out;
};

const send = (res, resp) => {
  const out = withNoStore(resp);
  if (out.headers) {
    Object.keys(out.headers).forEach((key) => res.setHeader(key, out.headers[key]));
  }
  res.status(out.statusCode || 200).send(out.body);
};

const cleanCode = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");
const now = () => new Date();

const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isExpired = (promo) => {
  const expires = parseDate(promo?.expires_at);
  if (!expires) return false;
  return expires.getTime() < now().getTime();
};

const normalizeRule = (rule) => {
  if (!rule || typeof rule !== "object") return null;

  const code = cleanCode(rule.code);
  if (!code) return null;

  const type = String(rule.type || "").trim().toLowerCase();
  const value = Number(rule.value || 0);
  const minAmount = Number(rule.min_amount_mxn || 0);
  const active = rule.active == null ? true : !!rule.active;
  const expiresAt = rule.expires_at || null;

  return {
    code,
    type,
    value: Number.isFinite(value) ? value : 0,
    description: String(rule.description || "").trim(),
    active,
    min_amount_mxn: Number.isFinite(minAmount) ? minAmount : 0,
    expires_at: expiresAt,
  };
};

const loadPromos = () => {
  const fallback = readJsonFile("data/promos.json");
  const source = fallback && typeof fallback === "object" ? fallback : DEFAULT_PROMOS;
  const rules = Array.isArray(source.rules) ? source.rules : Array.isArray(source.promos) ? source.promos : [];
  const normalized = rules.map(normalizeRule).filter(Boolean);
  return { rules: normalized };
};

const computeValidity = (promo, subtotalMxn) => {
  if (!promo) return { valid: false, reason: "NOT_FOUND" };
  if (!promo.active) return { valid: false, reason: "INACTIVE" };
  if (isExpired(promo)) return { valid: false, reason: "EXPIRED" };
  if (Number(subtotalMxn || 0) < Number(promo.min_amount_mxn || 0)) {
    return { valid: false, reason: "MIN_AMOUNT" };
  }
  return { valid: true, reason: "OK" };
};

module.exports = async (req, res) => {
  const origin = req.headers.origin || req.headers.Origin || "*";

  if (req.method === "OPTIONS") {
    const optionsRes = handleOptions?.({ headers: { origin } }) || {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: "",
    };
    return send(res, optionsRes);
  }

  if (req.method !== "GET") {
    return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
  }

  const promos = loadPromos();
  const code = cleanCode(req.query?.code || req.query?.coupon || req.query?.promo || "");
  const subtotalMxn = Number(req.query?.subtotal_mxn || req.query?.amount_mxn || 0);

  if (!code) {
    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          rules: promos.rules,
          count: promos.rules.length,
        },
        origin
      )
    );
  }

  const promo = promos.rules.find((r) => cleanCode(r.code) === code) || null;
  const verdict = computeValidity(promo, subtotalMxn);

  return send(
    res,
    jsonResponse(
      200,
      {
        ok: true,
        valid: verdict.valid,
        reason: verdict.reason,
        promo: promo && verdict.valid ? promo : null,
        rules: promos.rules,
      },
      origin
    )
  );
};