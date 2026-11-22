/*
 * Service worker for the installed app (registered in production only, see
 * src/components/service-worker.tsx). Makes the home-screen app open instantly
 * and show the last-seen page offline. Live data (/api/*) is never cached.
 */
const VERSION = "v3";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const DATA = `data-${VERSION}`;
/** Most entries kept per cache; the oldest go first. Old build chunks and visited pages pile up otherwise. */
const MAX_STATIC = 250;
const MAX_PAGES = 25;

/** Store a response, then drop the oldest entries beyond `max` (keys() lists them oldest first). */
async function keep(name, req, res, max) {
  const c = await caches.open(name);
  await c.delete(req); // re-adding moves it to the end: recently used stays
  await c.put(req, res);
  const keys = await c.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => c.delete(k)));
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Hashed build files and fonts: never change under the same URL.
  if (/^\/(_next\/static|__nextjs_font)\//.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) event.waitUntil(keep(STATIC, req, res.clone(), MAX_STATIC));
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Data and icons that keep their URL but can be regenerated (delay model, travelcard zones):
  // answer from the cache right away, and refresh it in the background for next time.
  if (/^\/(icons|passes)\//.test(url.pathname) || url.pathname === "/delay-model.json") {
    event.respondWith(
      caches.open(DATA).then((c) =>
        c.match(req).then((hit) => {
          const fresh = fetch(req).then((res) => (res.ok && c.put(req, res.clone()), res));
          if (!hit) return fresh;
          event.waitUntil(fresh.catch(() => {}));
          return hit;
        }),
      ),
    );
    return;
  }

  // Pages: always try the network first; offline, fall back to the last copy (or the planner).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) event.waitUntil(keep(PAGES, req, res.clone(), MAX_PAGES));
          return res;
        })
        .catch(() =>
          caches
            .open(PAGES)
            .then((c) => c.match(req).then((hit) => hit || c.match("/plan")))
            // Never seen offline: a plain message instead of the browser's network error.
            .then((hit) => hit || new Response("<!doctype html><meta name=viewport content=\"width=device-width\"><title>Offline</title><p style=\"font:16px system-ui;padding:24px\">You're offline. Connect to the internet and try again.</p>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })),
        ),
    );
  }
});
