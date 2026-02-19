/* SCORE STORE — service worker (v2026.02.18)
   - Cache-first for static assets + Netlify Images
   - Stale-while-revalidate for /data/*.json
   - Never cache /api/* or /.netlify/functions/*
   - Precache is best-effort (won't break install if an asset is missing)
*/

const VERSION = "2026.02.18";
const STATIC_CACHE = `score_static_${VERSION}`;
const DATA_CACHE = `score_data_${VERSION}`;

const PRECACHE = [
  "/",
  "/index.html",
  "/legal.html",
  "/success.html",
  "/cancel.html",

  "/css/styles.css",
  "/js/main.js",
  "/site.webmanifest",
  "/sitemap.xml",
  "/robots.txt",

  "/data/catalog.json",
  "/data/promos.json",

  // icons (optimized)
  "/assets/icons/icon-192-v2.png",
  "/assets/icons/icon-512-v2.png",
  "/assets/icons/icon-192-maskable-v2.png",
  "/assets/icons/maskable-icon-512.png",
  "/assets/icons/apple-touch-icon.png",

  // optional assets (best effort)
  "/assets/favicon.ico",
  "/assets/favicon.png",
  "/assets/logo-score.webp",
  "/assets/logo-world-desert.webp",
  "/assets/fondo-pagina-score.webp",
  "/assets/hero.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (![STATIC_CACHE, DATA_CACHE].includes(k)) return caches.delete(k);
          return null;
        })
      );
      self.clients.claim();
    })()
  );
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
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".xml") ||
    url.pathname.endsWith(".txt")
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
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  return cached || (await networkPromise) || new Response("{}", { headers: { "Content-Type": "application/json" } });
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put("/index.html", res.clone());
      return res;
    }
  } catch {
    // ignore
  }
  return (await cache.match("/index.html")) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // never cache API
  if (isApi(url)) return;

  // navigation fallback
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isDataJson(url)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (isNetlifyImage(url) || isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
});