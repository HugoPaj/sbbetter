/*
 * Service worker for the installed app (registered in production only, see
 * src/components/service-worker.tsx). Makes the home-screen app open instantly
 * and show the last-seen page offline. Live data (/api/*) is never cached.
 */
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Hashed build files, icons, fonts, the delay model: never change under the same URL.
  if (/^\/(_next\/static|icons|__nextjs_font)\//.test(url.pathname) || url.pathname === "/delay-model.json") {
    event.respondWith(
      caches.open(STATIC).then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => (res.ok && c.put(req, res.clone()), res))),
      ),
    );
    return;
  }

  // Pages: always try the network first; offline, fall back to the last copy (or the planner).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(PAGES).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.open(PAGES).then((c) => c.match(req).then((hit) => hit || c.match("/plan")))),
    );
  }
});
