import type { JourneyQuery } from "./journey-query";
import { toConnectionsRequest } from "./journey-query";
import { getConnections, type Connection } from "./transport";
import { zurichDateTime } from "./format";

/** Stable id for a connection so detail/offers screens can re-fetch it. */
export function connectionKey(c: Connection): string {
  return `${c.from.departureTimestamp}-${c.products.join("+")}`;
}

/** Query anchored at this connection's departure (so a re-fetch returns it first). */
export function queryForConnection(q: JourneyQuery, c: Connection): JourneyQuery {
  // With a coordinate origin the search time is when you start walking, not when you board.
  const walk = c.accessWalk?.minutes ?? 0;
  const { date, time } = zurichDateTime(new Date(((c.from.departureTimestamp ?? 0) - walk * 60) * 1000));
  return { ...q, date, time, isArrivalTime: false };
}

export async function fetchConnection(q: JourneyQuery, key: string | null, signal?: AbortSignal): Promise<Connection | null> {
  const list = await getConnections({ ...toConnectionsRequest(q), limit: 4 }, signal);
  return list.find((c) => connectionKey(c) === key) ?? list[0] ?? null;
}
