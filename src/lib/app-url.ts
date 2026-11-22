/**
 * The app's own endpoints and public files (/api/transport/…, /line-memory.json),
 * as a URL fetch() accepts. In the browser a path is enough. Server code that
 * reuses the same modules (commute alerts) sets the app's origin first, since
 * fetch() on the server needs an absolute URL.
 */
let origin = "";

export function setAppOrigin(o: string) {
  origin = o.replace(/\/$/, "");
}

export const appUrl = (path: string) => (typeof window === "undefined" ? `${origin}${path}` : path);
