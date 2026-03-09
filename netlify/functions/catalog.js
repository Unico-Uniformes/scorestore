"use strict";

const fs = require("fs");
const path = require("path");
const { jsonResponse, handleOptions, supabaseAdmin, readJsonFile } = require("./_shared");

const DEFAULT_SCORE_ORG_ID = "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());

const CATEGORY_CONFIG = [
  {
    id: "BAJA1000",
    title: "BAJA 1000",
    logo: "/assets/logo-baja1000.webp",
    mapFrom: ["BAJA1000", "BAJA_1000", "EDICION_2025", "OTRAS_EDICIONES"],
  },
  {
    id: "BAJA500",
    title: "BAJA 500",
    logo: "/assets/logo-baja500.webp",
    mapFrom: ["BAJA500", "BAJA_500"],
  },
  {
    id: "BAJA400",
    title: "BAJA 400",
    logo: "/assets/logo-baja400.webp",
    mapFrom: ["BAJA400", "BAJA_400"],
  },
  {
    id: "SF250",
    title: "SAN FELIPE 250",
    logo: "/assets/logo-sf250.webp",
    mapFrom: ["SF250", "SF_250"],
  },
];

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
  if (/^https?:\/\//i.test(s) || s.startsWith("data:")) return s;
  return s.startsWith("/") ? s : `/${s}`;
};

const normalizeUiSection = (sectionId) => {
  const sid = String(sectionId || "").trim().toUpperCase();
  const found = CATEGORY_CONFIG.find((c) => c.mapFrom.includes(sid));
  return found ? found.id : "BAJA1000";
};

const getCategoryMeta = (uiId) =>
  CATEGORY_CONFIG.find((x) => x.id === uiId) || CATEGORY_CONFIG[0];

const resolveOrgId = async () => {
  const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
  if (envId && isUuid(envId)) return String(envId).trim();
  return DEFAULT_SCORE_ORG_ID;
};

const repoRootCandidates = [process.cwd(), path.join(__dirname, "..", "..")];

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
    if (entry.isDirectory()) walkFiles(full, bucket);
    else if (entry.isFile()) bucket.push(full);
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
  s = s.replace(/^\.?\//, "");
  s = s.replace(/\/{2,}/g, "/");

  s = s
    .replaceAll("assets/BAJA_500/", "assets/BAJA500/")
    .replaceAll("assets/BAJA_400/", "assets/BAJA400/")
    .replaceAll("assets/SF_250/", "assets/SF250/")
    .replaceAll("assets/BAJA_1000/", "assets/EDICION_2025/")
    .replaceAll("assets/baja500/", "assets/BAJA500/")
    .replaceAll("assets/baja400/", "assets/BAJA400/")
    .replaceAll("assets/sf250/", "assets/SF250/")
    .replaceAll("assets/edicion_2025/", "assets/EDICION_2025/")
    .replaceAll("assets/otras_ediciones/", "assets/OTRAS_EDICIONES/")
    .replaceAll("camiseta-cafe-oscuro-baja400", "camiseta-cafe- oscuro-baja400")
    .replaceAll("camiseta-negra-sinmangas-sf250", "camiseta-negra-sinmangas-SF250")
    .replaceAll("camiseta-negra-sinmangas-s250-atras", "camiseta-negra-sinmangas-S250-atras")
    .replaceAll("camiseta-negra-sinmangas-s250-detalles", "camiseta-negra-sinmangas-S250-detalles");

  return ensureLeadingSlash(s);
};

