import type { JourneyQuery } from "./journey-query";
import { toConnectionsRequest } from "./journey-query";
import { queryForConnection } from "./connection-key";
import { formatMinutes, formatTime, zurichDateTime } from "./format";
import { causeLabel, findPlanB, loadLineMemory, normName, stretchName, stretchesOn, timesWord, type Closure, type Hit, type Stretch } from "./line-memory";
import { getConnections, type Connection, type Section } from "./transport";

/**
 * Turns a disruption into a verdict: one sentence telling the traveller what to
 * do, plus (when needed) the single connection we recommend instead.
 *
 * The disruption itself is SIMULATED (the live feed can't produce one on
 * demand); the recommended alternative is a real connection from the timetable.
 * A closed line is simulated on a stretch this route really runs over, with the
 * cause and the detour from that stretch's own history (see line-memory.ts).
 */

export type Scenario = "delay" | "missed" | "cancelled" | "closed";

export const SCENARIOS: { value: Scenario | ""; label: string; hint: string }[] = [
  { value: "", label: "No disruption", hint: "The journey runs as planned." },
  { value: "delay", label: "Small delay", hint: "A few minutes late, the change still works." },
  { value: "missed", label: "Missed connection", hint: "The first train is too late for the change." },
  { value: "cancelled", label: "Cancelled train", hint: "The first train does not run." },
  { value: "closed", label: "Line closed", hint: "The line ahead is interrupted, on a stretch where it has happened before." },
];

/** ok = nothing to do · changed = new plan, confirm it · act = you must move. */
export type Tone = "ok" | "changed" | "act";

/** What happens to one ride, drawn on that leg of the timeline. */
export type LegStatus = { kind: "late"; minutes: number } | { kind: "cancelled" } | { kind: "missed" } | { kind: "closed" };

export type Verdict = {
  tone: Tone;
  headline: string;
  detail: string;
  why: string;
  /** Status of the affected legs, keyed by index into `connection.sections`. */
  notes: Record<number, LegStatus>;
  /** The one connection we recommend instead, and how much later it arrives. */
  alternative?: {
    query: JourneyQuery;
    connection: Connection;
    lateMinutes: number;
    /** Set when the alternative only replaces the trip from a change station on: keep sections up to `at` (ridden `late` min late). */
    rejoin?: { at: number; late: number };
  };
  /** A closed line: what line memory needs to say what usually happens next. */
  closure?: Closure;
  /** Small print after the explanation; default "(Simulated for this demo.)". */
  note?: string;
};

const SMALL_DELAY = 4;
/** A simulated closure began this long ago: early enough that SBB's own advice is usually still to come. */
const CLOSED_FOR = 12;
const WHY_LATE = "Signal fault on the line. Trains in this area are running late.";

const lineOf = (s: Section) => [s.journey?.category, s.journey?.number].filter(Boolean).join(" ");

/** "IC 5 at 12:41 from Pl. 4" */
export function boarding(c: Connection): string {
  const s = c.sections.find((x) => x.journey);
  if (!s) return `connection at ${formatTime(c.from.departure)}`;
  const pl = s.departure.prognosis?.platform ?? s.departure.platform;
  const where = pl ? ` from ${["B", "M", "T"].includes(s.journey!.category) ? "Stop" : "Pl."} ${pl}` : "";
  return `${lineOf(s)} at ${formatTime(s.departure.departure)}${where}`;
}

const lateBy = (alt: Connection, planned: Connection) =>
  Math.max(0, Math.round(((alt.to.arrivalTimestamp ?? 0) - (planned.to.arrivalTimestamp ?? 0)) / 60));

