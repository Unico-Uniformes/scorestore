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

const resolveOrgId = async () => {
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && isUuid(envId)) return String(envId).trim();
  return DEFAULT_SCORE_ORG_ID;
};

const normalizeFallback = (fallback) => {
  const data = fallback && typeof fallback === "object" ? fallback : {};
  const sections = Array.isArray(data.sections)
    ? data.sections
    : Array.isArray(data.categories)
      ? data.categories
      : [];

  const products = Array.isArray(data.products) ? data.products : [];

  return {
    ok: true,
    store: data.store || { name: "SCORE STORE", currency: "MXN", locale: "es-MX" },
    sections,
    categories: sections,
    products,
  };
};

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  if (event.httpMethod === "OPTIONS") return handleOptions(event);
  if (event.httpMethod !== "GET") {
    return withNoStore(jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
  }

  const fallbackRaw =
    readJsonFile("data/catalog.json") || {
      store: { name: "SCORE STORE", currency: "MXN", locale: "es-MX" },
      sections: [],
      products: [],
    };

  const fallback = normalizeFallback(fallbackRaw);

  const sb = supabaseAdmin();
  if (!sb) {
    return withNoStore(jsonResponse(200, fallback, origin));
  }

  try {
    const orgId = await resolveOrgId();

    const { data, error } = await sb
      .from("products")
      .select(
        "sku,name,description,price_cents,price_mxn,base_mxn,images,sizes,section_id,sub_section,rank,img,image_url,stock,active,is_active,deleted_at,org_id,organization_id,created_at"
      )
      .or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
      .is("deleted_at", null)
      .or("active.eq.true,is_active.eq.true")
      .order("rank", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(800);

    if (error || !Array.isArray(data) || data.length === 0) {
      return withNoStore(jsonResponse(200, fallback, origin));
    }

    const products = data
      .map((p) => {
        const sku = String(p?.sku || "").trim();
        if (!sku) return null;

        const images = Array.isArray(p?.images)
          ? p.images.filter(Boolean).map(String)
          : [];

        const sizes =
          Array.isArray(p?.sizes) && p.sizes.length
            ? p.sizes.map(String)
            : ["S", "M", "L", "XL", "XXL"];

        const priceCents = Number.isFinite(Number(p?.price_cents))
          ? Math.max(0, Math.floor(Number(p.price_cents)))
          : Number.isFinite(Number(p?.price_mxn)) && num(p.price_mxn) > 0
            ? Math.max(0, Math.round(num(p.price_mxn) * 100))
            : Math.max(0, Math.round(num(p?.base_mxn) * 100));

        const primary =
          (p?.img && String(p.img)) ||
          (p?.image_url && String(p.image_url)) ||
          (images.length ? images[0] : "");

        const sectionId = String(p?.section_id || "EDICION_2025").trim();
        const collection = String(p?.sub_section || "").trim();

        return {
          sku,
          title: String(p?.name || "Producto Oficial").trim(),
          name: String(p?.name || "Producto Oficial").trim(),
          description: String(p?.description || "").trim(),
          price_cents: priceCents,
          sectionId,
          section_id: sectionId,
          collection,
          sub_section: collection,
          image: primary,
          image_url: primary,
          img: primary,
          images: images.length ? images : primary ? [primary] : [],
          sizes,
          rank: Number.isFinite(Number(p?.rank)) ? Number(p.rank) : 999,
          stock: Number.isFinite(Number(p?.stock)) ? Number(p.stock) : null,
        };
      })
      .filter(Boolean);

    const sectionMap = new Map();

    for (const item of products) {
      const key = String(item.section_id || item.sectionId || "").trim();
      if (!key) continue;

      if (!sectionMap.has(key)) {
        sectionMap.set(key, {
          id: key,
          section_id: key,
          title: key.replaceAll("_", " "),
          name: key.replaceAll("_", " "),
          image: item.image || item.image_url || "",
          logo: item.image || item.image_url || "",
          count: 0,
        });
      }

      sectionMap.get(key).count += 1;
    }

    const sections = Array.from(sectionMap.values());

    return withNoStore(
      jsonResponse(
        200,
        {
          ok: true,
          store: fallback.store,
          sections,
          categories: sections,
          products,
        },
        origin
      )
    );
  } catch {
    return withNoStore(jsonResponse(200, fallback, origin));
  }
};