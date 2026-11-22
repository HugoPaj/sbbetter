import type { JourneyQuery } from "./journey-query";
import { toConnectionsRequest } from "./journey-query";
import { queryForConnection } from "./connection-key";
import { formatTime, zurichDateTime } from "./format";
import { causeLabel, findPlanB, loadLineMemory, stretchName, stretchesOn, timesWord, type Closure } from "./line-memory";
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
};

const SMALL_DELAY = 4;
/** A simulated closure began this long ago: early enough that SBB's own advice is usually still to come. */
const CLOSED_FOR = 12;
const WHY_LATE = "Signal fault on the line. Trains in this area are running late.";

const lineOf = (s: Section) => [s.journey?.category, s.journey?.number].filter(Boolean).join(" ");

/** "IC 5 at 12:41 from Pl. 4" */
function boarding(c: Connection): string {
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

/**
 * The line ahead is closed. Simulated on the most disrupted stretch this route runs
 * over that has a known way round (else the most disrupted one), with that stretch's
 * usual cause. The way round is the detour staff recommended there, as a real connection.
 */
async function closed(conn: Connection, query: JourneyQuery, firstRide: number, signal?: AbortSignal): Promise<Verdict> {
  const memory = await loadLineMemory();
  const hits = stretchesOn(conn, memory);
  const hit = hits.find((h) => h.stretch.detours.length) ?? hits[0];
  const start = new Date(Date.now() - CLOSED_FOR * 60000).toISOString();
  if (!hit) {
    return {
      tone: "act",
      headline: "The line ahead is closed",
      detail: "This stretch has no history of disruptions yet, so there is no known way round. Please check other connections.",
      why: "Trains cannot run on a part of your route.",
      notes: { [firstRide]: { kind: "closed" } },
      closure: { stretch: null, cause: "ALL", start, simulated: true },
    };
  }
  const { stretch, section: at } = hit;
  const cause = stretch.causes[0]?.[0] ?? "ALL";
  const leg = conn.sections[at];
  // Stretches the journey only reaches after a change keep the legs before it: the way round starts at that change.
  const rejoin = at > firstRide;
  const from: JourneyQuery = rejoin
    ? { ...query, from: leg.departure.station.id ?? leg.departure.station.name ?? query.from, fromName: leg.departure.station.name ?? query.fromName, ...zurichDateTime(new Date((leg.departure.departureTimestamp ?? 0) * 1000)), isArrivalTime: false, walkMinutes: undefined, via: undefined, viaName: undefined }
    : queryForConnection(query, conn);
  const planB = await findPlanB(from, conn.to.arrivalTimestamp ?? 0, stretch, signal);
  const where = stretch.ends.length > 1 ? `between ${stretch.ends[0].name} and ${stretch.ends[1].name}` : `at ${stretch.ends[0].name}`;
  return {
    tone: "act",
    headline: `The line is closed ${where}`,
    detail: planB ? `Go via ${planB.detour.via}: take the ${boarding(planB.connection)}.` : "No way round is known for this stretch. Please check other connections.",
    why: `${causeLabel(memory, cause)}. ${stretchName(stretch)} has been disrupted ${timesWord(stretch.n)} before.`,
    notes: { [at]: { kind: "closed" } },
    alternative: planB ? { query: planB.query, connection: planB.connection, lateMinutes: Math.max(0, planB.extraMinutes), rejoin: rejoin ? { at: at - 1, late: 0 } : undefined } : undefined,
    closure: { stretch: stretch.key, cause, start, simulated: true },
  };
}
