import type { JourneyQuery } from "./journey-query";
import { toConnectionsRequest } from "./journey-query";
import { getConnections, type Connection } from "./transport";
import { zurichDateTime } from "./format";

/**
 * Stable id for a connection so detail/offers screens can re-fetch it. Departure
 * and lines alone aren't unique: the same trains can be combined with another
 * change station or a later last leg, so the boarding stops and arrival count too.
 */
export function connectionKey(c: Connection): string {
  const legs = c.sections.filter((s) => s.journey).map((s) => `${s.journey!.category} ${s.journey!.number}@${s.departure.station.id ?? s.departure.station.name ?? ""}`.trim());
  return `${c.from.departureTimestamp}-${c.to.arrivalTimestamp}-${legs.join("+")}`;
}

/** Drop connections that are the same itinerary as an earlier one (the API occasionally repeats a trip). */
export function uniqueConnections(list: Connection[]): Connection[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = connectionKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Query anchored at this connection's departure (so a re-fetch returns it first). */
export function queryForConnection(q: JourneyQuery, c: Connection): JourneyQuery {
  // With a coordinate origin the search time is when you start walking, not when you board.
  const walk = c.accessWalk?.minutes ?? 0;
  const { date, time } = zurichDateTime(new Date(((c.from.departureTimestamp ?? 0) - walk * 60) * 1000));
  return { ...q, date, time, isArrivalTime: false };
}

export async function fetchConnection(q: JourneyQuery, key: string | null, signal?: AbortSignal, opts: { track?: boolean } = {}): Promise<Connection | null> {
  const list = await getConnections({ ...toConnectionsRequest(q), limit: 4, track: opts.track }, signal);
  return list.find((c) => connectionKey(c) === key) ?? list[0] ?? null;
}

/**
 * A re-routed trip: keep the planned connection up to and including section `at`,
 * then continue with the connection `key` searched from `from` at `date` `time`.
 * Lives in the URL (r* params) so reloads, saved trips and sharing keep it.
 */
export type Reroute = { from: string; date: string; time: string; key: string; at: number; late: number };

export function rerouteParams(r: Reroute): Record<string, string> {
  return { rfrom: r.from, rdate: r.date, rtime: r.time, rkey: r.key, rat: String(r.at), rlate: String(r.late) };
}

export function rerouteFromSearchParams(sp: URLSearchParams): Reroute | null {
  const from = sp.get("rfrom");
  const key = sp.get("rkey");
  const date = sp.get("rdate");
  const time = sp.get("rtime");
  if (!from || !key || !date || !time) return null;
  return { from, key, date, time, at: Number(sp.get("rat") ?? 0), late: Number(sp.get("rlate") ?? 0) };
}

function apiDuration(min: number): string {
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return `${String(d).padStart(2, "0")}d${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** The planned legs up to the change station, followed by the new onward legs. */
export function stitch(planned: Connection, onward: Connection, at: number): Connection {
  const sections = [...planned.sections.slice(0, at + 1), ...onward.sections];
  const rides = sections.filter((s) => s.journey);
  const minutes = Math.round(((onward.to.arrivalTimestamp ?? 0) - (planned.from.departureTimestamp ?? 0)) / 60);
  return {
    ...planned,
    to: onward.to,
    sections,
    duration: apiDuration(Math.max(0, minutes)),
    transfers: Math.max(0, rides.length - 1),
    products: rides.map((s) => [s.journey!.category, s.journey!.number].filter(Boolean).join(" ")),
    capacity1st: null,
    capacity2nd: null,
    disruptions: [...(planned.disruptions ?? []), ...(onward.disruptions ?? [])],
    fareRef: undefined,
  };
}

/** Fetch the connection a detail URL describes, re-routed if it carries r* params. */
export async function loadConnection(q: JourneyQuery, sp: URLSearchParams, signal?: AbortSignal, opts: { track?: boolean } = {}): Promise<Connection | null> {
  const key = sp.get("key");
  const r = rerouteFromSearchParams(sp);
  if (!r) return fetchConnection(q, key, signal, opts);
  const onwardQuery: JourneyQuery = { ...q, from: r.from, fromName: r.from, date: r.date, time: r.time, isArrivalTime: false, walkMinutes: undefined, via: undefined, viaName: undefined };
  const [planned, onward] = await Promise.all([fetchConnection(q, key, signal, opts), fetchConnection(onwardQuery, r.key, signal, opts)]);
  if (!planned || !onward) return planned;
  return stitch(planned, onward, r.at);
}
