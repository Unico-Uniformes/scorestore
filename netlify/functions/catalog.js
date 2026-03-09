"use strict";

const fs = require("fs");
const path = require("path");
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

const ensureLeadingSlash = (value) => {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith("/") ? s : `/${s}`;
};

const normalizeSectionId = (value) => {
  const s = str(value, "EDICION_2025");

  if (/^BAJA1000$/i.test(s)) return "EDICION_2025";
  if (/^BAJA[_-]?400$/i.test(s)) return "BAJA400";
  if (/^BAJA[_-]?500$/i.test(s)) return "BAJA500";
  if (/^SF[_-]?250$/i.test(s)) return "SF250";

  return s;
};

const resolveOrgId = async () => {
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && isUuid(envId)) return String(envId).trim();
  return DEFAULT_SCORE_ORG_ID;
};

const repoRootCandidates = [
  process.cwd(),
  path.join(__dirname, "..", ".."),
];

const findAssetsRoot = () => {
  for (const base of repoRootCandidates) {
    const p = path.join(base, "assets");
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const ASSETS_ROOT = findAssetsRoot();

const normalizeSlashes = (s) => String(s || "").replace(/\\/g, "/");

const walkFiles = (dir, bucket = []) => {
  if (!dir || !fs.existsSync(dir)) return bucket;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, bucket);
    } else if (entry.isFile()) {
      bucket.push(full);
    }
  }

  return bucket;
};

const buildAssetIndex = () => {
  const byPath = new Map();
  const byBase = new Map();

  if (!ASSETS_ROOT) return { byPath, byBase };

  const files = walkFiles(ASSETS_ROOT);

  for (const full of files) {
    const rel = normalizeSlashes(path.relative(path.dirname(ASSETS_ROOT), full));
    const publicPath = ensureLeadingSlash(rel);
    const key = publicPath.toLowerCase();

    byPath.set(key, publicPath);

    const base = path.basename(full).toLowerCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(publicPath);
  }

  return { byPath, byBase };
};

const ASSET_INDEX = buildAssetIndex();

