const fs = require("fs");
const path = require("path");

const {
  stripe,
  jsonResponse,
  handleOptions,
  safeJsonParse,
  supabaseAdmin,
  getEnviaQuote,
  getFallbackShipping,
  baseUrl,
} = require("./_shared");

// /.netlify/functions/create_checkout
// Front payload (v2026_PROD_UNIFIED_401):
//  {
//    cart:[{id,sku,name,price,img,qty,section,subSection}],
//    shippingMode:"pickup"|"mx"|"us",
//    shippingLabel:"...",
//    shipping:<number>,
//    shippingData:{ zip, carrier, label }
//  }
//
// Also supports legacy/new formats already in your file.

let CATALOG_CACHE = null;
function loadCatalog() {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  const file = path.join(__dirname, "..", "..", "data", "catalog.json");
  const raw = fs.readFileSync(file, "utf-8");
  const json = JSON.parse(raw);
  const map = new Map();
  (json.products || []).forEach((p) => map.set(String(p.id), p));
  CATALOG_CACHE = { json, map };
  return CATALOG_CACHE;
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || "")
  );
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function normalizeBody(event) {
  return safeJsonParse(event.body || "{}") || {};
}

function normalizeShipping(body) {
  // mode
  const mode =
    body?.shipping?.mode ||
    body?.mode ||
    body?.shipping_mode ||
    body?.shippingMode ||
    "pickup";

  // cost: acepta body.shipping (number) del front
  const cost =
    Number(
      body?.shipping?.cost ??
        body?.shipping_cost ??
        body?.shippingAmount ??
        body?.shipping ??
        0
    ) || 0;

  // label (del front)
  const label =
    String(body?.shippingLabel || body?.shipping?.label || body?.shipping?.name || "").trim();

  // country
  const modeNorm = String(mode).toLowerCase();
  const country =
    modeNorm === "us"
      ? "US"
      : String(body?.shipping?.country || body?.country || body?.shippingCountry || "MX").toUpperCase();

  // postal/zip: acepta shippingData.zip del front
  const postal =
    String(
      body?.shipping?.postal_code ||
        body?.shipping?.zip ||
        body?.shippingData?.zip ||
        body?.zip ||
        body?.postal_code ||
        body?.cp ||
        ""
    ).trim();

  return { mode: String(modeNorm), cost, country, postal_code: postal, label };
}

function normalizeItemsFromCart(body) {
  // Prefer: front cart
  const cart = Array.isArray(body?.cart) ? body.cart : [];
  if (cart.length) {
    return cart
      .map((i) => ({
        id: String(i.id || i.sku || i.name || "").trim(),
        qty: Math.max(1, Number(i.qty || 1) || 1),
        size: String(i.size || "").trim(),
        legacy: {
          name: i.name,
          price: i.price,
          image: i.img || i.image,
          sku: i.sku,
          section: i.section,
          subSection: i.subSection,
        },
      }))
      .filter((i) => i.id);
  }

  // New format
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length) {
    return items
      .map((i) => ({
        id: String(i.id || "").trim(),
        qty: Math.max(1, Number(i.qty || 1) || 1),
        size: String(i.size || "").trim(),
      }))
      .filter((i) => i.id);
  }

  return [];
}

async function resolveProducts(items) {
  // Prefer DB only if all UUID
  const allUuid = items.length && items.every((i) => isUuid(i.id));
  if (supabaseAdmin && allUuid) {
    const ids = items.map((i) => i.id);
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id,name,price,image_url,sku")
      .in("id", ids);

    if (!error && Array.isArray(data) && data.length) {
      const map = new Map(data.map((p) => [String(p.id), p]));
      return { source: "supabase", map };
    }
  }

  // Fallback local catalog
  const { map } = loadCatalog();
  return { source: "catalog", map };
}

function toAbsImage(site, url) {
  if (!url) return null;
  const u = String(url).trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${site}${u}`;
  return `${site}/${u}`;
}

function buildLineItems(items, productMap, source, site) {
  const line_items = [];

  for (const i of items) {
    const ref = productMap.get(String(i.id));

    // Allow legacy fallback if not found
    if (!ref && i.legacy && i.legacy.name && i.legacy.price) {
      const name = String(i.legacy.name);
      const unit = Math.max(1, Number(i.legacy.price) || 0);
      const img = toAbsImage(site, i.legacy.image);
      line_items.push({
        quantity: i.qty,
        price_data: {
          currency: "mxn",
          unit_amount: Math.round(unit * 100),
          product_data: {
            name: i.size ? `${name} (${i.size})` : name,
            ...(img ? { images: [img] } : {}),
            metadata: {
              sku: String(i.legacy.sku || i.id || ""),
              edition: String(i.legacy.section || ""),
              sub: String(i.legacy.subSection || ""),
            },
          },
        },
      });
      continue;
    }

    if (!ref) {
      throw new Error(`Producto no encontrado (${source}): ${i.id}`);
    }

    const name = String(ref.name || ref.title || ref.id);
    const price = Number(ref.price ?? ref.baseMXN ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Precio inválido para ${i.id}`);
    }

    const img = toAbsImage(site, ref.image_url || ref.img || (ref.images && ref.images[0]));

    line_items.push({
      quantity: i.qty,
      price_data: {
        currency: "mxn",
        unit_amount: Math.round(price * 100),
        product_data: {
          name: i.size ? `${name} (${i.size})` : name,
          ...(img ? { images: [img] } : {}),
          metadata: {
            sku: String(ref.sku || i.id || ""),
          },
        },
      },
    });
  }

  return line_items;
}

