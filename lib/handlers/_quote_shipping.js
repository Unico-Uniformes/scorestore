"use strict";

const {
  jsonResponse,
  handleOptions,
  validateZip,
  getEnviaQuote,
  getFallbackShipping,
  itemsQtyFromAny,
  normalizeQty,
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

function normalizeCountry(v) {
  return String(v || "MX").trim().toUpperCase();
}

function normalizeZipValue(v) {
  return String(v || "").trim();
}

function normalizeItems(body) {
  const items = Array.isArray(body?.items)
    ? body.items
    : Array.isArray(body?.cart)
      ? body.cart
      : [];
  return normalizeQty(items);
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
        jsonResponse(405, { ok: false, error: "Method not allowed" }, origin)
      );
    }

    const rl = rateLimit(req);
    if (!rl.ok) {
      return send(res, jsonResponse(429, { ok: false, error: "rate_limited" }, origin));
    }

    const query = getQuery(req);
    const body = getBody(req);
    const source = { ...query, ...body };

    const country = normalizeCountry(
      source.shipping_country || source.country || source.to_country || source.dest_country || "MX"
    );

    const zip = normalizeZipValue(
      source.shipping_zip ||
        source.postal_code ||
        source.zip ||
        source.postal ||
        source.to_zip ||
        ""
    );

    const validatedZip = validateZip(zip, country);
    if (!validatedZip) {
      return send(
        res,
        jsonResponse(
          400,
          { ok: false, error: "CP/ZIP inválido", country, zip },
          origin
        )
      );
    }

    const items = normalizeItems(body);
    const itemsQty = Number(
      source.items_qty ||
        source.itemsQty ||
        source.qty ||
        itemsQtyFromAny(items)
    ) || itemsQtyFromAny(items);

    let quote = null;
    let provider = "fallback";

    try {
      quote = await getEnviaQuote({
        zip: validatedZip,
        country,
        items_qty: itemsQty,
      });
      provider = quote.provider || "envia";
    } catch (error) {
      quote = getFallbackShipping(country, itemsQty);
      provider = quote.provider || "fallback";
    }

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          provider: quote?.provider || provider,
          country,
          zip: validatedZip,
          items_qty: itemsQty,
          amount_cents: quote?.amount_cents ?? 0,
          amount_mxn: quote?.amount_mxn ?? 0,
          label: quote?.label || "",
          quote,
        },
        origin
      )
    );
  } catch (error) {
    return send(
      res,
      jsonResponse(
        500,
        { ok: false, error: error?.message || "quote_shipping_failed" },
        origin
      )
    );
  }
}

module.exports = main;
module.exports.default = main;