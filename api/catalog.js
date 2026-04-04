"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_STORE = {
  name: "SCORE STORE",
  slug: "score-store",
  currency: "MXN",
};

const CATEGORY_CONFIG = [
  {
    uiId: "BAJA1000",
    name: "BAJA 1000",
    logo: "/assets/logo-baja1000.webp",
    mapFrom: ["BAJA1000", "BAJA_1000", "EDICION_2025", "OTRAS_EDICIONES", "BAJA_1000_2025"],
  },
  {
    uiId: "BAJA500",
    name: "BAJA 500",
    logo: "/assets/logo-baja500.webp",
    mapFrom: ["BAJA500", "BAJA_500"],
  },
  {
    uiId: "BAJA400",
    name: "BAJA 400",
    logo: "/assets/logo-baja400.webp",
    mapFrom: ["BAJA400", "BAJA_400"],
  },
  {
    uiId: "SF250",
    name: "SAN FELIPE 250",
    logo: "/assets/logo-sf250.webp",
    mapFrom: ["SF250", "SF_250"],
  },
];

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Content-Type": "application/json; charset=utf-8",
};

function json(res, status, payload, origin = "*") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", noStoreHeaders["Cache-Control"]);
  res.setHeader("Pragma", noStoreHeaders.Pragma);
  res.setHeader("Expires", noStoreHeaders.Expires);
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
  res.end(JSON.stringify(payload ?? {}));
}

