module.exports = async (req, res) => {
  const { jsonResponse, handleOptions, supabaseAdmin } = require("./_shared.js");

  const origin = req.headers.origin || "*";

  // 1. Manejo de CORS (Preflight)
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

  // 2. Validación de Método
  if (req.method !== "GET") {
    const response = withNoStore(jsonResponse(405, { ok: false, error: "Method not allowed" }, origin));
    Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
    return;
  }

  // 3. Configuración de Categorías (Tu lógica original)
  const CATEGORY_CONFIG = [
    { id: "BAJA1000", title: "BAJA 1000", logo: "/assets/logo-baja1000.webp", mapFrom: ["BAJA1000", "BAJA_1000"] },
    { id: "BAJA500", title: "BAJA 500", logo: "/assets/logo-baja500.webp", mapFrom: ["BAJA500", "BAJA_500"] },
    { id: "BAJA400", title: "BAJA 400", logo: "/assets/logo-baja400.webp", mapFrom: ["BAJA400", "BAJA_400"] },
    { id: "SF250", title: "SAN FELIPE 250", logo: "/assets/logo-sf250.webp", mapFrom: ["SF250", "SF_250"] },
  ];

  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());

  const resolveOrgId = async () => {
    const envId = process.env.SCORE_ORG_ID || process.env.DEFAULT_ORG_ID;
    if (envId && isUuid(envId)) return String(envId).trim();
    return "1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6"; // Fallback Org ID
  };

  // 4. Datos de Respaldo (Fallback sin los "...")
  const fallbackRaw = {
    store: { name: "SCORE STORE", currency: "MXN", locale: "es-MX" },
    sections: [],
    products: []
  };

  const sb = supabaseAdmin();
  
  // Si no hay conexión a Supabase, devolvemos el fallback ordenado
  if (!sb) {
    const response = jsonResponse(200, { ok: true, store: fallbackRaw.store, sections: [], products: [] }, origin);
    withNoStore(response);
    Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
    return;
  }

  try {
    const orgId = await resolveOrgId();

    const { data, error } = await sb
      .from("products")
      .select("id,sku,name,description,price_cents,price_mxn,base_mxn,images,sizes,section_id,sub_section,rank,img,image_url,stock,active,is_active,deleted_at,org_id,organization_id,created_at")
      .or(`org_id.eq.${orgId},organization_id.eq.${orgId}`)
      .is("deleted_at", null)
      .or("active.eq.true,is_active.eq.true")
      .order("rank", { ascending: true })
      .limit(800);

    if (error) throw error;

    const products = data || [];
    
    // Generar secciones dinámicas basadas en los productos encontrados
    const sections = CATEGORY_CONFIG.map(cfg => ({
      ...cfg,
      count: products.filter(p => p.section_id === cfg.id).length
    })).filter(s => s.count > 0 || s.id === "BAJA1000");

    const response = jsonResponse(200, {
      ok: true,
      store: fallbackRaw.store,
      sections,
      products
    }, origin);

    withNoStore(response);
    Object.keys(response.headers).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);

  } catch (e) {
    // Respuesta de error controlada (Fallback)
    const errorResponse = jsonResponse(200, { ok: true, store: fallbackRaw.store, error: e.message, sections: [], products: [] }, origin);
    res.status(errorResponse.statusCode).send(errorResponse.body);
  }
};
