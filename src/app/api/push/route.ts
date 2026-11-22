import { connection, type NextRequest } from "next/server";
import type { Commute } from "@/lib/store";
import { pushEnabled } from "@/lib/server/commute-alerts";
import { pushStore } from "@/lib/server/push-store";

/**
 * Commute alert subscriptions.
 * GET: the VAPID public key the browser subscribes with (null: push not configured).
 * POST {subscription, commute}: start or update alerts for this browser.
 * DELETE {endpoint}: stop them.
 */

const MAX_SUBSCRIPTIONS = 1000;

export async function GET() {
  // At request time: a prerendered answer would freeze the key (or its absence) at build time.
  await connection();
  return Response.json({ publicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null }, { headers: { "Cache-Control": "no-store" } });
}

const isTime = (v: unknown) => typeof v === "string" && /^\d\d:\d\d$/.test(v);
const isText = (v: unknown) => typeof v === "string" && v.length > 0 && v.length < 200;

function commuteOf(v: unknown): Commute | null {
  const c = v as Commute;
  return c && isText(c.from) && isText(c.to) && isText(c.fromName) && isText(c.toName) && isTime(c.outTime) && isTime(c.backTime)
    ? { from: c.from, fromName: c.fromName, to: c.to, toName: c.toName, outTime: c.outTime, backTime: c.backTime }
    : null;
}

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

type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
const isSubscription = (s: Sub | undefined) =>
  !!s && typeof s.endpoint === "string" && s.endpoint.length < 1000 && isPushEndpoint(s.endpoint) && isText(s.keys?.p256dh) && isText(s.keys?.auth);

export async function POST(request: NextRequest) {
  if (!pushEnabled()) return Response.json({ error: "Push is not configured on this server." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { subscription?: Sub; commute?: unknown } | null;
  const commute = commuteOf(body?.commute);
  if (!isSubscription(body?.subscription) || !commute) return Response.json({ error: "Expected a push subscription and a commute." }, { status: 400 });
  const s = body!.subscription!;
  const subscription = { endpoint: s.endpoint as string, keys: { p256dh: s.keys!.p256dh as string, auth: s.keys!.auth as string } };
  const store = pushStore();
  const old = await store.get(subscription.endpoint);
  if (!old && (await store.all()).length >= MAX_SUBSCRIPTIONS) return Response.json({ error: "Too many subscriptions." }, { status: 503 });
  // A changed commute starts afresh: what was sent was about the old one.
  const same = old && JSON.stringify(old.commute) === JSON.stringify(commute);
  await store.put({ subscription, commute, sent: same ? old.sent : {}, updated: new Date().toISOString() });
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return Response.json({ error: "Expected an endpoint." }, { status: 400 });
  await pushStore().remove(body.endpoint);
  return Response.json({ ok: true });
}