function cleanText(v) {
  if (v == null) return "";
  return String(v).trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeUrl(u) {
  const value = cleanText(u);
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  return "";
}

function normalizeSectionToUi(sectionId) {
  const sid = cleanText(sectionId);
  const found = CATEGORY_CONFIG.find((c) => c.mapFrom.includes(sid));
  return found ? found.uiId : "BAJA1000";
}

function inferCollection(p) {
  const sid = cleanText(p?.sectionId || p?.section_id || p?.section || p?.categoryId || "");
  if (sid === "EDICION_2025") return "Edición 2025";
  if (sid === "OTRAS_EDICIONES") return "Otras ediciones";
  return cleanText(p?.collection || p?.sub_section || "");
}

function normalizeProduct(row) {
  if (!row || typeof row !== "object") return null;

  const images = Array.isArray(row.images)
    ? row.images
    : row.image_url || row.img || row.image
      ? [row.image_url || row.img || row.image]
      : [];

  const sizes = Array.isArray(row.sizes) && row.sizes.length
    ? row.sizes
    : ["S", "M", "L", "XL", "XXL"];

  const priceFrom =
    Number.isFinite(Number(row.price_cents)) ? Math.round(Number(row.price_cents)) :
    Number.isFinite(Number(row.price_mxn)) ? Math.round(Number(row.price_mxn) * 100) :
    Number.isFinite(Number(row.base_mxn)) ? Math.round(Number(row.base_mxn) * 100) :
    Number.isFinite(Number(row.price)) ? Math.round(Number(row.price) * 100) :
    0;

  const sectionRaw = cleanText(
    row.sectionId || row.section_id || row.section || row.categoryId || ""
  );

  const sku = cleanText(row.sku || row.id || row.slug || "");
  const name = cleanText(row.name || row.title || "Producto SCORE");
  const title = cleanText(row.title || row.name || "Producto SCORE");
  const description = cleanText(row.description || "");
  const primaryImage = safeUrl(row.image_url || row.img || row.image || images[0] || "");

  return {
    ...row,
    id: cleanText(row.id || sku),
    sku,
    title,
    name,
    description,
    sectionId: sectionRaw,
    section_id: sectionRaw,
    uiSection: normalizeSectionToUi(sectionRaw),
    collection: inferCollection(row),
    sub_section: inferCollection(row),
    category: cleanText(row.category || ""),
    image: primaryImage,
    image_url: primaryImage,
    img: primaryImage,
    images: images.map(safeUrl).filter(Boolean),
    sizes: sizes.map((x) => cleanText(x)).filter(Boolean),
    price_cents: priceFrom,
    price_mxn: Number.isFinite(Number(row.price_mxn)) ? Number(row.price_mxn) : priceFrom / 100,
    base_mxn: Number.isFinite(Number(row.base_mxn)) ? Number(row.base_mxn) : priceFrom / 100,
    rank: Number.isFinite(Number(row.rank)) ? Math.round(Number(row.rank)) : 999,
    stock: row.stock == null ? null : toNumber(row.stock, 0),
    active: row.active == null ? true : !!row.active,
    is_active: row.is_active == null ? true : !!row.is_active,
    deleted_at: row.deleted_at || null,
  };
}

function normalizeSection(row) {
  if (!row || typeof row !== "object") return null;

  const id = cleanText(row.id || row.slug || row.section_id || row.sectionId || "");
  if (!id) return null;

  const cfg = CATEGORY_CONFIG.find((c) => c.uiId === id || c.mapFrom.includes(id));

  return {
    id,
    uiId: cfg?.uiId || id,
    name: cleanText(row.name || row.title || cfg?.name || id),
    logo: safeUrl(row.logo || row.image || cfg?.logo || ""),
    section_id: cleanText(row.section_id || row.sectionId || id),
    count: Number.isFinite(Number(row.count)) ? Number(row.count) : 0,
    active: row.active == null ? true : !!row.active,
  };
}

function attachCounts(sections, products) {
  const map = new Map();

  for (const p of Array.isArray(products) ? products : []) {
    const key = cleanText(p.sectionId || p.section_id || p.uiSection || "BAJA1000");
    map.set(key, (map.get(key) || 0) + 1);
  }

  return sections.map((s) => ({
    ...s,
    count: map.get(cleanText(s.section_id || s.id || s.uiId)) || 0,
  }));
}

function buildSectionsFromProducts(products) {
  const map = new Map();

  for (const p of Array.isArray(products) ? products : []) {
    const sectionId = cleanText(p.sectionId || p.section_id || p.uiSection || "BAJA1000");
    if (!map.has(sectionId)) {
      const cfg = CATEGORY_CONFIG.find((c) => c.uiId === sectionId || c.mapFrom.includes(sectionId));
      map.set(sectionId, {
        id: sectionId,
        uiId: cfg?.uiId || sectionId,
        name: cfg?.name || sectionId.replace(/_/g, " "),
        logo: cfg?.logo || "",
        section_id: sectionId,
        count: 0,
        active: true,
      });
    }
    const current = map.get(sectionId);
    current.count += 1;
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function readJsonFile(relPath) {
  try {
    const p1 = path.join(process.cwd(), relPath);
    const p2 = path.join(__dirname, "..", relPath);
    const file = fs.existsSync(p1) ? p1 : p2;
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function shouldIncludeInactive(req) {
  const value =
    req.query?.include_inactive ||
    req.query?.includeInactive ||
    req.query?.drafts ||
    "0";

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parsePayload(raw) {
  const data = raw && typeof raw === "object" ? raw : {};

  const rawSections = Array.isArray(data.sections)
    ? data.sections
    : Array.isArray(data.categories)
      ? data.categories
      : [];

  const rawProducts = Array.isArray(data.products)
    ? data.products
    : Array.isArray(data.items)
      ? data.items
      : [];

  const products = rawProducts.map(normalizeProduct).filter(Boolean);
  let sections = rawSections.map(normalizeSection).filter(Boolean);

  if (!sections.length) {
    sections = buildSectionsFromProducts(products);
  } else {
    sections = attachCounts(sections, products);
  }

  return {
    ok: true,
    store: data.store && typeof data.store === "object" ? data.store : DEFAULT_STORE,
    sections,
    categories: sections,
    products,
    items: products,
  };
}

async function loadCatalogSource() {
  const fromJson = readJsonFile("data/catalog.json");
  if (fromJson && typeof fromJson === "object") return fromJson;

  return { products: [], sections: [], categories: [] };
}

async function loadStoreInfo() {
  const defaults = { ...DEFAULT_STORE };

  try {
    const site = readJsonFile("data/site.json");
    if (site && typeof site === "object") {
      const title = cleanText(site.hero_title || site.name || "");
      if (title) defaults.name = title;
    }
  } catch {}

  return defaults;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || req.headers.Origin || "*";

  try {
    if (req.method === "OPTIONS") {
      return json(res, 204, {}, origin);
    }

    if (req.method !== "GET") {
      return json(res, 405, { ok: false, error: "Method not allowed" }, origin);
    }

    const rawCatalog = await loadCatalogSource();
    const store = await loadStoreInfo();

    const normalized = parsePayload({
      ...rawCatalog,
      store: {
        ...(rawCatalog?.store && typeof rawCatalog.store === "object" ? rawCatalog.store : {}),
        ...store,
      },
    });

    const q = cleanText(req.query?.q || req.query?.search || "");
    const section = cleanText(req.query?.section || req.query?.sectionId || req.query?.uiSection || "");
    const includeInactive = shouldIncludeInactive(req);

    let products = Array.isArray(normalized.products) ? [...normalized.products] : [];

    if (!includeInactive) {
      products = products.filter((p) => p.active !== false && p.is_active !== false && !p.deleted_at);
    }

    if (section) {
      const target = section.toUpperCase();
      products = products.filter((p) => {
        const candidates = [
          cleanText(p.sectionId).toUpperCase(),
          cleanText(p.section_id).toUpperCase(),
          cleanText(p.uiSection).toUpperCase(),
          cleanText(p.category).toUpperCase(),
        ];
        return candidates.includes(target);
      });
    }

    if (q) {
      const needle = q.toLowerCase();
      products = products.filter((p) => {
        const hay = [
          p.name,
          p.title,
          p.description,
          p.sku,
          p.collection,
          p.sub_section,
          p.category,
          p.sectionId,
          p.section_id,
        ]
          .map((v) => cleanText(v))
          .join(" ")
          .toLowerCase();

        return hay.includes(needle);
      });
    }

    products.sort((a, b) => {
      const ra = Number.isFinite(Number(a.rank)) ? Number(a.rank) : 999;
      const rb = Number.isFinite(Number(b.rank)) ? Number(b.rank) : 999;
      if (ra !== rb) return ra - rb;
      return cleanText(a.name).localeCompare(cleanText(b.name), "es");
    });

    const sections = attachCounts(
      Array.isArray(normalized.sections) ? normalized.sections : [],
      products
    );

    return json(
      res,
      200,
      {
        ok: true,
        store: normalized.store,
        sections,
        categories: sections,
        products,
        items: products,
        total: products.length,
        query: q || "",
        section: section || "",
      },
      origin
    );
  } catch (error) {
    return json(
      res,
      500,
      {
        ok: false,
        error: String(error?.message || error || "No se pudo cargar el catálogo"),
      },
      origin
    );
  }
};