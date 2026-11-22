import type { NextRequest } from "next/server";
import { ojpConnections, ojpEnabled, ojpLocations, ojpNearby, ojpStationboard, parseCoord } from "@/lib/server/ojp";
import { faresEnabled, ojpFares } from "@/lib/server/ojp-fare";
import { TTL, cacheKey, shared } from "@/lib/server/upstream-cache";
import type { Connection, FaresResponse, Location } from "@/lib/transport";

/**
 * Timetable proxy. Speaks transport.opendata.ch's URL + JSON format to the
 * browser, but answers from the official OJP 2.0 API (real-time, disruptions,
 * walking from coordinates) when OJP_API_KEY is configured. Any OJP failure
 * falls back to transport.opendata.ch so the demo never goes dark.
 *
 * The `X-Data-Source` response header says which upstream answered.
 *
 * Identical requests share one upstream call and its answer for a few seconds
 * (src/lib/server/upstream-cache.ts), to stay under OJP's rate limit.
 *
 * POST /api/transport/fares {refs, hta} prices OJP connections (by their
 * `fareRef`) with real NOVA prices via the OJP Fare API. It is a POST because
 * a ref carries its whole trip (see ojp-fare.ts), too long for a URL.
 */

const OPENDATA = "https://transport.opendata.ch/v1";
const ALLOWED = new Set(["locations", "connections", "stationboard"]);

export async function GET(request: NextRequest, ctx: RouteContext<"/api/transport/[...path]">) {
  const { path } = await ctx.params;
  const endpoint = path.join("/");
  if (endpoint === "fares") return Response.json({ error: "Use POST" }, { status: 405, headers: { Allow: "POST" } });
  if (!ALLOWED.has(endpoint)) return Response.json({ error: `Unknown endpoint: ${endpoint}` }, { status: 404 });
  const sp = request.nextUrl.searchParams;
  const signal = request.signal;

  if (ojpEnabled()) {
    try {
      const body = await shared(cacheKey("ojp", endpoint, sp), TTL[endpoint], (s) => fromOjp(endpoint, sp, s), signal);
      if (body) return json(body, "ojp", endpoint);
    } catch (err) {
      if (signal.aborted) return new Response(null, { status: 499 });
      console.warn(`[transport] OJP ${endpoint} failed, falling back to opendata:`, (err as Error).message);
    }
  }

  try {
    return json(await shared(cacheKey("opendata", endpoint, sp), TTL[endpoint], (s) => fromOpendata(endpoint, sp, s), signal), "opendata", endpoint);
  } catch (err) {
    if (signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/transport/[...path]">) {
  const { path } = await ctx.params;
  if (path.join("/") !== "fares") return Response.json({ error: "Not found" }, { status: 404 });
  const input = (await request.json().catch(() => null)) as { refs?: unknown; hta?: unknown } | null;
  const refs = (Array.isArray(input?.refs) ? input.refs : []).filter((r): r is string => typeof r === "string" && r.length > 0).slice(0, 12);
  const body: FaresResponse =
    faresEnabled() && refs.length ? await ojpFares(refs, input?.hta === true, request.signal) : { available: faresEnabled(), fares: {} };
  return Response.json(body, { headers: { "Cache-Control": "no-store", "X-Data-Source": "ojp-fare" } });
}

/** How long the browser reuses an answer without asking: stop names barely change, departures do. */
const BROWSER_CACHE: Record<string, string> = {
  locations: "public, max-age=600, stale-while-revalidate=3600",
};

function json(body: unknown, source: "ojp" | "opendata", endpoint: string) {
  return Response.json(body, {
    headers: {
      "Cache-Control": BROWSER_CACHE[endpoint] ?? "public, max-age=30, stale-while-revalidate=60",
      "X-Data-Source": source,
    },
  });
}

/** Returns null when the request uses a feature we only support via opendata. */
async function fromOjp(endpoint: string, sp: URLSearchParams, signal: AbortSignal): Promise<unknown | null> {
  switch (endpoint) {
    case "locations": {
      const x = sp.get("x");
      const y = sp.get("y");
      if (x && y) return { stations: await ojpNearby(Number(x), Number(y), signal) };
      const query = sp.get("query");
      return query ? { stations: await ojpLocations(query, signal) } : null;
    }
    case "connections": {
      const from = sp.get("from");
      const to = sp.get("to");
      // Product filters / paging aren't mapped to OJP yet.
      if (!from || !to || sp.has("page") || sp.has("transportations[]")) return null;
      const found = await ojpConnections(
        {
          from,
          to,
          via: sp.get("via") ?? undefined,
          date: sp.get("date") ?? undefined,
          time: sp.get("time") ?? undefined,
          isArrivalTime: sp.get("isArrivalTime") === "1",
          limit: Number(sp.get("limit") ?? 6),
          track: sp.get("track") === "1",
        },
        signal,
      );
      // A walk is an answer too: no point asking the other timetable for trains.
      return found.connections.length || found.walk ? found : null;
    }
    case "stationboard": {
      const id = sp.get("id") ?? sp.get("station");
      if (!id) return null;
      const type = sp.get("type") === "arrival" ? "arrival" : "departure";
      return ojpStationboard(id, { limit: Number(sp.get("limit") ?? 15), type }, signal);
    }
  }
  return null;
}

async function opendata<T>(endpoint: string, sp: URLSearchParams, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${OPENDATA}/${endpoint}?${sp}`, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`opendata ${endpoint}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * transport.opendata.ch can't route from a coordinate, so snap "coord:lat,lon"
 * to the nearest stop and report the walk as `accessWalk` (same shape as OJP).
 */
async function fromOpendata(endpoint: string, sp: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  if (endpoint !== "connections") return opendata(endpoint, sp, signal);

  const params = new URLSearchParams(sp);
  params.delete("track"); // no geometry upstream: the map falls back to straight lines between stops
  let walk: Connection["accessWalk"];
  for (const key of ["from", "to"] as const) {
    const c = parseCoord(params.get(key) ?? "");
    if (!c) continue;
    const near = await opendata<{ stations: Location[] }>("locations", new URLSearchParams({ x: String(c.lat), y: String(c.lon), type: "station" }), signal);
    const stop = near.stations.find((s) => s.id);
    if (!stop) throw new Error("No stop near the given position");
    params.set(key, stop.id!);
    if (key === "from") {
      const metres = stop.distance ?? 0;
      walk = { minutes: Math.max(1, Math.round((metres * 1.3) / 80)), metres };
    }
  }
  const data = await opendata<{ connections: Connection[] }>("connections", params, signal);
  if (walk) data.connections = data.connections.map((c) => ({ ...c, accessWalk: walk }));
  return data;
}
