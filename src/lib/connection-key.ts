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
