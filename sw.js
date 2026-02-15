/* =========================================================
   SCORE STORE — Service Worker (PWA) · PROD UNIFICADO
   VERSION: 2026_PROD_UNIFIED_362
   Strategy:
   - Network-first: HTML (evita páginas viejas)
   - Cache-first: estáticos (CSS/JS/IMG/FONTS)
   - Stale-while-revalidate: JSON (/data/*.json)
   - Nunca cachea /api/* ni /.netlify/functions/*
   ========================================================= */

const VERSION = "2026_PROD_UNIFIED_362";
const CACHE_STATIC = `scorestore_static_${VERSION}`;
const CACHE_PAGES  = `scorestore_pages_${VERSION}`;
const CACHE_DATA   = `scorestore_data_${VERSION}`;

// ⚠️ IMPORTANTE: Solo precachea archivos que EXISTEN.
// Si metes rutas 404 aquí, el SW puede fallar al instalar.
const PRECACHE = [
  "/",
  "/index.html",
  "/legal.html",
  "/css/styles.css",
  "/js/main.js",
  "/data/catalog.json",
  "/data/promos.json",
  "/site.webmanifest",
  "/robots.txt",
  "/sitemap.xml",

  "/assets/hero.webp",
  "/assets/fondo-pagina-score.webp",
  "/assets/baja1000-texture.webp",

  "/assets/logo-score.webp",
  "/assets/logo-world-desert.webp",
  "/assets/logo-baja1000.webp",
  "/assets/logo-baja500.webp",
  "/assets/logo-baja400.webp",
  "/assets/logo-sf250.webp",

  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-192-maskable.png",
  "/assets/icons/icon-512-maskable.png"
];

const STATIC_EXT = /\.(?:css|js|png|jpg|jpeg|webp|svg|ico|woff2?|webmanifest|txt|xml)$/i;
const DATA_EXT   = /\.(?:json)$/i;

function isAPI(url) {
  try {
    const u = new URL(url);
    return u.pathname.startsWith("/api/") || u.pathname.startsWith("/.netlify/functions/");
  } catch {
    return false;
  }
}

function isHTML(req) {
  return req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
}

function stripSearch(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

async function cachePutSafe(cache, url, res) {
  try {
    if (res && res.ok) await cache.put(url, res.clone());
  } catch {}
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (![CACHE_STATIC, CACHE_PAGES, CACHE_DATA].includes(k) ? caches.delete(k) : Promise.resolve()))
    );
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (isAPI(req.url)) return;

  // HTML: network-first
  if (isHTML(req)) {
    event.respondWith((async () => {
      const pages = await caches.open(CACHE_PAGES);
      try {
        const fresh = await fetch(req);
        await cachePutSafe(pages, stripSearch(req.url), fresh);
        return fresh;
      } catch {
        const cached = await pages.match(req, { ignoreSearch: true }) || await pages.match(stripSearch(req.url));
        if (cached) return cached;

        // fallback: homepage del static cache
        const stat = await caches.open(CACHE_STATIC);
        const home = await stat.match("/") || await stat.match("/index.html");
        if (home) return home;

        return new Response("<!doctype html><title>Offline</title><p>Sin conexión.</p>", {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
    })());
    return;
  }

  const path = (() => { try { return new URL(req.url).pathname; } catch { return ""; } })();

  // JSON: stale-while-revalidate
  if (DATA_EXT.test(path)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_DATA);
      const cached = await cache.match(req, { ignoreSearch: true }) || await cache.match(stripSearch(req.url));

      const freshPromise = (async () => {
        try {
          const fresh = await fetch(req);
          await cachePutSafe(cache, stripSearch(req.url), fresh);
          return fresh;
        } catch {
          return null;
        }
      })();

      return cached || (await freshPromise) || new Response("{}", { headers: { "Content-Type": "application/json" } });
    })());
    return;
  }

  // Static assets: cache-first
  if (STATIC_EXT.test(path) || STATIC_EXT.test(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_STATIC);
      const cached =
        (await cache.match(req)) ||
        (await cache.match(req, { ignoreSearch: true })) ||
        (await cache.match(stripSearch(req.url)));

      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        await cachePutSafe(cache, stripSearch(req.url), fresh);
        return fresh;
      } catch {
        return new Response("", { status: 504 });
      }
    })());
  }
});
