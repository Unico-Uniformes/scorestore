/* SCORE STORE — Service Worker (PWA producción, Vercel-ready v3.0.0)
   Objetivo:
   - Evitar quedarse pegado a una versión vieja
   - No cachear /data/*.json ni /api/*
   - Bypassear Stripe / Supabase / Envia / proveedores externos
   - Mantener navegación estable con fallback a caché
   - No dejar rastros de Netlify
*/

const CACHE_VERSION = "scorestore-vfx-pro-v3.0.0";
const CACHE_NAME = CACHE_VERSION;

const CORE_ASSETS = [
  "/",
  "/index.html",
  "/success.html",
  "/cancel.html",
  "/legal.html",
  "/css/styles.css",
  "/css/override.css",
  "/js/main.js",
  "/js/success.js",
  "/site.webmanifest",
  "/assets/logo-score.webp",
  "/assets/logo-world-desert.webp",
  "/assets/fondo-pagina-score.webp",
  "/assets/hero.webp",
];

const EXTERNAL_SKIP_HOSTS = [
  "stripe.com",
  "supabase.co",
  "envia.com",
  "facebook.com",
  "connect.facebook.net",
  "googleapis.com",
  "generativelanguage.googleapis.com",
];

const isSafeToCache = (requestUrl) => {
  const url = new URL(requestUrl, self.location.origin);

  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/data/")) return false;
  if (url.pathname.startsWith("/admin/")) return false;
  if (url.pathname.includes("/.netlify/")) return false;
  if (url.pathname.endsWith(".json")) return false;

  return true;
};

async function reloadAllClients() {
  try {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    await Promise.allSettled(
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
            if (res && res.ok) {
              await cache.put(asset, res.clone());
            }
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
        try {
          await self.registration.navigationPreload.enable();
        } catch {}
      }

      await self.clients.claim();
      await reloadAllClients();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (EXTERNAL_SKIP_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;
  if (url.origin === self.location.origin && url.pathname.startsWith("/data/")) return;

  // Navegación: network-first con fallback a caché
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        try {
          const preload = await event.preloadResponse;
          if (preload) {
            if (preload.ok) {
              await cache.put(req, preload.clone());
            }
            return preload;
          }

          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            await cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          const cached =
            (await cache.match(req, { ignoreSearch: true })) ||
            (await cache.match("/index.html")) ||
            (await cache.match("/success.html")) ||
            (await cache.match("/cancel.html")) ||
            (await cache.match("/legal.html"));

          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Core assets: cache-first
  if (url.origin === self.location.origin && CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;

        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          await cache.put(req, fresh.clone());
        }
        return fresh;
      })()
    );
    return;
  }

  // JS/CSS: network-first para evitar versiones viejas
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/js/") || url.pathname.startsWith("/css/"))
  ) {
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