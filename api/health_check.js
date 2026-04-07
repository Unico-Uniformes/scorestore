// api/health_check.js
"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  initStripe,
  safeStr,
  getEnviaQuote,
  getFallbackShipping,
} = require("../lib/_shared");

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
  return req?.headers?.origin || "*";
}

async function checkSupabase() {
  try {
    const sb = supabaseAdmin();
    if (!sb) return { ok: false, error: "supabase_not_configured" };

    const { error } = await sb.from("orders").select("id").limit(1);
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function checkStripe() {
  try {
    const stripe = initStripe();
    if (!stripe) return { ok: false, error: "stripe_not_configured" };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkEnvia() {
  try {
    const test = await getEnviaQuote({
      zip: "22000",
      items: [{ weight: 1 }],
    });

    if (test && test.ok) return { ok: true };

    const fallback = getFallbackShipping();
    return { ok: true, fallback: true, fallback_value: fallback };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = async (req, res) => {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "GET") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    }

    const [supabase, stripe, envia] = await Promise.all([
      checkSupabase(),
      Promise.resolve(checkStripe()),
      checkEnvia(),
    ]);

    const ok = supabase.ok && stripe.ok && envia.ok;

    return send(
      res,
      jsonResponse(
        ok ? 200 : 500,
        {
          ok,
          services: {
            supabase,
            stripe,
            envia,
          },
          timestamp: new Date().toISOString(),
        },
        origin
      )
    );
  } catch (error) {
    console.error("[health_check] error:", error?.message || error);

    return send(
      res,
      jsonResponse(500, { ok: false, error: "health_check_failed" }, origin)
    );
  }
};

module.exports.default = module.exports;