import { TRANSPORT_FILTERS, type ConnectionsRequest, type TransportFilter } from "./transport";

/**
 * The journey search lives in the URL so every screen (connections, detail,
 * offers) is reload-safe and shareable.
 *
 *   /connections?from=8501214&fromName=...&to=...&date=2026-11-21&time=12:20&arr=1&tr=bus,ir&walk=9
 */
export type JourneyQuery = {
  from: string; // station id or name understood by the API
  fromName: string; // label shown in the UI
  to: string;
  toName: string;
  date: string;
  time: string;
  isArrivalTime: boolean;
  transportations: TransportFilter[]; // empty = all
  walkMinutes?: number; // walk from "current location" to the first stop
  via?: string; // optional intermediate stop (Advanced search → Via)
  viaName?: string;
};

export function journeyToSearchParams(q: JourneyQuery): URLSearchParams {
  const sp = new URLSearchParams({
    from: q.from,
    fromName: q.fromName,
    to: q.to,
    toName: q.toName,
    date: q.date,
    time: q.time,
  });
  if (q.isArrivalTime) sp.set("arr", "1");
  if (q.transportations.length) sp.set("tr", q.transportations.join(","));
  if (q.walkMinutes) sp.set("walk", String(q.walkMinutes));
  if (q.via) {
    sp.set("via", q.via);
    sp.set("viaName", q.viaName ?? q.via);
  }
  return sp;
}

export function journeyHref(path: string, q: JourneyQuery, extra?: Record<string, string>): string {
  const sp = journeyToSearchParams(q);
  if (extra) for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  return `${path}?${sp}`;
}

export function journeyFromSearchParams(sp: URLSearchParams): JourneyQuery | null {
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to) return null;
  const tr = (sp.get("tr") ?? "")
    .split(",")
    .filter((t): t is TransportFilter => (TRANSPORT_FILTERS as readonly string[]).includes(t));
  return {
    from,
    fromName: sp.get("fromName") ?? from,
    to,
    toName: sp.get("toName") ?? to,
    date: sp.get("date") ?? "",
    time: sp.get("time") ?? "",
    isArrivalTime: sp.get("arr") === "1",
    transportations: tr,
    walkMinutes: sp.get("walk") ? Number(sp.get("walk")) : undefined,
    via: sp.get("via") ?? undefined,
    viaName: sp.get("viaName") ?? sp.get("via") ?? undefined,
  };
}

export function toConnectionsRequest(q: JourneyQuery): ConnectionsRequest {
  return {
    from: q.from,
    to: q.to,
    via: q.via,
    date: q.date || undefined,
    time: q.time || undefined,
    isArrivalTime: q.isArrivalTime,
    transportations: q.transportations.length ? q.transportations : undefined,
  };
}
