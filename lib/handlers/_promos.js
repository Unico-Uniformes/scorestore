// lib/handlers/_promos.js
// (antes: api/_promos.js — movido a lib/handlers/ para no consumir cuota Vercel)
"use strict";

const fs   = require("fs");
const path = require("path");

const DEFAULT_PROMOS = {
  store: {
    name: "SCORE STORE",
    currency: "MXN",
  },
  rules: [
    {
      code: "SCORE10",
      type: "percent",
      value: 10,
      description: "10% de descuento en productos seleccionados de la tienda.",
      active: true,
      min_amount_mxn: 999,
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

// ── Response helper (Node HTTP nativo — NO Express) ─────────────────────────
// BUG FIX: el original usaba res.status().send() que es API de Express.
// Vercel Serverless usa Node HTTP nativo: res.statusCode + res.end()
function send(res, statusCode, headers, body) {
  res.statusCode = statusCode || 200;
  const allHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    ...headers,
  };
  for (const [key, value] of Object.entries(allHeaders)) {
    res.setHeader(key, value);
  }
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function corsHeaders(origin) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

// ── Utils ───────────────────────────────────────────────────────────────────
const cleanCode = (v) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const cleanText = (v, fallback = "") => {
  const s = typeof v === "string" ? v : v == null ? fallback : String(v);
  return s.trim();
};

const moneyToCents = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isExpired = (promo) => {
  const expires = parseDate(promo?.expires_at);
  if (!expires) return false;
  return expires.getTime() < Date.now();
};

const readJsonFile = (relPath) => {
  try {
    const p1 = path.join(process.cwd(), relPath);
    const p2 = path.join(__dirname, "..", "..", relPath); // lib/handlers → root
    const file = fs.existsSync(p1) ? p1 : p2;
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// ── Normalize ───────────────────────────────────────────────────────────────
const normalizeRule = (rule) => {
  if (!rule || typeof rule !== "object") return null;
  const code = cleanCode(rule.code);
  if (!code) return null;
  const type      = cleanText(rule.type || "").toLowerCase();
  const value     = Number(rule.value || 0);
  const minAmount = Number(rule.min_amount_mxn || 0);
  const active    = rule.active == null ? true : !!rule.active;
  return {
    code,
    type,
    value:          Number.isFinite(value) ? value : 0,
    description:    cleanText(rule.description || ""),
    active,
    min_amount_mxn: Number.isFinite(minAmount) ? minAmount : 0,
    expires_at:     rule.expires_at || null,
  };
};

const loadPromos = () => {
  try {
    const json   = readJsonFile("data/promos.json");
    const source = json && typeof json === "object" ? json : DEFAULT_PROMOS;
    const rules  = Array.isArray(source.rules)
      ? source.rules
      : Array.isArray(source.promos)
        ? source.promos
        : [];
    return {
      rules: rules.map(normalizeRule).filter(Boolean),
      store: source.store || DEFAULT_PROMOS.store,
    };
  } catch {
    return { rules: [], store: DEFAULT_PROMOS.store };
  }
};

// ── Validity & math ─────────────────────────────────────────────────────────
const computeValidity = (promo, subtotalMxn) => {
  if (!promo)        return { valid: false, reason: "NOT_FOUND" };
  if (!promo.active) return { valid: false, reason: "INACTIVE" };
  if (isExpired(promo)) return { valid: false, reason: "EXPIRED" };
  const subtotal = Number(subtotalMxn || 0);
  if (subtotal < Number(promo.min_amount_mxn || 0)) {
    return { valid: false, reason: "MIN_AMOUNT" };
  }
  return { valid: true, reason: "OK" };
};

const computePromo = (promo, subtotalCents) => {
  if (!promo || !promo.active || isExpired(promo)) {
    return { promo: null, discount_cents: 0, free_shipping: false };
  }
  if (subtotalCents < moneyToCents(promo.min_amount_mxn || 0)) {
    return { promo: null, discount_cents: 0, free_shipping: false };
  }

  const type = String(promo.type || "").toLowerCase();

  if (["free_shipping", "freeshipping"].includes(type)) {
    return { promo, discount_cents: 0, free_shipping: true };
  }

  if (["percent", "percentage", "percent_off"].includes(type)) {
    const raw  = Number(promo.value || 0);
    const rate = raw > 1 ? raw / 100 : raw;
    const discount = Math.round(subtotalCents * (Number.isFinite(rate) ? rate : 0));
    return {
      promo,
      discount_cents: Math.max(0, Math.min(subtotalCents, discount)),
      free_shipping: false,
    };
  }

  if (["fixed", "fixed_mxn", "fixed_off"].includes(type)) {
    const discount = moneyToCents(promo.value || 0);
    return {
      promo,
      discount_cents: Math.max(0, Math.min(subtotalCents, discount)),
      free_shipping: false,
    };
  }

  return { promo: null, discount_cents: 0, free_shipping: false };
};

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const origin = req.headers?.origin || req.headers?.Origin || "*";

  if (req.method === "OPTIONS") {
    return send(res, 204, corsHeaders(origin), "");
  }

  if (req.method !== "GET") {
    return send(res, 405, corsHeaders(origin), JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  const promos        = loadPromos();
  const query         = req.query || {};
  const code          = cleanCode(query.code || query.coupon || query.promo || "");
  const subtotalMxn   = Number(query.subtotal_mxn || query.amount_mxn || 0);
  const subtotalCents = moneyToCents(subtotalMxn);

  // Sin código → devuelve lista completa
  if (!code) {
    return send(
      res,
      200,
      corsHeaders(origin),
      JSON.stringify({
        ok:    true,
        store: promos.store,
        rules: promos.rules,
        count: promos.rules.length,
      })
    );
  }

  // Con código → valida y calcula
  const promo     = promos.rules.find((r) => cleanCode(r.code) === code) || null;
  const verdict   = computeValidity(promo, subtotalMxn);
  const promoMath = verdict.valid
    ? computePromo(promo, subtotalCents)
    : { promo: null, discount_cents: 0, free_shipping: false };

  return send(
    res,
    200,
    corsHeaders(origin),
    JSON.stringify({
      ok:    true,
      store: promos.store,
      query: { code, subtotal_mxn: subtotalMxn, subtotal_cents: subtotalCents },
      validity: verdict,
      ...promoMath,
      promo: promoMath.promo
        ? {
            code:           promoMath.promo.code,
            type:           promoMath.promo.type,
            value:          promoMath.promo.value,
            description:    promoMath.promo.description,
            min_amount_mxn: promoMath.promo.min_amount_mxn,
            expires_at:     promoMath.promo.expires_at,
          }
        : null,
    })
  );
};
