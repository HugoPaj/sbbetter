/*
 * Service worker for the installed app (registered in production only, see
 * src/components/service-worker.tsx). Makes the home-screen app open instantly
 * and show the last-seen page offline. Live data (/api/*) is never cached.
 *
 * Tickets work offline from the first launch, in a tunnel or abroad without
 * data: the Tickets page and everything it loads are saved as one snapshot
 * when the worker installs, and refreshed while online. Its data (tickets,
 * travelcards) lives on the phone already (localStorage).
 */
const VERSION = "v4";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const DATA = `data-${VERSION}`;
/** Pages that must open offline even if never visited, with their scripts, styles and fonts. Never trimmed. */
const OFFLINE = `offline-${VERSION}`;
const OFFLINE_PAGES = ["/tickets"];
/** Data those pages fetch themselves (travelcard names). */
const OFFLINE_DATA = ["/passes/index.json"];
/** Refresh the snapshot at most this often (it changes only with a new build). */
const SNAPSHOT_MAX_AGE = 6 * 3600e3;
const SNAPSHOT_META = "/__offline-snapshot";
/** Most entries kept per cache; the oldest go first. Old build chunks and visited pages pile up otherwise. */
const MAX_STATIC = 250;
const MAX_PAGES = 25;
/** A page with a saved copy waits this long for the network before showing the copy (weak signal, "lie-fi"). */
const SLOW_MS = 3500;

/** Store a response, then drop the oldest entries beyond `max` (keys() lists them oldest first). */
async function keep(name, req, res, max) {
  const c = await caches.open(name);
  await c.delete(req); // re-adding moves it to the end: recently used stays
  await c.put(req, res);
  const keys = await c.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => c.delete(k)));
}

/** Build files a page loads: scripts, styles, fonts (all hashed under /_next/static/). */
const assetsOf = (html) => [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? [])];

/**
 * Save the offline pages and everything they need as one snapshot. All of it is fetched
 * first and stored only if every part arrived, so a half-saved page never replaces a working one.
 * `known` passes a page response the caller already has.
 */
async function saveSnapshot(known) {
  const entries = [];
  for (const path of OFFLINE_PAGES) {
    const res = known?.path === path ? known.res : await fetch(path, { credentials: "same-origin" });
    if (!res.ok) return;
    const html = await res.clone().text();
    entries.push([path, res]);
    const assets = await Promise.all(assetsOf(html).map((u) => caches.match(u).then((hit) => hit || fetch(u))));
    if (assets.some((r) => !r.ok)) return;
    assetsOf(html).forEach((u, i) => entries.push([u, assets[i].clone()]));
  }
  for (const path of OFFLINE_DATA) {
    const res = await fetch(path);
    if (!res.ok) return;
    entries.push([path, res]);
  }
  const c = await caches.open(OFFLINE);
  await Promise.all((await c.keys()).map((k) => c.delete(k)));
  await Promise.all(entries.map(([u, r]) => c.put(u, r)));
  await c.put(SNAPSHOT_META, new Response(String(Date.now())));
}

async function snapshotIsOld() {
  const meta = await caches.match(SNAPSHOT_META, { cacheName: OFFLINE });
  return !meta || Date.now() - Number(await meta.text()) > SNAPSHOT_MAX_AGE;
}

/** The saved copy of a page: the last one seen, else the offline snapshot. */
const savedPage = (url) =>
  caches
    .match(url.href, { cacheName: PAGES, ignoreVary: true })
    .then((hit) => hit || (OFFLINE_PAGES.includes(url.pathname) ? caches.match(url.pathname, { cacheName: OFFLINE, ignoreVary: true, ignoreSearch: true }) : undefined));

