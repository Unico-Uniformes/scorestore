/* SCORE STORE — Service Worker (PWA producción, resiliente v2.2.2)
   Objetivo: evitar “se queda en versión vieja” sin romper offline */

const CACHE_VERSION = "scorestore-vfx-pro-v2.2.2";
const CACHE_NAME = CACHE_VERSION;

const CORE_ASSETS = [
  "/",
  "/index.html",
  "/success.html",
  "/cancel.html",
  "/legal.html",
  "/css/styles.css",
  "/js/main.js",
  "/js/success.js",
  "/site.webmanifest",
  "/assets/logo-score.webp",
  "/assets/logo-world-desert.webp",
  "/assets/fondo-pagina-score.webp",
];

const isSafeToCache = (requestUrl) => {
  const url = new URL(requestUrl, self.location.origin);
  if (url.origin !== self.location.origin) return false;

  // 🔥 NO cachear data dinámica
  if (url.pathname.startsWith("/data/")) return false;

  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.includes("/.netlify/")) return false;

  return true;
};

async function reloadAllClients() {
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(
      clients.map((client) => {
        try { return client.navigate(client.url); } catch { return null; }
      })
    );
  } catch {}
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(
        CORE_ASSETS.map(async (asset) => {
          try {
            const res = await fetch(asset, { cache: "no-store" });
            if (res && res.ok) await cache.put(asset, res.clone());
          } catch {}
        })
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)));

      if ("navigationPreload" in self.registration) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }

      await self.clients.claim();

      // ✅ aplica assets nuevos en caliente
      await reloadAllClients();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Nunca interceptar proveedores
  if (
    url.origin.includes("stripe.com") ||
    url.origin.includes("supabase.co") ||
    url.origin.includes("envia.com")
  ) {
    return;
  }

  // 🔥 data dinámica: siempre red (NO SW)
  if (url.origin === self.location.origin && url.pathname.startsWith("/data/")) {
    return;
  }

  // Navegación: network-first (con preload) + fallback cache
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;

          const fresh = await fetch(req);
          if (fresh && fresh.ok && fresh.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return cached || caches.match("/index.html") || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // CORE: cache-first
  if (CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;

        const fresh = await fetch(req);
        if (fresh && fresh.ok) await cache.put(req, fresh.clone());
        return fresh;
      })()
    );
    return;
  }

  // Resto: stale-while-revalidate
  if (isSafeToCache(req.url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req, { ignoreSearch: true });

        const networkPromise = fetch(req)
          .then(async (fresh) => {
            if (fresh && fresh.ok) await cache.put(req, fresh.clone());
            return fresh;
          })
          .catch(() => null);

        event.waitUntil(networkPromise);

        return cached || (await networkPromise) || Response.error();
      })()
    );
  }
});