module.exports = async (req, res) => {
  const { jsonResponse, handleOptions, supabaseAdmin, readJsonFile } = require("./_shared");

  const origin = req.headers.origin || "*";

  if (req.method === "OPTIONS") {
    const optionsRes = handleOptions({ headers: { origin } });
    Object.keys(optionsRes.headers).forEach(key => res.setHeader(key, optionsRes.headers[key]));
    res.status(optionsRes.statusCode).send(optionsRes.body);
    return;
  }

  const withNoStore = (resp) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return resp;
  };

  if (req.method !== "GET") {
    const response = withNoStore(jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
    return;
  }

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

  const isUuid = (s) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());

  const getCategoryMeta = (uiId) =>
    CATEGORY_CONFIG.find((x) => x.id === uiId) || CATEGORY_CONFIG[0];

  const resolveOrgId = async () => {
    const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
    if (envId && isUuid(envId)) return String(envId).trim();
    return "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6";
  };

  const buildFallback = () => {
    const fallbackData = readJsonFile("data/catalog.json");
    const fallbackProducts = Array.isArray(fallbackData?.products) ? fallbackData.products : [];
    const fallbackSectionsMap = new Map();

    CATEGORY_CONFIG.forEach((cfg) => {
        fallbackSectionsMap.set(cfg.id, {
            id: cfg.id, title: cfg.title, name: cfg.title, section_id: cfg.id, sectionId: cfg.id,
            logo: cfg.logo, image: cfg.logo, count: 0,
        });
    });

    fallbackProducts.forEach((p) => {
        const key = p.section_id || "BAJA1000";
        if (fallbackSectionsMap.has(key)) {
            fallbackSectionsMap.get(key).count += 1;
        }
    });

    const fallbackSections = CATEGORY_CONFIG.map((cfg) => fallbackSectionsMap.get(cfg.id)).filter(Boolean);

    return {
        store: { name: "SCORE STORE", currency: "MXN", locale: "es-MX" },
        sections: fallbackSections,
        products: fallbackProducts,
    };
  };

  const sb = supabaseAdmin();
  if (!sb) {
    const fallback = buildFallback();
    const response = jsonResponse(200, { ok: true, ...fallback }, origin);
    withNoStore(response);
    Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
    return;
  }

  try {
    const orgId = await resolveOrgId();
    const { data, error } = await sb
      .from("products")
      .select("id,sku,name,description,price_cents,price_mxn,images,sizes,section_id,rank,image_url,stock,is_active")
      .or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("rank", { ascending: true })
      .limit(800);

    if (error || !Array.isArray(data) || data.length === 0) {
      const fallback = buildFallback();
      const response = jsonResponse(200, { ok: true, ...fallback, error: error?.message }, origin);
      withNoStore(response);
      Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
      res.status(response.statusCode).send(response.body);
      return;
    }

    const products = data.map(p => { 
        const p_images = Array.isArray(p.images) ? p.images : [];
        if(p.image_url && !p_images.includes(p.image_url)) p_images.unshift(p.image_url);

        return {
            ...p,
            price_cents: p.price_cents || Math.round(p.price_mxn * 100),
            sectionId: p.section_id, //Legacy support
            images: p_images
        }
    });

    const counts = new Map();
    CATEGORY_CONFIG.forEach((cfg) => counts.set(cfg.id, 0));
    products.forEach((p) => {
        const key = p.section_id || "BAJA1000";
        counts.set(key, (counts.get(key) || 0) + 1)
    });

    const sections = CATEGORY_CONFIG.map((cfg) => ({
      id: cfg.id, title: cfg.title, name: cfg.title, section_id: cfg.id, sectionId: cfg.id,
      logo: cfg.logo, image: cfg.logo, count: counts.get(cfg.id) || 0,
    }));

    const response = jsonResponse(200, { ok: true, store: { name: "SCORE STORE", currency: "MXN", locale: "es-MX" }, sections, products }, origin );
    withNoStore(response);
    Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);

  } catch (e) {
    const fallback = buildFallback();
    const response = jsonResponse(200, { ok: true, ...fallback, error: e?.message }, origin);
    withNoStore(response);
    Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
  }
};