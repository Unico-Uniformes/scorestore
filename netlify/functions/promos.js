"use strict";

const { jsonResponse, handleOptions, supabaseAdmin, readJsonFile } = require("./_shared");

const DEFAULT_SCORE_ORG_ID = "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";
const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());

const withNoStore = (resp) => {
  resp.headers = resp.headers || {};
  resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  resp.headers["Pragma"] = "no-cache";
  resp.headers["Expires"] = "0";
  return resp;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const resolveOrgId = async (sb) => {
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && isUuid(envId)) return String(envId).trim();

  let orgId = DEFAULT_SCORE_ORG_ID;

  try {
    const { data: byId } = await sb.from("organizations").select("id").eq("id", orgId).limit(1).maybeSingle();
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

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  if (event.httpMethod === "OPTIONS") return handleOptions(event);
  if (event.httpMethod !== "GET") return withNoStore(jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));

  const fallback = readJsonFile("data/promos.json") || { rules: [] };

  const sb = supabaseAdmin();
  if (!sb) return withNoStore(jsonResponse(200, fallback, origin));

  try {
    const orgId = await resolveOrgId(sb);

    const { data, error } = await sb
      .from("promo_rules")
      .select("code,type,value,description,active,min_amount_mxn,expires_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error || !Array.isArray(data) || data.length === 0) {
      return withNoStore(jsonResponse(200, fallback, origin));
    }

    const now = Date.now();

    const rules = data
      .map((r) => ({
        code: String(r?.code || "").trim().toUpperCase(),
        type: String(r?.type || "").trim(),
        value: num(r?.value),
        description: r?.description ? String(r.description) : null,
        active: !!r?.active,
        min_amount_mxn: num(r?.min_amount_mxn),
        expires_at: r?.expires_at || null,
      }))
      .filter((r) => {
        if (!r.code || !r.active) return false;
        if (!r.expires_at) return true;
        const t = new Date(r.expires_at).getTime();
        return Number.isFinite(t) ? t > now : true;
      });

    return withNoStore(jsonResponse(200, { rules }, origin));
  } catch {
    return withNoStore(jsonResponse(200, fallback, origin));
  }
};