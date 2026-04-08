"use strict";

const {
  jsonResponse,
  handleOptions,
  supabaseAdmin,
  safeStr,
  resolveScoreOrgId,
  readPublicSiteSettings,
} = require("../_shared");

const { requireAdmin } = require("../_auth");

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

function resolveOrgId(req, body, query, fallback) {
  return safeStr(
    body.organization_id ||
      body.org_id ||
      body.orgId ||
      query.organization_id ||
      query.org_id ||
      query.orgId ||
      fallback ||
      ""
  ).trim();
}

function buildPayload(body = {}, orgId = "") {
  const contact = body.contact && typeof body.contact === "object" ? body.contact : {};
  const home = body.home && typeof body.home === "object" ? body.home : {};
  const socials = body.socials && typeof body.socials === "object" ? body.socials : {};

  return {
    organization_id: orgId,
    hero_title: safeStr(body.hero_title || "SCORE STORE").trim(),
    hero_image: safeStr(body.hero_image || "").trim(),
    promo_active: !!body.promo_active,
    promo_text: safeStr(body.promo_text || "").trim(),
    maintenance_mode: !!body.maintenance_mode,
    contact: {
      email: safeStr(contact.email || body.contact_email || process.env.SUPPORT_EMAIL || "ventas.unicotextil@gmail.com").trim(),
      phone: safeStr(contact.phone || body.contact_phone || process.env.SUPPORT_PHONE || "6642368701").trim(),
      whatsapp_e164: safeStr(contact.whatsapp_e164 || body.contact_whatsapp_e164 || process.env.SUPPORT_WHATSAPP_E164 || "5216642368701").trim(),
      whatsapp_display: safeStr(contact.whatsapp_display || body.contact_whatsapp_display || process.env.SUPPORT_WHATSAPP_DISPLAY || "664 236 8701").trim(),
    },
    home: {
      support_hours: safeStr(home.support_hours || body.support_hours || "").trim(),
      shipping_note: safeStr(home.shipping_note || body.shipping_note || "").trim(),
      returns_note: safeStr(home.returns_note || body.returns_note || "").trim(),
      footer_note: safeStr(home.footer_note || body.footer_note || "").trim(),
    },
    socials: {
      facebook: safeStr(socials.facebook || body.facebook || "").trim(),
      instagram: safeStr(socials.instagram || body.instagram || "").trim(),
      youtube: safeStr(socials.youtube || body.youtube || "").trim(),
    },
    updated_at: new Date().toISOString(),
  };
}

async function getSettings(sb, orgId) {
  const data = await readPublicSiteSettings(sb, orgId).catch(() => null);
  if (data && typeof data === "object") {
    return {
      ...data,
      organization_id: data.organization_id || orgId || data.org_id || "",
      org_id: data.org_id || data.organization_id || orgId || "",
    };
  }

  return {
    organization_id: orgId || "",
    org_id: orgId || "",
    hero_title: "SCORE STORE",
    promo_active: false,
  };
}

async function main(req, res) {
  const origin = getOrigin(req);

  try {
    if (req.method === "OPTIONS") {
      return send(res, handleOptions({ headers: req.headers }));
    }

    const sb = supabaseAdmin();
    if (!sb) {
      return send(
        res,
        jsonResponse(500, { ok: false, error: "Supabase not configured" }, origin)
      );
    }

    const query = getQuery(req);
    const body = getBody(req);
    const fallbackOrgId = await resolveScoreOrgId(sb).catch(() => "");
    const orgId = resolveOrgId(req, body, query, fallbackOrgId);

    if (req.method === "GET") {
      const settings = await getSettings(sb, orgId);
      return send(
        res,
        jsonResponse(
          200,
          {
            ok: true,
            org_id: settings.org_id || settings.organization_id || orgId,
            organization_id: settings.organization_id || settings.org_id || orgId,
            site_settings: settings,
          },
          origin
        )
      );
    }

    if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
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

    const payload = buildPayload(body, orgId);

    const { data, error } = await sb
      .from("site_settings")
      .upsert(payload, { onConflict: "organization_id" })
      .select("*")
      .maybeSingle();

    if (error) throw error;

    const saved = data || payload;

    return send(
      res,
      jsonResponse(
        200,
        {
          ok: true,
          org_id: saved.organization_id || orgId,
          organization_id: saved.organization_id || orgId,
          site_settings: saved,
        },
        origin
      )
    );
  } catch (error) {
    return send(
      res,
      jsonResponse(
        500,
        { ok: false, error: error?.message || "site_settings_failed" },
        origin
      )
    );
  }
}

module.exports = main;
module.exports.default = main;