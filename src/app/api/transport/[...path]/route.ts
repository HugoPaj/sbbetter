import type { NextRequest } from "next/server";
import { ojpConnections, ojpEnabled, ojpLocations, ojpNearby, ojpStationboard, parseCoord } from "@/lib/server/ojp";
import { faresEnabled, ojpFares } from "@/lib/server/ojp-fare";
import type { Connection, FaresResponse, Location } from "@/lib/transport";

/**
 * Timetable proxy. Speaks transport.opendata.ch's URL + JSON format to the
 * browser, but answers from the official OJP 2.0 API (real-time, disruptions,
 * walking from coordinates) when OJP_API_KEY is configured. Any OJP failure
 * falls back to transport.opendata.ch so the demo never goes dark.
 *
 * The `X-Data-Source` response header says which upstream answered.
 *
 * /api/transport/fares?refs=a,b&hta=1 prices OJP connections (by their
 * `fareRef`) with real NOVA prices via the OJP Fare API.
 */

const OPENDATA = "https://transport.opendata.ch/v1";
const ALLOWED = new Set(["locations", "connections", "stationboard"]);

export async function GET(request: NextRequest, ctx: RouteContext<"/api/transport/[...path]">) {
  const { path } = await ctx.params;
  const endpoint = path.join("/");
  if (endpoint === "fares") return fares(request);
  if (!ALLOWED.has(endpoint)) return Response.json({ error: `Unknown endpoint: ${endpoint}` }, { status: 404 });
  const sp = request.nextUrl.searchParams;
  const signal = request.signal;

  if (ojpEnabled()) {
    try {
      const body = await fromOjp(endpoint, sp, signal);
      if (body) return json(body, "ojp");
    } catch (err) {
      if (signal.aborted) return new Response(null, { status: 499 });
      console.warn(`[transport] OJP ${endpoint} failed, falling back to opendata:`, (err as Error).message);
    }
  }

  try {
    return json(await fromOpendata(endpoint, sp, signal), "opendata");
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

async function fares(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const refs = (sp.get("refs") ?? "").split(",").filter(Boolean).slice(0, 12);
  const body: FaresResponse =
    faresEnabled() && refs.length ? await ojpFares(refs, sp.get("hta") === "1", request.signal) : { available: faresEnabled(), fares: {} };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300", "X-Data-Source": "ojp-fare" } });
}

function json(body: unknown, source: "ojp" | "opendata") {
  return Response.json(body, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
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
      const connections = await ojpConnections(
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
      return connections.length ? { connections } : null;
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
