"use strict";

const {
  jsonResponse,
  handleOptions,
  readJsonFile,
  safeStr,
} = require("../_shared");

const { rateLimit } = require("../_rate_limit");

function send(res, payload) {
  const out = payload || {};
  out.headers = out.headers || {};
  out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  out.headers["Pragma"] = "no-cache";
  out.headers["Expires"] = "0";

  res.statusCode = out.statusCode || 200;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body || "");
}

function getOrigin(req) {
  return req?.headers?.origin || req?.headers?.Origin || "";
}

function getQuery(req) {
  return req?.query && typeof req.query === "object" ? req.query : {};
}

function getBody(req) {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === "object" && !Buffer.isBuffer(body)) return body;

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return {};
}

function cleanCode(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function moneyToCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function computeValidity(promo, subtotalMxn) {
  if (!promo) {
    return { valid: false, reason: "not_found" };
  }

  const now = Date.now();
  const expiresAt = promo.expires_at ? Date.parse(promo.expires_at) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt < now) {
    return { valid: false, reason: "expired" };
  }

  const minAmountMxn = Number(promo.min_amount_mxn || promo.min_amount || 0);
  if (Number.isFinite(minAmountMxn) && subtotalMxn < minAmountMxn) {
    return {
      valid: false,
      reason: "minimum_not_met",
      min_amount_mxn: minAmountMxn,
    };
  }

  return { valid: true, reason: "ok" };
}

function computePromo(promo, subtotalCents) {
  if (!promo) {
    return {
      promo: null,
      discount_cents: 0,
      free_shipping: false,
    };
  }

  const type = cleanCode(promo.type || promo.kind || "");
  const value = Number(promo.value || promo.amount || promo.percent || 0);

  let discount_cents = 0;
  let free_shipping = false;

  if (type === "FREE_SHIPPING" || type === "SHIPPING") {
    free_shipping = true;
  } else if (type === "PERCENT" || type === "PERCENTAGE" || type === "PCT") {
    discount_cents = Math.max(0, Math.round((subtotalCents * value) / 100));
  } else if (type === "FIXED" || type === "AMOUNT" || type === "DISCOUNT") {
    discount_cents = Math.max(0, Math.round(value * 100));
  }

  discount_cents = Math.min(discount_cents, subtotalCents);

  return {
    promo: {
      code: cleanCode(promo.code),
      type: promo.type || promo.kind || "fixed",
      value: promo.value ?? 0,
      description: safeStr(promo.description || ""),
      min_amount_mxn: promo.min_amount_mxn ?? null,
      expires_at: promo.expires_at ?? null,
    },
    discount_cents,
    free_shipping,
  };
}

function loadPromos() {
  const raw = readJsonFile("data/promos.json");
  if (!raw) return { store: {}, rules: [] };

  if (Array.isArray(raw)) {
    return { store: {}, rules: raw };
  }

  return {
    store: raw.store || raw.meta || {},
    rules: Array.isArray(raw.rules)
      ? raw.rules
      : Array.isArray(raw.promos)
        ? raw.promos
        : [],
  };
}

async function main(req, res) {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return send(
        res,
        {
          statusCode: 405,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ ok: false, error: "Method not allowed" }),
        }
      );
    }

    const rl = rateLimit(req);
    if (!rl.ok) {
      return send(res, jsonResponse(429, { ok: false, error: "rate_limited" }, origin));
    }

    const query = getQuery(req);
    const body = getBody(req);

    const promos = loadPromos();
    const code = cleanCode(
      query.code || query.coupon || query.promo || body.code || body.coupon || body.promo || ""
    );

    const subtotalMxn = Number(
      query.subtotal_mxn ||
        query.amount_mxn ||
        body.subtotal_mxn ||
        body.amount_mxn ||
        0
    );
    const subtotalCents = moneyToCents(subtotalMxn);

    if (!code) {
      return send(
        res,
        jsonResponse(
          200,
          {
            ok: true,
            store: promos.store,
            rules: promos.rules,
            count: promos.rules.length,
          },
          origin
        )
      );
    }

    const promo = promos.rules.find((r) => cleanCode(r.code) === code) || null;
    const validity = computeValidity(promo, subtotalMxn);
    const promoMath = validity.valid
      ? computePromo(promo, subtotalCents)
      : { promo: null, discount_cents: 0, free_shipping: false };

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          store: promos.store,
          query: {
            code,
            subtotal_mxn: subtotalMxn,
            subtotal_cents: subtotalCents,
          },
          validity,
          ...promoMath,
          promo: promoMath.promo
            ? {
                code: promoMath.promo.code,
                type: promoMath.promo.type,
                value: promoMath.promo.value,
                description: promoMath.promo.description,
                min_amount_mxn: promoMath.promo.min_amount_mxn,
                expires_at: promoMath.promo.expires_at,
              }
            : null,
        },
        origin
      )
    );
  } catch (error) {
    return send(
      res,
      jsonResponse(
        500,
        { ok: false, error: error?.message || "promos_failed" },
        origin
      )
    );
  }
}

module.exports = main;
module.exports.default = main;