const resolveAssetPath = (input, fallbackList = []) => {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;

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

const normalizeFallback = (payload) => {
  const data = payload && typeof payload === "object" ? payload : {};
  const sections = Array.isArray(data.sections)
    ? data.sections
    : Array.isArray(data.categories)
      ? data.categories
      : [];
  const products = Array.isArray(data.products) ? data.products : [];

  return {
    store: data.store || { name: "SCORE STORE", currency: "MXN", locale: "es-MX" },
    sections,
    products,
  };
};

const normalizeFallbackProduct = (p) => {
  const rawSection = str(p?.sectionId || p?.section_id, "BAJA1000");
  const uiSection = normalizeUiSection(rawSection);

  const images = uniqStrings(arr(p?.images).map(resolveAssetPath).filter(Boolean));
  const primary = resolveAssetPath(p?.image || p?.image_url || p?.img || images[0], images);

  return {
    sku: str(p?.sku),
    title: str(p?.title || p?.name, "Producto Oficial"),
    name: str(p?.name || p?.title, "Producto Oficial"),
    description: str(p?.description),
    price_cents: num(p?.price_cents, 0),
    price_mxn: num(p?.price_mxn, 0),
    base_mxn: num(p?.base_mxn, 0),
    sectionId: rawSection,
    section_id: uiSection,
    uiSection,
    collection: str(p?.collection || p?.sub_section),
    sub_section: str(p?.sub_section || p?.collection),
    images: images.length ? images : primary ? [primary] : [],
    image: primary,
    image_url: primary,
    img: primary,
    sizes: arr(p?.sizes).length ? arr(p?.sizes).map(String) : ["S", "M", "L", "XL", "XXL"],
    rank: Number.isFinite(Number(p?.rank)) ? Number(p.rank) : 999,
    stock: p?.stock == null ? null : num(p?.stock, 0),
  };
};

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  if (event.httpMethod === "OPTIONS") return handleOptions(event);

  if (event.httpMethod !== "GET") {
    return withNoStore(jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
  }

  const fallbackRaw = normalizeFallback(
    readJsonFile("data/catalog.json") || {
      store: { name: "SCORE STORE", currency: "MXN", locale: "es-MX" },
      sections: [],
      products: [],
    }
  );

  const fallbackProducts = fallbackRaw.products
    .map(normalizeFallbackProduct)
    .filter((p) => p.sku);

  const fallbackBySku = new Map(fallbackProducts.map((p) => [p.sku, p]));

  const fallbackSectionsMap = new Map();
  CATEGORY_CONFIG.forEach((cfg) => {
    fallbackSectionsMap.set(cfg.id, {
      id: cfg.id,
      title: cfg.title,
      name: cfg.title,
      section_id: cfg.id,
      sectionId: cfg.id,
      logo: cfg.logo,
      image: cfg.logo,
      count: 0,
    });
  });

  fallbackProducts.forEach((p) => {
    const key = p.section_id || "BAJA1000";
    if (!fallbackSectionsMap.has(key)) {
      const meta = getCategoryMeta(key);
      fallbackSectionsMap.set(key, {
        id: key,
        title: meta.title,
        name: meta.title,
        section_id: key,
        sectionId: key,
        logo: meta.logo,
        image: meta.logo,
        count: 0,
      });
    }
    fallbackSectionsMap.get(key).count += 1;
  });

  const fallbackSections = CATEGORY_CONFIG.map((cfg) => fallbackSectionsMap.get(cfg.id)).filter(Boolean);

  const sb = supabaseAdmin();
  if (!sb) {
    return withNoStore(
      jsonResponse(
        200,
        {
          ok: true,
          store: fallbackRaw.store,
          sections: fallbackSections,
          categories: fallbackSections,
          products: fallbackProducts,
        },
        origin
      )
    );
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
      return withNoStore(
        jsonResponse(
          200,
          {
            ok: true,
            store: fallbackRaw.store,
            sections: fallbackSections,
            categories: fallbackSections,
            products: fallbackProducts,
          },
          origin
        )
      );
    }

    const products = data
      .map((p) => {
        const sku = str(p?.sku);
        if (!sku) return null;

        const fb = fallbackBySku.get(sku) || null;

        const mergedImages = uniqStrings([
          ...arr(p?.images),
          ...(fb?.images || []),
          p?.image_url,
          p?.img,
        ]);

        const resolvedImages = uniqStrings(
          mergedImages.map((img) => resolveAssetPath(img, fb?.images || [])).filter(Boolean)
        );

        const primary = resolveAssetPath(
          p?.image_url || p?.img || fb?.image || fb?.image_url || resolvedImages[0],
          resolvedImages
        );

        const rawSection = str(p?.section_id || fb?.sectionId || fb?.section_id, "EDICION_2025");
        const uiSection = normalizeUiSection(rawSection);

        const priceCents =
          Number.isFinite(Number(p?.price_cents)) && num(p?.price_cents) > 0
            ? Math.max(0, Math.floor(num(p?.price_cents)))
            : Number.isFinite(Number(p?.price_mxn)) && num(p?.price_mxn) > 0
              ? Math.max(0, Math.round(num(p?.price_mxn) * 100))
              : Number.isFinite(Number(p?.base_mxn)) && num(p?.base_mxn) > 0
                ? Math.max(0, Math.round(num(p?.base_mxn) * 100))
                : Number.isFinite(Number(fb?.price_cents)) && num(fb?.price_cents) > 0
                  ? Math.max(0, Math.floor(num(fb?.price_cents)))
                  : 0;

        return {
          id: str(p?.id, sku),
          sku,
          title: str(p?.name || fb?.title || fb?.name, "Producto Oficial"),
          name: str(p?.name || fb?.name || fb?.title, "Producto Oficial"),
          description: str(p?.description || fb?.description),
          price_cents: priceCents,
          price_mxn: num(p?.price_mxn, num(fb?.price_mxn, 0)),
          base_mxn: num(p?.base_mxn, num(fb?.base_mxn, 0)),
          sectionId: rawSection,
          section_id: uiSection,
          uiSection,
          collection: str(p?.sub_section || fb?.collection || fb?.sub_section),
          sub_section: str(p?.sub_section || fb?.sub_section || fb?.collection),
          images: resolvedImages.length ? resolvedImages : primary ? [primary] : [],
          image: primary,
          image_url: primary,
          img: primary,
          sizes:
            arr(p?.sizes).length > 0
              ? arr(p?.sizes).filter(Boolean).map(String)
              : arr(fb?.sizes).length > 0
                ? arr(fb?.sizes).filter(Boolean).map(String)
                : ["S", "M", "L", "XL", "XXL"],
          rank: Number.isFinite(Number(p?.rank))
            ? Number(p.rank)
            : Number.isFinite(Number(fb?.rank))
              ? Number(fb.rank)
              : 999,
          stock: p?.stock == null ? (fb?.stock == null ? null : num(fb?.stock, 0)) : num(p?.stock, 0),
        };
      })
      .filter(Boolean);

    const counts = new Map();
    CATEGORY_CONFIG.forEach((cfg) => counts.set(cfg.id, 0));
    products.forEach((p) => counts.set(p.section_id, (counts.get(p.section_id) || 0) + 1));

    const sections = CATEGORY_CONFIG.map((cfg) => ({
      id: cfg.id,
      title: cfg.title,
      name: cfg.title,
      section_id: cfg.id,
      sectionId: cfg.id,
      logo: cfg.logo,
      image: cfg.logo,
      count: counts.get(cfg.id) || 0,
    }));

    return withNoStore(
      jsonResponse(
        200,
        {
          ok: true,
          store: fallbackRaw.store,
          sections,
          categories: sections,
          products,
        },
        origin
      )
    );
  } catch {
    return withNoStore(
      jsonResponse(
        200,
        {
          ok: true,
          store: fallbackRaw.store,
          sections: fallbackSections,
          categories: fallbackSections,
          products: fallbackProducts,
        },
        origin
      )
    );
  }
};