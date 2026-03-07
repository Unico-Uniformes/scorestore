"use strict";

const { jsonResponse, handleOptions, supabaseAdmin } = require("./_shared");

const DEFAULT_SCORE_ORG_ID = "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());

const safeStr = (v, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));

const withNoStore = (resp) => {
  resp.headers = resp.headers || {};
  resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  resp.headers["Pragma"] = "no-cache";
  resp.headers["Expires"] = "0";
  return resp;
};

const resolveOrgId = async (sb) => {
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && isUuid(envId)) return String(envId).trim();

  let orgId = DEFAULT_SCORE_ORG_ID;

  try {
    const { data: byId } = await sb
      .from("organizations")
      .select("id")
      .eq("id", orgId)
      .limit(1)
      .maybeSingle();

    if (byId?.id) return orgId;

    const { data: byName } = await sb
      .from("organizations")
      .select("id")
      .ilike("name", "%score%")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (byName?.id) orgId = byName.id;
  } catch {}

  return orgId;
};

function buildDefaults() {
  return {
    ok: true,
    hero_title: null,
    hero_image: null,
    promo_active: false,
    promo_text: "",
    pixel_id: "",
    maintenance_mode: false,
    season_key: "default",
    theme: {
      accent: "#e10600",
      accent2: "#111111",
      particles: true,
    },
    home: {
      footer_note: "",
      shipping_note: "",
      returns_note: "",
      support_hours: "",
    },
    socials: {
      facebook: process.env.SOCIAL_FACEBOOK || "https://www.facebook.com/uniforme.unico/",
      instagram: process.env.SOCIAL_INSTAGRAM || "https://www.instagram.com/uniformes.unico",
      youtube: process.env.SOCIAL_YOUTUBE || "https://youtu.be/F4lw1EcehIA?si=jFBT9skFLs566g8N",
      tiktok: process.env.SOCIAL_TIKTOK || "",
    },
    contact: {
      email: process.env.SUPPORT_EMAIL || "ventas.unicotextil@gmail.com",
      phone: process.env.SUPPORT_PHONE || "",
      whatsapp_e164: process.env.SUPPORT_WHATSAPP_E164 || "5216642368701",
      whatsapp_display: process.env.SUPPORT_WHATSAPP_DISPLAY || "664 236 8701",
    },
    updated_at: null,
  };
}

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  if (event.httpMethod === "OPTIONS") return handleOptions(event);

  if (event.httpMethod !== "GET") {
    return withNoStore(jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
  }

  const defaults = buildDefaults();
  const sb = supabaseAdmin();

  if (!sb) {
    return withNoStore(jsonResponse(200, defaults, origin));
  }

  try {
    const orgId = await resolveOrgId(sb);

    const { data, error } = await sb
      .from("site_settings")
      .select(`
        hero_title,
        hero_image,
        promo_active,
        promo_text,
        pixel_id,
        maintenance_mode,
        season_key,
        theme,
        home,
        socials,
        updated_at,
        created_at,
        contact_email,
        contact_phone,
        whatsapp_e164,
        whatsapp_display
      `)
      .or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return withNoStore(jsonResponse(200, defaults, origin));
    }

    const theme = data.theme && typeof data.theme === "object" ? data.theme : {};
    const home = data.home && typeof data.home === "object" ? data.home : {};
    const socials = data.socials && typeof data.socials === "object" ? data.socials : {};

    return withNoStore(
      jsonResponse(
        200,
        {
          ...defaults,
          hero_title: safeStr(data.hero_title) || defaults.hero_title,
          hero_image: safeStr(data.hero_image) || defaults.hero_image,
          promo_active: !!data.promo_active,
          promo_text: safeStr(data.promo_text),
          pixel_id: safeStr(data.pixel_id),
          maintenance_mode: !!data.maintenance_mode,
          season_key: safeStr(data.season_key || "default"),
          theme: {
            ...defaults.theme,
            ...theme,
          },
          home: {
            ...defaults.home,
            ...home,
          },
          socials: {
            ...defaults.socials,
            ...socials,
          },
          contact: {
            ...defaults.contact,
            email: safeStr(data.contact_email) || defaults.contact.email,
            phone: safeStr(data.contact_phone) || defaults.contact.phone,
            whatsapp_e164: safeStr(data.whatsapp_e164) || defaults.contact.whatsapp_e164,
            whatsapp_display: safeStr(data.whatsapp_display) || defaults.contact.whatsapp_display,
          },
          updated_at: data.updated_at || null,
        },
        origin
      )
    );
  } catch {
    return withNoStore(jsonResponse(200, defaults, origin));
  }
};