const normalizeAssetCandidate = (input) => {
  let s = String(input || "").trim();
  if (!s) return "";

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = `${u.pathname || ""}${u.search || ""}${u.hash || ""}`;
    } catch {
      return s;
    }
  }

  s = normalizeSlashes(s);
  s = s.replace(/^\.?\//, "/");
  s = s.replace(/\/{2,}/g, "/");

  s = s.replace(/\/BAJA[_-]?400\//gi, "/BAJA400/");
  s = s.replace(/\/BAJA[_-]?500\//gi, "/BAJA500/");
  s = s.replace(/\/SF[_-]?250\//gi, "/SF250/");

  s = s.replace(/camiseta-cafe-oscuro-baja400/gi, "camiseta-cafe- oscuro-baja400");
  s = s.replace(/camiseta-negra-sinmangas-sf250/gi, "camiseta-negra-sinmangas-SF250");

  s = ensureLeadingSlash(s);
  return s;
};

const resolveAssetPath = (input, fallbackList = []) => {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) return raw;

  const candidates = [];
  const add = (value) => {
    const s = normalizeAssetCandidate(value);
    if (s && !candidates.includes(s)) candidates.push(s);
  };

  add(raw);

  const basename = path.basename(raw).toLowerCase();
  if (basename && ASSET_INDEX.byBase.has(basename)) {
    for (const match of ASSET_INDEX.byBase.get(basename)) add(match);
  }

  for (const fb of arr(fallbackList)) add(fb);

  for (const candidate of candidates) {
    const direct = ASSET_INDEX.byPath.get(candidate.toLowerCase());
    if (direct) return direct;
  }

  return candidates[0] || "";
};

const uniqStrings = (items) => {
  const out = [];
  const seen = new Set();

  for (const item of arr(items)) {
    const s = str(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }

  return out;
};

const normalizeSection = (row) => {
  const sectionId = normalizeSectionId(row?.section_id || row?.sectionId || row?.id);
  const name = str(row?.name || row?.title || row?.label, sectionId.replaceAll("_", " "));

  const cover = resolveAssetPath(
    row?.cover_image || row?.image || row?.logo || row?.coverImage
  );

  return {
    id: sectionId,
    section_id: sectionId,
    sectionId: sectionId,
    name,
    title: name,
    image: cover,
    logo: cover,
    count: num(row?.count, 0),
  };
};

const normalizeProduct = (p, fallbackBySku = new Map()) => {
  const sku = str(p?.sku);
  if (!sku) return null;

  const fallback = fallbackBySku.get(sku) || null;

  const mergedImages = uniqStrings([
    ...arr(p?.images),
    ...arr(fallback?.images),
  ]);

  const resolvedImages = uniqStrings(
    mergedImages
      .map((img) => resolveAssetPath(img, fallback?.images || []))
      .filter(Boolean)
  );

  const primary = resolveAssetPath(
    p?.img || p?.image_url || p?.image || fallback?.img || fallback?.image_url || fallback?.image || resolvedImages[0],
    resolvedImages
  );

  const sizes =
    arr(p?.sizes).length > 0
      ? arr(p?.sizes).filter(Boolean).map(String)
      : arr(fallback?.sizes).length > 0
        ? arr(fallback?.sizes).filter(Boolean).map(String)
        : ["S", "M", "L", "XL", "XXL"];

  const priceCents =
    Number.isFinite(Number(p?.price_cents)) && num(p?.price_cents) > 0
      ? Math.max(0, Math.floor(num(p?.price_cents)))
      : Number.isFinite(Number(p?.price_mxn)) && num(p?.price_mxn) > 0
        ? Math.max(0, Math.round(num(p?.price_mxn) * 100))
        : Number.isFinite(Number(p?.base_mxn)) && num(p?.base_mxn) > 0
          ? Math.max(0, Math.round(num(p?.base_mxn) * 100))
          : Number.isFinite(Number(fallback?.price_cents)) && num(fallback?.price_cents) > 0
            ? Math.max(0, Math.floor(num(fallback?.price_cents)))
            : 0;

  const sectionId = normalizeSectionId(
    p?.section_id || p?.sectionId || fallback?.section_id || fallback?.sectionId
  );

  const collection = str(p?.sub_section || p?.collection || fallback?.sub_section || fallback?.collection);

  return {
    sku,
    id: str(p?.id, str(fallback?.id, sku)),
    title: str(p?.title || p?.name || fallback?.title || fallback?.name, "Producto Oficial"),
    name: str(p?.name || p?.title || fallback?.name || fallback?.title, "Producto Oficial"),
    description: str(p?.description || fallback?.description),
    price_cents: priceCents,
    price_mxn: num(p?.price_mxn, num(fallback?.price_mxn, 0)),
    base_mxn: num(p?.base_mxn, num(fallback?.base_mxn, 0)),
    sectionId,
    section_id: sectionId,
    collection,
    sub_section: collection,
    image: primary,
    image_url: primary,
    img: primary,
    images: resolvedImages.length ? resolvedImages : primary ? [primary] : [],
    sizes,
    rank: Number.isFinite(Number(p?.rank)) ? Number(p.rank) : Number.isFinite(Number(fallback?.rank)) ? Number(fallback.rank) : 999,
    stock: p?.stock == null ? (fallback?.stock == null ? null : num(fallback?.stock, 0)) : num(p?.stock, 0),
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

  const fallbackBySku = new Map(
    rawProducts
      .filter((p) => str(p?.sku))
      .map((p) => [str(p.sku), p])
  );

  const products = rawProducts.map((p) => normalizeProduct(p, fallbackBySku)).filter(Boolean);

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
  } else if (sections.length) {
    const counts = new Map();
    for (const item of products) {
      const key = str(item.section_id || item.sectionId);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    sections = sections.map((section) => {
      const key = str(section.section_id || section.sectionId || section.id);
      return {
        ...section,
        count: counts.get(key) || num(section.count, 0),
      };
    });
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
  const fallbackBySku = new Map(
    arr(fallback.products)
      .filter((p) => str(p?.sku))
      .map((p) => [str(p.sku), p])
  );

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

    const products = data
      .map((p) =>
        normalizeProduct(
          {
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
          },
          fallbackBySku
        )
      )
      .filter(Boolean);

    const sectionMap = new Map();
    const fallbackSections = arr(fallback.sections);
    const fallbackSectionById = new Map(
      fallbackSections.map((s) => [str(s.section_id || s.sectionId || s.id), s])
    );

    for (const item of products) {
      const key = str(item.section_id || item.sectionId);
      if (!key) continue;

      if (!sectionMap.has(key)) {
        const fb = fallbackSectionById.get(key);
        sectionMap.set(key, {
          id: key,
          section_id: key,
          sectionId: key,
          title: str(fb?.title || fb?.name, key.replaceAll("_", " ")),
          name: str(fb?.name || fb?.title, key.replaceAll("_", " ")),
          image: resolveAssetPath(fb?.image || fb?.logo || fb?.cover_image || item.image || item.image_url),
          logo: resolveAssetPath(fb?.logo || fb?.image || fb?.cover_image || item.image || item.image_url),
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