/* =========================================================
   SCORE STORE — Service Worker (anti-cache viejo)
   - Cache versionado
   - Network-first para HTML/JS/CSS/manifest
   - Stale-while-revalidate para assets (imágenes)
   ========================================================= */

const SW_VERSION = "2026.02.19.2";
const CORE_CACHE = `scorestore-core-${SW_VERSION}`;
const ASSET_CACHE = `scorestore-assets-${SW_VERSION}`;

// Archivos mínimos para arrancar la app
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/css/styles.css",
  "/js/main.js",
  "/data/catalog.json",
  "/site.webmanifest",
];

// Helpers
const isHTML = (req) =>
  req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

const isCoreLike = (url) =>
  url.pathname === "/" ||
  url.pathname.endsWith(".html") ||
  url.pathname.endsWith(".js") ||
  url.pathname.endsWith(".css") ||
  url.pathname.endsWith(".json") ||
  url.pathname.endsWith(".webmanifest");

// Install
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      await cache.addAll(CORE_ASSETS);
      self.skipWaiting();
    })()
  );
});

// Activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k.startsWith("scorestore-") &&
              ![CORE_CACHE, ASSET_CACHE].includes(k)
          )
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo mismo origen (evita cachear Stripe, FB, etc.)
  if (url.origin !== self.location.origin) return;

  // Network-first para navegación y archivos core (evita el "JS viejo" en Netlify)
  if (isHTML(req) || isCoreLike(url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Assets (imágenes, fuentes) => SWR
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CORE_CACHE);

  try {
    const fresh = await fetch(req, { cache: "no-store" });
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;

    const fallback = await cache.match("/index.html");
    return (
      fallback ||
      new Response("Offline", {
        status: 503,
        headers: { "content-type": "text/plain" },
      })
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  return (
    cached ||
    (await fetchPromise) ||
    new Response("Offline", {
      status: 503,
      headers: { "content-type": "text/plain" },
    })
  );
}
