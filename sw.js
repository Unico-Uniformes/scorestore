/* SCORE STORE — Service Worker (PWA producción, resiliente v2.2.4)
   Objetivo:
   - Evitar “se queda en versión vieja”
   - No cachear /data/*.json (catálogo/promos dinámicos)
   - Lighthouse/DevTools: NO interceptar navegación (evita error Network.getResponseBody / charset)
*/
const CACHE_VERSION = "scorestore-vfx-pro-v2.2.4";
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
  if (url.pathname.startsWith("/admin/")) return false;
  if (url.pathname.endsWith(".json")) return false;
  return true;
};

async function reloadAllClients() {
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(
      clients.map((client) => {
        try {
          return client.navigate(client.url);
        } catch {
          return null;
        }
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

      await self.clients.claim();

      // ✅ Cuando un SW nuevo activa, recarga clientes para aplicar assets nuevos.
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
  if (url.origin.includes("stripe.com") || url.origin.includes("supabase.co") || url.origin.includes("envia.com")) {
    return;
  }

  // 🔥 Navegación: NO interceptamos (Lighthouse/DevTools estable)
  if (req.mode === "navigate") return;

  // 🔥 data dinámica: siempre red
  if (url.origin === self.location.origin && url.pathname.startsWith("/data/")) return;

  // CORE: cache-first
  if (url.origin === self.location.origin && CORE_ASSETS.includes(url.pathname)) {
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

  // JS/CSS: network-first (mitiga “versión vieja”)
  if (url.origin === self.location.origin && (url.pathname.startsWith("/js/") || url.pathname.startsWith("/css/"))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(new Request(req.url, { cache: "reload" }));
          if (fresh && fresh.ok && (fresh.type === "basic" || fresh.type === "cors")) {
            await cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await cache.match(req, { ignoreSearch: true });
          return cached || Response.error();
        }
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
            if (fresh && fresh.ok && (fresh.type === "basic" || fresh.type === "cors")) {
              await cache.put(req, fresh.clone());
            }
            return fresh;
          })
          .catch(() => null);

        event.waitUntil(networkPromise);

        return cached || (await networkPromise) || Response.error();
      })()
    );
  }
});