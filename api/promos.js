// api/promos.js
"use strict";

const {
  jsonResponse,
  handleOptions,
  readJsonFile,
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

function normalizeUpper(v) {
  return normalizeText(v).toUpperCase();
}

function normalizeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
  }
  return fallback;
}

function normalizeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizePromo(promo) {
  const type = normalizeText(promo?.type || "fixed_mxn");

  return {
    code: normalizeUpper(promo?.code),
    type: type === "percent" ? "percent" : "fixed_mxn",
    value: normalizeNumber(promo?.value, 0),
    min_amount_mxn: normalizeNumber(promo?.min_amount_mxn, 0),
    active: normalizeBool(promo?.active, true),
    expires_at: normalizeDate(promo?.expires_at),
    description: normalizeText(promo?.description || ""),
  };
}

function readPromosFile() {
  const file = readJsonFile("data/promos.json");

  if (!file) return { rules: [] };

  if (Array.isArray(file)) {
    return { rules: file };
  }

  if (Array.isArray(file?.rules)) {
    return file;
  }

  return { rules: [] };
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const now = new Date();
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return false;
  return exp < now;
}

function validatePromo({ code, subtotalCents }) {
  const normalizedCode = normalizeUpper(code);

  if (!normalizedCode) {
    return {
      valid: false,
      reason: "NO_CODE",
    };
  }

  const { rules } = readPromosFile();
  const promo = (rules || []).map(normalizePromo).find((r) => r.code === normalizedCode);

  if (!promo) {
    return {
      valid: false,
      reason: "NOT_FOUND",
    };
  }

  if (!promo.active) {
    return {
      valid: false,
      reason: "INACTIVE",
      promo,
    };
  }

  if (isExpired(promo.expires_at)) {
    return {
      valid: false,
      reason: "EXPIRED",
      promo,
    };
  }

  const subtotal = Number(subtotalCents || 0);

  if (promo.min_amount_mxn > 0) {
    const minCents = Math.round(promo.min_amount_mxn * 100);
    if (subtotal < minCents) {
      return {
        valid: false,
        reason: "MIN_AMOUNT",
        promo,
      };
    }
  }

  let discountCents = 0;

  if (promo.type === "percent") {
    discountCents = Math.round(subtotal * promo.value);
  } else {
    discountCents = Math.round(promo.value * 100);
  }

  discountCents = Math.max(0, Math.min(discountCents, subtotal));

  return {
    valid: discountCents > 0,
    reason: discountCents > 0 ? "OK" : "NO_DISCOUNT",
    promo,
    discount_cents: discountCents,
  };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "*";

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method === "GET") {
      const { rules } = readPromosFile();

      const normalized = (rules || [])
        .map(normalizePromo)
        .filter((p) => p.active && !isExpired(p.expires_at));

      return send(
        res,
        jsonResponse(
          200,
          {
            ok: true,
            promos: normalized,
            total: normalized.length,
          },
          origin
        )
      );
    }

    if (req.method === "POST") {
      const body =
        typeof req.body === "object"
          ? req.body
          : (() => {
              try {
                return JSON.parse(req.body || "{}");
              } catch {
                return {};
              }
            })();

      const code = body?.code || body?.promo_code || "";
      const subtotalCents = Number(body?.subtotal_cents || 0);

      const result = validatePromo({ code, subtotalCents });

      return send(
        res,
        jsonResponse(
          200,
          {
            ok: true,
            ...result,
          },
          origin
        )
      );
    }

    return send(
      res,
      jsonResponse(405, { ok: false, error: "Method not allowed" }, origin)
    );
  } catch (err) {
    return send(
      res,
      jsonResponse(
        500,
        {
          ok: false,
          error: err?.message || "promos_failed",
        },
        origin
      )
    );
  }
};