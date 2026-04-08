// api/index.js
"use strict";

/**
 * SCORE STORE - Centralized API Router
 * ─────────────────────────────────────
 * UNA sola Serverless Function en Vercel (Hobby = 12 max).
 * Todos los handlers viven en /lib/handlers/ — NO en /api/.
 *
 * FIX APLICADOS:
 *  1. Paths de require actualizados a ../lib/handlers/
 *  2. Bug: "quote_shipping" → quoteShipping (era quote_shipping, ReferenceError en runtime)
 */

const auth           = require("../lib/handlers/_auth.js");
const catalog        = require("../lib/handlers/_catalog.js");
const checkoutStatus = require("../lib/handlers/_checkout_status.js");
const createCheckout = require("../lib/handlers/_create_checkout.js");
const enviaWebhook   = require("../lib/handlers/_envia_webhook.js");
const healthCheck    = require("../lib/handlers/_health_check.js");
const promos         = require("../lib/handlers/_promos.js");
const quoteShipping  = require("../lib/handlers/_quote_shipping.js");
const siteSettings   = require("../lib/handlers/_site_settings.js");
const stripeWebhook  = require("../lib/handlers/_stripe_webhook.js");

const { handleOptions } = require("../lib/_shared.js");

module.exports = async (req, res) => {
  // ── 1. CORS Preflight global ────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    const out = handleOptions({ headers: req.headers });
    res.statusCode = out.statusCode || 204;
    if (out.headers) {
      Object.entries(out.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }
    return res.end();
  }

  // ── 2. Extracción de ruta ───────────────────────────────────────────────────
  // URL ejemplo: /api/catalog → target = "catalog"
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const target = pathParts[1];

  try {
    // ── 3. Router ─────────────────────────────────────────────────────────────
    switch (target) {
      case "auth":
        return await auth(req, res);

      case "catalog":
        return await catalog(req, res);

      case "checkout_status":
        return await checkoutStatus(req, res);

      case "create_checkout":
        return await createCheckout(req, res);

      case "envia_webhook":
        return await enviaWebhook(req, res);

      case "health_check":
        return await healthCheck(req, res);

      case "promos":
        return await promos(req, res);

      case "quote_shipping":
        return await quoteShipping(req, res); // ✅ FIX: era quote_shipping (undefined)

      case "site_settings":
        return await siteSettings(req, res);

      case "stripe_webhook":
        return await stripeWebhook(req, res);

      default:
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(
          JSON.stringify({
            ok: false,
            error: "Endpoint no encontrado",
            path: url.pathname,
          })
        );
    }
  } catch (error) {
    console.error(`[Router Error] /api/${target}:`, error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(
      JSON.stringify({
        ok: false,
        error: "Error interno del servidor",
        message: error.message,
      })
    );
  }
};
