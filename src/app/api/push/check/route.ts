import type { NextRequest } from "next/server";
import { runChecks, selfOrigin } from "@/lib/server/commute-alerts";

/**
 * The commute check, for a cron every 5 minutes on serverless hosting (a
 * self-hosted server runs it itself, see src/instrumentation.ts). Needs
 * `Authorization: Bearer $CRON_SECRET`, which is what Vercel Cron sends.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const allowed = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.NODE_ENV !== "production";
  if (!allowed) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runChecks(selfOrigin(request.nextUrl.origin)), { headers: { "Cache-Control": "no-store" } });
}