export async function assess(conn: Connection, query: JourneyQuery, scenario: Scenario, signal?: AbortSignal): Promise<Verdict> {
  const legs = conn.sections.map((s, i) => ({ s, i })).filter((x) => x.s.journey);
  const first = legs[0];
  const next = legs[1];
  if (!first) return { tone: "ok", headline: "Your journey is on foot", detail: "No trains to worry about.", why: "", notes: {} };

  const line = lineOf(first.s);
  const plannedArrival = formatTime(conn.to.arrival);
  const arrivalPlus = (m: number) => formatTime(new Date(((conn.to.arrivalTimestamp ?? 0) + m * 60) * 1000).toISOString());

  if (scenario === "closed") return closed(conn, query, first.i, signal);

  if (scenario === "cancelled") {
    const dep = conn.from.departureTimestamp ?? 0;
    const walk = conn.accessWalk?.minutes ?? 0;
    const list = await getConnections(
      { ...toConnectionsRequest(query), ...zurichDateTime(new Date((dep - walk * 60 + 60) * 1000)), isArrivalTime: false, limit: 4 },
      signal,
    );
    const alt = list.find((c) => (c.from.departureTimestamp ?? 0) > dep);
    return {
      tone: "act",
      headline: `Your ${line} at ${formatTime(first.s.departure.departure)} is cancelled`,
      detail: alt ? `Take the ${boarding(alt)} instead.` : "We found no later connection. Please ask station staff.",
      why: "The train has a technical fault and cannot run.",
      notes: { [first.i]: { kind: "cancelled" } },
      alternative: alt && { query: queryForConnection(query, alt), connection: alt, lateMinutes: lateBy(alt, conn) },
    };
  }

  // Direct journey: a delay only moves the arrival, there is nothing to decide.
  if (!next) {
    const delay = scenario === "delay" ? SMALL_DELAY : 15;
    return {
      tone: scenario === "delay" ? "ok" : "changed",
      headline: `You'll arrive at ${arrivalPlus(delay)}, ${delay} min later`,
      detail: `${line} is running ${delay} min late. Stay on board, there is nothing to do.`,
      why: WHY_LATE,
      notes: { [first.i]: { kind: "late", minutes: delay } },
    };
  }

  const station = first.s.arrival.station;
  const stationName = station.name ?? "the next station";
  const arr = first.s.arrival.arrivalTimestamp ?? 0;
  const slack = Math.round(((next.s.departure.departureTimestamp ?? 0) - arr) / 60);

  // "Small delay" promises the change still works: on a tight change, the delay is smaller.
  if (scenario === "delay") {
    const late = Math.max(1, Math.min(SMALL_DELAY, slack - 1));
    return {
      tone: "ok",
      headline: `You'll still arrive at ${plannedArrival}`,
      detail: `${line} is running ${late} min late. Your change in ${stationName} still works${slack - late <= 1 ? ", but it will be tight" : ""}.`,
      why: WHY_LATE,
      notes: { [first.i]: { kind: "late", minutes: late } },
    };
  }

  // Missed connection: recommend the next real train onward from the change station.
  const delay = Math.max(10, slack + 8);
  const earliest = arr + delay * 60 + 120; // late arrival + 2 min to change
  const from = station.id ?? stationName;
  const onward: JourneyQuery = { ...query, from, fromName: stationName, walkMinutes: undefined, via: undefined, viaName: undefined };
  const list = await getConnections(
    { ...toConnectionsRequest(onward), ...zurichDateTime(new Date(earliest * 1000)), isArrivalTime: false, limit: 4 },
    signal,
  );
  const alt = list.find((c) => (c.from.departureTimestamp ?? 0) >= earliest);
  return {
    tone: "changed",
    headline: `You'll miss your change in ${stationName}`,
    detail: alt ? `Take the ${boarding(alt)} instead.` : "We found no later connection. Please ask station staff.",
    why: `${WHY_LATE} ${line} is ${delay} min late, and the ${lineOf(next.s)} can't wait.`,
    notes: { [first.i]: { kind: "late", minutes: delay }, [next.i]: { kind: "missed" } },
    alternative: alt && { query: queryForConnection(onward, alt), connection: alt, lateMinutes: lateBy(alt, conn), rejoin: { at: first.i, late: delay } },
  };
}

/** How many remembered stretches to try before giving up on a way round (each costs a few searches). */
const CLOSED_TRIES = 3;

/**
 * The line ahead is closed. Simulated on a stretch this route runs over, preferring a stretch
 * between two stations with a known way round (a closure "at" the destination itself has none),
 * the most disrupted first, with that stretch's usual cause. The way round is the detour staff
 * recommended there, as a real connection; else any other connection that keeps off it.
 */
async function closed(conn: Connection, query: JourneyQuery, firstRide: number, signal?: AbortSignal): Promise<Verdict> {
  const memory = await loadLineMemory();
  const rank = (h: Hit) => (h.stretch.ends.length > 1 ? 0 : 2) + (h.stretch.detours.length ? 0 : 1);
  const hits = [...stretchesOn(conn, memory)].sort((a, b) => rank(a) - rank(b) || b.stretch.n - a.stretch.n);
  const start = new Date(Date.now() - CLOSED_FOR * 60000).toISOString();
  if (!hits.length) {
    const way = await wayAround(queryForConnection(query, conn), conn, conn.sections[firstRide], signal);
    return {
      tone: "act",
      headline: "The line ahead is closed",
      detail: way
        ? `This stretch has no history of disruptions yet. Take the ${boarding(way.connection)} instead.`
        : "This stretch has no history of disruptions yet, and we found no other connection. Please ask station staff.",
      why: "Trains cannot run on a part of your route.",
      notes: { [firstRide]: { kind: "closed" } },
      alternative: way,
      closure: { stretch: null, cause: "ALL", start, simulated: true },
    };
  }
  // The first stretch that has a way round; if none does, the best-ranked one.
  let pick: Awaited<ReturnType<typeof tryStretch>> | undefined;
  for (const hit of hits.slice(0, CLOSED_TRIES)) {
    const attempt = await tryStretch(conn, query, firstRide, hit, signal);
    pick ??= attempt;
    if (attempt.planB || attempt.way) {
      pick = attempt;
      break;
    }
  }
  const { stretch, at, planB, way, rejoin } = pick!;
  const cause = stretch.causes[0]?.[0] ?? "ALL";
  const where = stretch.ends.length > 1 ? `between ${stretch.ends[0].name} and ${stretch.ends[1].name}` : `at ${stretch.ends[0].name}`;
  return {
    tone: "act",
    headline: `The line is closed ${where}`,
    detail: planB
      ? `Go via ${planB.detour.via}: take the ${boarding(planB.connection)}.`
      : way
        ? `Take the ${boarding(way.connection)} instead.`
        : noWayRound(stretch),
    why: `${causeLabel(memory, cause)}. ${stretchName(stretch)} has been disrupted ${timesWord(stretch.n)} before.`,
    notes: { [at]: { kind: "closed" } },
    alternative: planB
      ? { query: planB.query, connection: planB.connection, lateMinutes: Math.max(0, planB.extraMinutes), rejoin: rejoin ? { at: at - 1, late: 0 } : undefined }
      : way && { ...way, rejoin: rejoin ? { at: at - 1, late: 0 } : undefined },
    closure: { stretch: stretch.key, cause, start, simulated: true },
  };
}

