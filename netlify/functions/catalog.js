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

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v, fallback = "") => {
  const s = String(v ?? "").trim();
  return s || fallback;
};

const arr = (v) => (Array.isArray(v) ? v : []);

const pickImage = (...values) => {
  for (const value of values) {
    const s = str(value);
    if (s) return s;
  }
  return "";
};

const resolveOrgId = async () => {
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && isUuid(envId)) return String(envId).trim();
  return DEFAULT_SCORE_ORG_ID;
};

const normalizeSection = (row) => {
  const sectionId = str(row?.section_id || row?.sectionId || row?.id, "EDICION_2025");
  const name = str(row?.name || row?.title || row?.label, sectionId.replaceAll("_", " "));

  return {
    id: sectionId,
    section_id: sectionId,
    sectionId: sectionId,
    name,
    title: name,
    image: pickImage(row?.image, row?.logo, row?.cover_image, row?.coverImage),
    logo: pickImage(row?.logo, row?.image, row?.cover_image, row?.coverImage),
    count: num(row?.count, 0),
  };
};

const normalizeProduct = (p) => {
  const sku = str(p?.sku);
  if (!sku) return null;

  const images = arr(p?.images).filter(Boolean).map(String);

  const sizes =
    arr(p?.sizes).length > 0
      ? arr(p?.sizes).filter(Boolean).map(String)
      : ["S", "M", "L", "XL", "XXL"];

  const priceCents = Number.isFinite(Number(p?.price_cents)) && num(p?.price_cents) > 0
    ? Math.max(0, Math.floor(num(p?.price_cents)))
    : Number.isFinite(Number(p?.price_mxn)) && num(p?.price_mxn) > 0
      ? Math.max(0, Math.round(num(p?.price_mxn) * 100))
      : Math.max(0, Math.round(num(p?.base_mxn) * 100));

  const primary = pickImage(
    p?.img,
    p?.image_url,
    p?.image,
    images.length ? images[0] : ""
  );

  const sectionId = str(p?.section_id || p?.sectionId, "EDICION_2025");
  const collection = str(p?.sub_section || p?.collection);

  return {
    sku,
    id: str(p?.id, sku),
    title: str(p?.title || p?.name, "Producto Oficial"),
    name: str(p?.name || p?.title, "Producto Oficial"),
    description: str(p?.description),
    price_cents: priceCents,
    price_mxn: num(p?.price_mxn, 0),
    base_mxn: num(p?.base_mxn, 0),
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
    stock: p?.stock == null ? null : num(p?.stock, 0),
  };
};

const normalizePayload = (payload) => {
  const data = payload && typeof payload === "object" ? payload : {};

  const rawSections = Array.isArray(data.sections)
    ? data.sections
    : Array.isArray(data.categories)
      ? data.categories
      : [];

  const rawProducts = Array.isArray(data.products) ? data.products : [];

  const products = rawProducts.map(normalizeProduct).filter(Boolean);

  let sections = rawSections.map(normalizeSection);

  if (!sections.length && products.length) {
    const sectionMap = new Map();

    for (const item of products) {
      const key = str(item.section_id || item.sectionId);
      if (!key) continue;

      if (!sectionMap.has(key)) {
        sectionMap.set(key, {
          id: key,
          section_id: key,
          sectionId: key,
          title: key.replaceAll("_", " "),
          name: key.replaceAll("_", " "),
          image: item.image || item.image_url || "",
          logo: item.image || item.image_url || "",
          count: 0,
        });
      }

      sectionMap.get(key).count += 1;
    }

    sections = Array.from(sectionMap.values());
  }

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

  const fallback = normalizePayload(fallbackRaw);

  const sb = supabaseAdmin();
  if (!sb) {
    return withNoStore(jsonResponse(200, fallback, origin));
  }

  try {
    const orgId = await resolveOrgId();

    const { data, error } = await sb
      .from("products")
      .select(
        "id,sku,name,description,price_cents,price_mxn,base_mxn,images,sizes,section_id,sub_section,rank,img,image_url,stock,active,is_active,deleted_at,org_id,organization_id,created_at"
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

    const normalized = normalizePayload({
      store: fallback.store,
      products: data.map((p) => ({
        id: p.id,
        sku: p.sku,
        title: p.name,
        name: p.name,
        description: p.description,
        price_cents: p.price_cents,
        price_mxn: p.price_mxn,
        base_mxn: p.base_mxn,
        sectionId: p.section_id,
        section_id: p.section_id,
        collection: p.sub_section,
        sub_section: p.sub_section,
        image: p.image_url || p.img,
        image_url: p.image_url,
        img: p.img,
        images: Array.isArray(p.images) ? p.images : [],
        sizes: Array.isArray(p.sizes) ? p.sizes : [],
        rank: p.rank,
        stock: p.stock,
      })),
    });

    return withNoStore(jsonResponse(200, normalized, origin));
  } catch {
    return withNoStore(jsonResponse(200, fallback, origin));
  }
};