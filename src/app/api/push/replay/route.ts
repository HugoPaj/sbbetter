import type { NextRequest } from "next/server";
import { GoneError, pushEnabled, pushTo } from "@/lib/server/commute-alerts";

/**
 * POST {endpoint, title, body, url, tag}: send a replay update (src/components/replay.tsx) to this
 * device as a real push notification. Only to a device already subscribed (commute alerts on),
 * so it can't be used to push to anyone else; the text is the caller's own, for their own phone.
 */

const last = new Map<string, number>();
const EVERY_MS = 1_000;

const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
/** A path in this app, never another site. */
const appPath = (v: unknown) => typeof v === "string" && v.length < 2000 && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\");

export async function POST(request: NextRequest) {
  if (!pushEnabled()) return Response.json({ error: "Push is not configured on this server." }, { status: 503 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !text(b.endpoint, 1000) || !text(b.title, 200) || !text(b.body, 500) || !appPath(b.url) || !text(b.tag, 100))
    return Response.json({ error: "Expected an endpoint, title, body, url and tag." }, { status: 400 });
  const endpoint = b.endpoint as string;
  const now = Date.now();
  if (now - (last.get(endpoint) ?? 0) < EVERY_MS) return Response.json({ error: "Too fast." }, { status: 429 });
  if (last.size >= 1000) last.clear();
  last.set(endpoint, now);
  try {
    const sent = await pushTo(endpoint, { title: b.title as string, body: b.body as string, url: b.url as string, tag: b.tag as string });
    return sent ? Response.json({ ok: true }) : Response.json({ error: "This device isn't subscribed." }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof GoneError ? 410 : 502 });
  }
}