/** No train gets round: say what usually came instead, from the stretch's own history. */
function noWayRound(stretch: Stretch): string {
  const { bus } = stretch;
  if (bus.n && bus.after !== null)
    return `No other train gets round this stretch. In ${bus.n} of ${bus.of} past closures, replacement buses came about ${formatMinutes(bus.after)} in: ask station staff where they leave from.`;
  return "We found no way round this stretch. Please ask station staff.";
}

/** The way round one closed stretch: the advised detour, else any connection that keeps off the closed leg. */
async function tryStretch(conn: Connection, query: JourneyQuery, firstRide: number, hit: Hit, signal?: AbortSignal) {
  const { stretch, section: at } = hit;
  const leg = conn.sections[at];
  // Stretches the journey only reaches after a change keep the legs before it: the way round starts at that change.
  const rejoin = at > firstRide;
  const from: JourneyQuery = rejoin
    ? { ...query, from: leg.departure.station.id ?? leg.departure.station.name ?? query.from, fromName: leg.departure.station.name ?? query.fromName, ...zurichDateTime(new Date((leg.departure.departureTimestamp ?? 0) * 1000)), isArrivalTime: false, walkMinutes: undefined, via: undefined, viaName: undefined }
    : queryForConnection(query, conn);
  const planB = await findPlanB(from, conn.to.arrivalTimestamp ?? 0, stretch, signal);
  const way = planB ? undefined : await wayAround(from, conn, leg, signal);
  return { stretch, at, rejoin, planB, way };
}

/** Local transport: a closed metro, tram or bus line doesn't stop the other lines between the same stops. */
const LOCAL = new Set(["B", "BUS", "NFB", "EV", "T", "TRAM", "NFT", "M", "BAT", "FAE", "BAV"]);

/**
 * Does this ride cover part of the closed leg? Its own line between any two of the leg's
 * stops; for a railway, any train between them (they share the track).
 */
export function ridesClosed(s: Section, closed: Section): boolean {
  if (!s.journey || !closed.journey) return false;
  const rail = !LOCAL.has(closed.journey.category.toUpperCase()) && !LOCAL.has(s.journey.category.toUpperCase());
  if (lineOf(s) !== lineOf(closed) && !rail) return false;
  const key = (c: { station: { id: string | null; name: string | null } }) => c.station.id ?? normName(c.station.name ?? "");
  const stops = new Set([closed.departure, ...closed.journey.passList, closed.arrival].map(key));
  return new Set([s.departure, ...s.journey.passList, s.arrival].map(key).filter((k) => stops.has(k))).size >= 2;
}

/**
 * No known detour: the first real connection from `from` that keeps off the closed leg,
 * on another line or on foot. Fastest arrival among the next few departures.
 */
export async function wayAround(
  from: JourneyQuery,
  conn: Connection,
  closed: Section,
  signal?: AbortSignal,
  /** Whether a ride runs over the closed part; default: it shares two stops with the closed leg. */
  blocked: (s: Section) => boolean = (s) => ridesClosed(s, closed),
): Promise<Verdict["alternative"] | undefined> {
  const q: JourneyQuery = { ...from, isArrivalTime: false };
  const list = await getConnections({ ...toConnectionsRequest(q), limit: 6 }, signal).catch((e: Error) => {
    if (e.name === "AbortError") throw e;
    return [] as Connection[];
  });
  // Not one that has left before the traveller gets there (a minute's grace, plus any walk to the first stop).
  const earliest = (closed.departure.departureTimestamp ?? 0) - 60 - (conn.accessWalk?.minutes ?? 0) * 60;
  const ok = list
    .filter((c) => (c.from.departureTimestamp ?? 0) >= earliest && !c.sections.some(blocked))
    .sort((a, b) => (a.to.arrivalTimestamp ?? 0) - (b.to.arrivalTimestamp ?? 0));
  const best = ok[0];
  return best && { query: queryForConnection(q, best), connection: best, lateMinutes: lateBy(best, conn) };
}