const offlineMessage = () =>
  new Response("<!doctype html><meta name=viewport content=\"width=device-width\"><title>Offline</title><p style=\"font:16px system-ui;padding:24px\">You're offline. Connect to the internet and try again.</p>", {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

/** Resolves to "slow" after `ms`, or to what the network said first. */
const raceNetwork = (net, ms) =>
  Promise.race([net.then((res) => ({ res }), (err) => ({ err })), new Promise((r) => setTimeout(() => r("slow"), ms))]);

self.addEventListener("install", (event) => {
  // Tickets must open offline from the very first launch, not only once visited.
  event.waitUntil(saveSnapshot().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES, DATA, OFFLINE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Hashed build files and fonts: never change under the same URL. Also found in the offline snapshot.
  if (/^\/(_next\/static|__nextjs_font)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) event.waitUntil(keep(STATIC, req, res.clone(), MAX_STATIC));
            return res;
          }),
      ),
    );
    return;
  }

  // Data and icons that keep their URL but can be regenerated (delay model, travelcard zones):
  // answer from the cache right away, and refresh it in the background for next time.
  if (/^\/(icons|passes)\//.test(url.pathname) || url.pathname === "/delay-model.json") {
    event.respondWith(
      caches.open(DATA).then((c) =>
        c.match(req).then(async (hit) => {
          const fresh = fetch(req).then((res) => (res.ok && c.put(req, res.clone()), res));
          hit ??= await caches.match(req, { cacheName: OFFLINE });
          if (!hit) return fresh;
          event.waitUntil(fresh.catch(() => {}));
          return hit;
        }),
      ),
    );
    return;
  }

  // In-app navigation fetches the next page's data (RSC), not the page. Offline, Next would wait for
  // the connection to come back; answering with an error instead makes it load the page itself,
  // which the branch below serves from its saved copy. Only for pages that have one.
  if (req.headers.get("RSC") === "1" && !req.headers.has("Next-Router-Prefetch")) {
    event.respondWith(
      (async () => {
        const net = fetch(req);
        const first = await raceNetwork(net, SLOW_MS);
        if (first !== "slow" && first.res) return first.res;
        const page = new URL(url);
        page.searchParams.delete("_rsc");
        if (await savedPage(page)) return new Response("", { status: 503 });
        return net; // nothing saved: let Next wait for the connection as usual
      })(),
    );
    return;
  }

  // Pages: the network first; offline (or too slow), the saved copy; else the planner or a message.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const net = fetch(req);
        event.waitUntil(
          net
            .then(async (res) => {
              if (!res.ok) return;
              // Both copies now, before the page starts reading the response (a read body can't be cloned).
              const forPages = res.clone();
              const forSnapshot = OFFLINE_PAGES.includes(url.pathname) && !url.search ? res.clone() : null;
              await keep(PAGES, req, forPages, MAX_PAGES);
              // Online: keep the offline snapshot current (a new build changes its scripts).
              if (forSnapshot) await saveSnapshot({ path: url.pathname, res: forSnapshot });
              else if (await snapshotIsOld()) await saveSnapshot();
            })
            .catch(() => {}),
        );
        const first = await raceNetwork(net, SLOW_MS);
        if (first !== "slow" && first.res) return first.res;
        const saved = await savedPage(url);
        if (saved) return saved;
        if (first === "slow") return net.catch(() => caches.match("/plan", { cacheName: PAGES }).then((hit) => hit || offlineMessage()));
        return (await caches.match("/plan", { cacheName: PAGES })) || offlineMessage();
      })(),
    );
  }
});

// Commute alerts (src/lib/server/commute-alerts.ts): show them, and open their connection when tapped.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "SBB Travelers", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // A newer alert about the same thing replaces the old one, and still buzzes.
      tag: data.tag || "commute",
      renotify: true,
      data: { url: data.url || "/plan" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/plan", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Reuse the open app rather than a second window.
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      // navigate() fails for a window this worker doesn't control yet: open one then.
      return win
        ? win
            .focus()
            .then((w) => (w ?? win).navigate(url))
            .catch(() => self.clients.openWindow(url))
        : self.clients.openWindow(url);
    }),
  );
});
