const CACHE_VERSION = "v16";
const CACHE_NAME = `spx-gauge-${CACHE_VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  if (url.origin !== self.location.origin) return;

  const isNetworkFirst =
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/manifest.webmanifest");

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("./index.html");
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            cache.put("./index.html", fresh.clone());
          }
          return fresh;
        } catch {
          return cached || new Response("Offline", { status: 200 });
        }
      })(),
    );
    return;
  }

  if (isNetworkFirst) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await cache.match(req);
          return cached || new Response("Offline", { status: 200 });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res.ok) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);
      return cached || (await fetchPromise) || new Response("Offline", { status: 200 });
    })(),
  );
});
