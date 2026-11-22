import type { NextRequest } from "next/server";
import { GoneError, checkNow, pushEnabled, selfOrigin } from "@/lib/server/commute-alerts";

/** POST {endpoint}: check this browser's next commute now and send the result, on time included ("Check now"). */

const last = new Map<string, number>();
const EVERY_MS = 15_000;

export async function POST(request: NextRequest) {
  if (!pushEnabled()) return Response.json({ error: "Push is not configured on this server." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return Response.json({ error: "Expected an endpoint." }, { status: 400 });
  const now = Date.now();
  if (now - (last.get(body.endpoint) ?? 0) < EVERY_MS) return Response.json({ error: "Checked a moment ago." }, { status: 429 });
  // Forget old entries: the endpoint is whatever the caller sent.
  if (last.size >= 1000) for (const [k, at] of last) if (now - at >= EVERY_MS || last.size >= 1000) last.delete(k);
  last.set(body.endpoint, now);
  try {
    const alert = await checkNow(selfOrigin(request.nextUrl.origin), body.endpoint);
    if (!alert) return Response.json({ error: "No commute alerts for this device, or no train found." }, { status: 404 });
    return Response.json({ sent: alert.kind });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof GoneError ? 410 : 502 });
  }
}
