"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  initStripe,
  safeStr,
  getFallbackShipping,
  resolveScoreOrgId,
  readPublicSiteSettings,
} = require("../_shared");

const { requireAdmin } = require("../_auth");

const DEFAULT_SUPPORT = {
  email: process.env.SUPPORT_EMAIL || "ventas.unicotextil@gmail.com",
  whatsapp: process.env.SUPPORT_WHATSAPP_DISPLAY || "664 236 8701",
};

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

async function checkDatabase(sb, orgId) {
  const result = {
    ok: false,
    site_settings: false,
    organizations: false,
    orders: false,
  };

  try {
    const ss = await sb.from("site_settings").select("organization_id").limit(1);
    result.site_settings = !ss.error;
  } catch {}

  try {
    const org = await sb.from("organizations").select("id").limit(1);
    result.organizations = !org.error;
  } catch {}

  try {
    const orders = await sb.from("orders").select("id").limit(1);
    result.orders = !orders.error;
  } catch {}

  result.ok = result.site_settings || result.organizations || result.orders;
  result.org_id = orgId || "";
  return result;
}

async function main(req, res) {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return send(res, jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    }

    const auth = requireAdmin(req);
    if (!auth.ok) {
      return send(
        res,
        jsonResponse(
          auth.error === "no_token" ? 401 : 403,
          { ok: false, error: auth.error },
          origin
        )
      );
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return send(
        res,
        jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin)
      );
    }

    const orgId = await resolveScoreOrgId(sb).catch(() => "");
    const settings = await readPublicSiteSettings(sb, orgId).catch(() => null);
    const db = await checkDatabase(sb, orgId);
    const stripe = initStripe();
    const fallbackShipping = getFallbackShipping("MX", 1);

    const payload = {
      ok: true,
      checked_at: new Date().toISOString(),
      auth: {
        ok: true,
        role: auth.user?.role || auth.user?.app_metadata?.role || "admin",
        user_id: auth.user?.sub || auth.user?.id || null,
      },
      env: {
        site_url: process.env.SITE_URL || "",
        vercel_url: process.env.VERCEL_URL || "",
        support_email: DEFAULT_SUPPORT.email,
        support_whatsapp: DEFAULT_SUPPORT.whatsapp,
      },
      services: {
        supabase: !!sb,
        stripe: !!stripe,
        envia: !!process.env.ENVIA_API_KEY,
        gemini: !!process.env.GEMINI_API_KEY,
        telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      },
      db,
      org_id: orgId,
      site_settings: settings || {
        organization_id: orgId,
        hero_title: "SCORE STORE",
        promo_active: false,
      },
      shipping_probe: fallbackShipping,
    };

    return send(res, jsonResponse(200, payload, origin));
  } catch (error) {
    console.error("[health_check] error:", error?.message || error);
    return send(
      res,
      jsonResponse(
        500,
        {
          ok: false,
          error: "health_check_failed",
          message: error?.message || "No fue posible ejecutar health_check",
        },
        origin
      )
    );
  }
}

module.exports = main;
module.exports.default = main;