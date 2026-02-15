/* SCORE STORE — service worker (v2026_PROD_UNIFIED_401)
   - Cache-first for static assets + Netlify Images
   - Stale-while-revalidate for /data/*.json
   - Never cache /api/* or /.netlify/functions/*
   - Precache is "best effort" (no rompe instalación si falta un asset)
*/

const VERSION = "2026_PROD_UNIFIED_401";
const STATIC_CACHE = `score_static_${VERSION}`;
const DATA_CACHE = `score_data_${VERSION}`;

const PRECACHE = [
  "/",
  "/index.html",
  "/legal.html",

  "/css/styles.css?v=2026_PROD_UNIFIED_401",
  "/js/main.js?v=2026_PROD_UNIFIED_401",
  "/site.webmanifest?v=2026_PROD_UNIFIED_401",

  "/data/catalog.json",
  "/data/promos.json",

  // optional assets (best effort)
  "/assets/favicon.png",
  "/assets/logo-score.webp",
  "/assets/hero.webp",
  "/assets/fondo-pagina-score.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // Best effort precache (no falla si falta algo)
    await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (![STATIC_CACHE, DATA_CACHE].includes(k)) return caches.delete(k);
    }));
    self.clients.claim();
  })());
});

function isApi(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/functions/");
}

function isNetlifyImage(url) {
  return url.pathname === "/.netlify/images";
}

function isDataJson(url) {
  return url.pathname.startsWith("/data/") && url.pathname.endsWith(".json");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/css/") ||
    url.pathname.startsWith("/js/") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg")
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response("{}", { headers: { "Content-Type": "application/json" } });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // never cache API
  if (isApi(url)) return;

  // navigation fallback
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        const cache = await caches.open(STATIC_CACHE);
        cache.put("/index.html", res.clone());
        return res;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match("/index.html")) || Response.error();
      }
    })());
    return;
  }

  if (isDataJson(url)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (isNetlifyImage(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
});
