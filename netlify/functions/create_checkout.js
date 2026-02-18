import Stripe from "stripe";
import fs from "node:fs/promises";
import { json, readJsonBody, withCORS, getSupabaseAdmin } from "./_shared.js";

let CATALOG_CACHE = null;
async function getCatalog() {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  const raw = await fs.readFile(new URL("../data/catalog.json", import.meta.url), "utf8");
  CATALOG_CACHE = JSON.parse(raw);
  return CATALOG_CACHE;
}

export const handler = withCORS(async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return json(500, { error: "STRIPE_SECRET_KEY missing" });

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

    const siteBase =
      process.env.PUBLIC_SITE_URL ||
      (event.headers["x-forwarded-proto"]
        ? `${event.headers["x-forwarded-proto"]}://${event.headers.host}`
        : `https://${event.headers.host}`);

    const body = await readJsonBody(event);
    const items = Array.isArray(body?.items) ? body.items : [];
    const shipping = body?.shipping || {};
    const org_id = body?.org_id || null;
    const promo = body?.promo?.code || null;

    if (!items.length) return json(400, { error: "Cart empty" });

    const catalog = await getCatalog();
    const products = catalog?.products || [];

    const byId = new Map(products.map((p) => [String(p.id || p.sku || ""), p]));

    const cacheExists = new Map(); // url -> boolean

    const line_items = [];
    for (const it of items) {
      const key = String(it.id || it.sku || "").trim();
      const qty = Math.max(1, Math.min(99, Number(it.qty || 1)));
      const size = String(it.size || "").trim();

      const p = byId.get(key) || products.find((x) => String(x.sku || "") === key);
      if (!p) return json(400, { error: `Product not found: ${key}` });

      const price_cents = Number(p.price_cents || 0);
      if (!price_cents) return json(400, { error: `Product missing price: ${key}` });

      // Imagen: NO placeholder. Solo si parece imagen y existe (HEAD/GET corto)
      const imgPath = (p.img && !looksLikePlaceholder(p.img)) ? p.img : "";
      const imgUrl = imgPath ? encodeUrl(siteBase, imgPath) : "";
      let images = undefined;

      if (imgUrl && looksLikeImage(imgUrl)) {
        const ok = await urlExistsCached(imgUrl, cacheExists);
        if (ok) images = [imgUrl];
      }

      line_items.push({
        quantity: qty,
        price_data: {
          currency: String(p.currency || "mxn").toLowerCase(),
          unit_amount: price_cents,
          product_data: {
            name: size ? `${p.name} — ${size}` : p.name,
            images,
            metadata: {
              sku: p.sku || p.id || key,
              size: size || "",
            },
          },
        },
      });
    }

    const success_url = `${siteBase}/?success=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${siteBase}/?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url,
      cancel_url,
      allow_promotion_codes: false,
      metadata: {
        org_id: org_id || "",
        promo_code: promo || "",
        shipping_mode: shipping?.mode || "",
        postal_code: shipping?.postal_code || "",
      },
    });

    // UPSERT order (idempotente)
    const db = getSupabaseAdmin();
    await db.from("orders").upsert(
      {
        org_id: org_id || null,
        stripe_session_id: session.id,
        status: "checkout_created",
        shipping_mode: shipping?.mode || null,
        postal_code: shipping?.postal_code || null,
        promo_code: promo || null,
        items: items,
        items_qty: items.reduce((a, x) => a + Number(x.qty || 0), 0),
        raw_stripe: session,
      },
      { onConflict: "stripe_session_id" }
    );

    return json(200, { id: session.id, url: session.url });
  } catch (err) {
    console.error(err);
    return json(500, { error: err?.message || "Server error" });
  }
});

function encodeUrl(base, path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${encodeURI(p)}`; // soporta espacios si existen
}

function looksLikePlaceholder(s) {
  const u = String(s || "").toLowerCase();
  return u.includes("placeholder") || u.includes("imagen-pendiente");
}

function looksLikeImage(url) {
  return /\.(png|jpe?g|webp|gif)$/i.test(String(url || ""));
}

async function urlExistsCached(url, cache) {
  if (cache.has(url)) return cache.get(url);
  const ok = await urlExists(url);
  cache.set(url, ok);
  return ok;
}

async function urlExists(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2500);

  try {
    // 1) HEAD
    let res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (res.ok) return true;

    // 2) fallback GET mini (algunos hosts bloquean HEAD)
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
      });
      return res.ok;
    }

    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}