/* SCORE STORE — Service Worker (Pro-PWA 100%) */
const CACHE_VERSION = "scorestore-v2026.02.19.PRO";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/css/styles.css",
  "/js/main.js",
  "/site.webmanifest",
  "/data/catalog.json",
  "/assets/logo-score.webp",
  "/assets/logo-world-desert.webp",
  "/assets/fondo-pagina-score.webp"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignorar API y Netlify Functions para no romper Stripe/Envía/Supabase
  if (url.origin === self.location.origin && (url.pathname.startsWith("/api/") || url.pathname.includes("/.netlify/"))) return;
  if (req.method !== "GET") return;

  // Navegación: Network-first con fallback a index.html
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          return caches.open(CACHE_VERSION).then((cache) => {
            cache.put(req, response.clone());
            return response;
          });
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Assets: Cache-first, revalidate en background
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((networkResponse) => {
        caches.open(CACHE_VERSION).then((cache) => {
          cache.put(req, networkResponse.clone());
        });
        return networkResponse;
      }).catch(() => { /* offline silently */ });
      return cached || fetchPromise;
    })
  );
});
