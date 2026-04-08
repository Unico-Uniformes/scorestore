#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const apiDir = path.join(root, "api");
const handlersDir = path.join(root, "lib", "handlers");

const filesToMove = [
  "_auth.js",
  "_catalog.js",
  "_checkout_status.js",
  "_create_checkout.js",
  "_envia_webhook.js",
  "_health_check.js",
  "_promos.js",
  "_quote_shipping.js",
  "_site_settings.js",
  "_stripe_webhook.js",
];

const routerCode = `// api/index.js
"use strict";

/**
 * SCORE STORE - Centralized API Router
 * Una sola Serverless Function en Vercel.
 */

const auth = require("../lib/handlers/_auth.js");
const catalog = require("../lib/handlers/_catalog.js");
const checkoutStatus = require("../lib/handlers/_checkout_status.js");
const createCheckout = require("../lib/handlers/_create_checkout.js");
const enviaWebhook = require("../lib/handlers/_envia_webhook.js");
const healthCheck = require("../lib/handlers/_health_check.js");
const promos = require("../lib/handlers/_promos.js");
const quoteShipping = require("../lib/handlers/_quote_shipping.js");
const siteSettings = require("../lib/handlers/_site_settings.js");
const stripeWebhook = require("../lib/handlers/_stripe_webhook.js");

const { handleOptions } = require("../lib/_shared.js");

module.exports = async (req, res) => {
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

  const url = new URL(req.url, \`http://\${req.headers.host || "localhost"}\`);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const target = pathParts[1];

  try {
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
        return await quoteShipping(req, res);
      case "site_settings":
        return await siteSettings(req, res);
      case "stripe_webhook":
        return await stripeWebhook(req, res);
      default:
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({
          ok: false,
          error: "Endpoint no encontrado",
          path: url.pathname,
        }));
    }
  } catch (error) {
    console.error(\`[Router Error] /api/\${target}:\`, error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      ok: false,
      error: "Error interno del servidor",
      message: error.message,
    }));
  }
};

module.exports.default = module.exports;
`;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function patchImports(code) {
  return code
    .replace(/require\((['"])\.\.\/lib\/_shared(?:\.js)?\1\)/g, 'require("../_shared")')
    .replace(/require\((['"])\.\.\/lib\/_rate_limit(?:\.js)?\1\)/g, 'require("../_rate_limit")')
    .replace(/require\((['"])\.\.\/lib\/idempotency(?:\.js)?\1\)/g, 'require("../idempotency")')
    .replace(/require\((['"])\.\/_shared(?:\.js)?\1\)/g, 'require("../_shared")')
    .replace(/require\((['"])\.\/_rate_limit(?:\.js)?\1\)/g, 'require("../_rate_limit")')
    .replace(/require\((['"])\.\/idempotency(?:\.js)?\1\)/g, 'require("../idempotency")');
}

function patchSpecialCases(file, code) {
  let out = patchImports(code);

  if (file === "_catalog.js") {
    out = out.replace(/const\s*\{\s*jsonResponse,\s*handleOptions,\s*rateLimit,/, "const {\n  jsonResponse,\n  handleOptions,");
    if (!/require\("\.\.\/_rate_limit"\)/.test(out)) {
      out = out.replace(
        /const\s*\{\s*jsonResponse,\s*handleOptions,\s*supabaseAdmin/,
        'const { rateLimit } = require("../_rate_limit");\n\nconst { jsonResponse, handleOptions, supabaseAdmin'
      );
    }
  }

  if (file === "_quote_shipping.js") {
    out = out.replace(/require\("\.\.\/_shared"\)/g, 'require("../_shared")');
  }

  if (file === "_health_check.js") {
    out = out.replace(/require\("\.\/_auth"\)/g, 'require("../_auth")');
  }

  if (file === "_promos.js") {
    out = out.replace(/res\.status\(out\.statusCode \|\| 200\)\.send\(out\.body\);/g, `res.statusCode = out.statusCode || 200;
  Object.entries(out.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
  res.end(out.body || "");`);
  }

  if (file === "_site_settings.js") {
    out = out.replace(/onConflict:\s*"org_id"/g, 'onConflict: "organization_id"');
  }

  if (file === "_stripe_webhook.js") {
    out = out.replace(/apiVersion:\s*"2024-06-20"/g, 'apiVersion: "2025-01-27.acacia"');
  }

  return out;
}

function main() {
  ensureDir(handlersDir);

  if (!fs.existsSync(apiDir)) {
    throw new Error("No existe /api");
  }

  write(path.join(apiDir, "index.js"), routerCode);

  for (const file of filesToMove) {
    const src = path.join(apiDir, file);
    const dest = path.join(handlersDir, file);

    if (!fs.existsSync(src)) {
      continue;
    }

    const content = read(src);
    write(dest, patchSpecialCases(file, content));
    fs.unlinkSync(src);
  }

  console.log("OK: handlers movidos a lib/handlers y router central regenerado.");
}

main();