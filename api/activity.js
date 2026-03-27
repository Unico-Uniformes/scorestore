"use strict";

const { jsonResponse, handleOptions, supabaseAdmin } = require("./_shared");

const DEFAULT_SCORE_ORG_ID = "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );

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

const getOrigin = (req) =>
  req?.headers?.origin ||
  req?.headers?.Origin ||
  "";

const withNoStoreHeaders = (response) => {
  response.headers = response.headers || {};
  response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
  response.headers["Pragma"] = "no-cache";
  response.headers["Expires"] = "0";
  return response;
};

const extractItemName = (itemsSummary) => {
  const raw = String(itemsSummary || "").trim();
  if (!raw) return "mercancía oficial";

  const first = raw.split("|")[0] || "";
  const cleaned = first.replace(/\s+/g, " ").trim();

  const match =
    cleaned.match(/x\s([^\[]+)\[/i) ||
    cleaned.match(/\d+\s*x\s*([^\[]+)\[/i) ||
    cleaned.match(/-\s*([^\[]+)\[/i);

  if (match && match[1]) return String(match[1]).trim();

  const fallback = cleaned
    .replace(/\[[^\]]*\]/g, "")
    .replace(/^.*?\b(?:x|\-)\b\s*/i, "")
    .trim();

  return fallback || "mercancía oficial";
};

module.exports = async (req, res) => {
  const origin = getOrigin(req);

  if (req.method === "OPTIONS") {
    const optionsRes = handleOptions({ headers: { origin } });
    Object.keys(optionsRes.headers || {}).forEach((key) => {
      res.setHeader(key, optionsRes.headers[key]);
    });
    res.status(optionsRes.statusCode).send(optionsRes.body);
    return;
  }

  if (req.method !== "GET") {
    const response = jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);
    Object.keys(response.headers || {}).forEach((key) => {
      res.setHeader(key, response.headers[key]);
    });
    res.status(response.statusCode).send(response.body);
    return;
  }

  const respondOk = (payload) => {
    const resp = jsonResponse(200, payload, origin);
    const finalResp = withNoStoreHeaders(resp);

    Object.keys(finalResp.headers || {}).forEach((key) => {
      res.setHeader(key, finalResp.headers[key]);
    });

    res.status(finalResp.statusCode).send(finalResp.body);
  };

  // Nunca debe romper la UX
  if (process.env.ENABLE_ACTIVITY_FEED !== "1") {
    return respondOk({ ok: true, events: [] });
  }

  const sb = supabaseAdmin();
  if (!sb) {
    return respondOk({ ok: true, events: [] });
  }

  try {
    const orgId = await resolveOrgId(sb);

    const { data } = await sb
      .from("orders")
      .select("customer_name, items_summary, created_at")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(10);

    const events = (data || []).map((order) => {
      const buyerName = order?.customer_name
        ? String(order.customer_name).split(" ")[0]
        : "Un fan";

      return {
        buyer_name: buyerName,
        item_name: extractItemName(order?.items_summary),
      };
    });

    return respondOk({ ok: true, events });
  } catch {
    return respondOk({ ok: true, events: [] });
  }
};