/** Checks a browser push subscription sent by a client (/api/push, /api/push/replay). */

const isText = (v: unknown) => typeof v === "string" && v.length > 0 && v.length < 200;

/** The browsers' push services (Chrome/Edge/Android, Firefox, Safari, Windows). We POST to the endpoint, so it must not be any URL a caller likes. */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const isPushEndpoint = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.port && !u.username && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
};

export type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
export const isSubscription = (s: Sub | undefined) =>
  !!s && typeof s.endpoint === "string" && s.endpoint.length < 1000 && isPushEndpoint(s.endpoint) && isText(s.keys?.p256dh) && isText(s.keys?.auth);