async function computeShipping(shipping, items) {
  const mode = String(shipping.mode || "pickup").toLowerCase();
  const items_qty = items.reduce((a, it) => a + (Number(it.qty) || 1), 0) || 1;

  if (mode === "pickup") return { amount: 0, label: "Pickup Gratis" };

  // si el front ya cotizó, usamos eso (clamp)
  if (Number(shipping.cost) > 0) {
    const amt = clamp(Number(shipping.cost), 0, 100000);
    return { amount: amt, label: shipping.label || "Envío" };
  }

  // intentar Envia si hay CP
  if (shipping.postal_code) {
    const q = await getEnviaQuote({
      zip: shipping.postal_code,
      country: shipping.country || (mode === "us" ? "US" : "MX"),
      items_qty,
    });

    const amount = Number(q?.amount ?? q?.amount_mxn ?? q?.cost ?? 0) || 0;
    if (q?.ok && amount >= 0) {
      return { amount, label: q.label || "Envío", carrier: q.carrier || null };
    }
  }

  // fallback conservador
  const fallback = getFallbackShipping({
    country: shipping.country || (mode === "us" ? "US" : "MX"),
    items_qty,
  });
  return { amount: fallback, label: "Envío (estimación)" };
}

exports.handler = async (event) => {
  const opt = handleOptions(event);
  if (opt) return opt;

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method Not Allowed" });
  }

  if (!stripe) {
    return jsonResponse(500, {
      ok: false,
      error: "Stripe no configurado (STRIPE_SECRET_KEY missing o dependencia stripe faltante)",
    });
  }

  try {
    const body = normalizeBody(event);

    const items = normalizeItemsFromCart(body);
    if (!items.length) return jsonResponse(400, { ok: false, error: "Carrito vacío" });

    const shipping = normalizeShipping(body);

    const site = baseUrl(event) || (process.env.SITE_URL || process.env.URL || "https://scorestore.netlify.app").replace(/\/$/, "");

    const { source, map } = await resolveProducts(items);
    const line_items = buildLineItems(items, map, source, site);

    const ship = await computeShipping(shipping, items);

    // Add shipping as line item (MXN)
    if (ship.amount > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "mxn",
          unit_amount: Math.round(Number(ship.amount) * 100),
          product_data: { name: `Envío (${ship.label})` },
        },
      });
    }

    const success_url = `${site}/?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${site}/?status=cancel`;

    const needsAddress = shipping.mode !== "pickup";

    const items_qty = items.reduce((a, it) => a + (Number(it.qty) || 1), 0) || 1;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      success_url,
      cancel_url,

      phone_number_collection: { enabled: true },

      ...(needsAddress
        ? { shipping_address_collection: { allowed_countries: ["MX", "US"] } }
        : {}),

      metadata: {
        app: "score-store",
        version: "2026_PROD_UNIFIED_401_PATCH",
        items_qty: String(items_qty),

        shipping_mode: String(shipping.mode),
        shipping_country: String(shipping.country || "MX"),
        shipping_postal_code: String(shipping.postal_code || ""),
        shipping_amount_mxn: String(ship.amount || 0),

        // compat para webhook
        customer_cp: String(shipping.postal_code || ""),
        customer_country: String(shipping.country || "MX"),
      },
    });

    // Optional: store order in Supabase (no rompe checkout si falla)
    if (supabaseAdmin) {
      try {
        const raw_meta = {
          source,
          items,
          shipping: { ...shipping, computed_amount: ship.amount, label: ship.label || ship.label },
          stripe: { id: session.id },
        };

        await supabaseAdmin.from("orders").insert({
          stripe_session_id: session.id,
          status: "pending",
          shipping_mode: String(shipping.mode),
          shipping_amount_mxn: Number(ship.amount || 0),
          total_mxn: null,
          raw_meta: JSON.stringify(raw_meta),
        });
      } catch (e) {
        console.warn("orders insert skipped:", e?.message || e);
      }
    }

    return jsonResponse(200, { ok: true, url: session.url, id: session.id });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err?.message || String(err) });
  }
};
