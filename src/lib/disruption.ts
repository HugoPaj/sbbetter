import type { JourneyQuery } from "./journey-query";
import { toConnectionsRequest } from "./journey-query";
import { queryForConnection } from "./connection-key";
import { formatTime, zurichDateTime } from "./format";
import { getConnections, type Connection, type Section } from "./transport";

/**
 * Turns a disruption into a verdict: one sentence telling the traveller what to
 * do, plus (when needed) the single connection we recommend instead.
 *
 * The disruption itself is SIMULATED (the live feed can't produce one on
 * demand); the recommended alternative is a real connection from the timetable.
 */

export type Scenario = "delay" | "missed" | "cancelled";

export const SCENARIOS: { value: Scenario | ""; label: string; hint: string }[] = [
  { value: "", label: "No disruption", hint: "The journey runs as planned." },
  { value: "delay", label: "Small delay", hint: "A few minutes late, the change still works." },
  { value: "missed", label: "Missed connection", hint: "The first train is too late for the change." },
  { value: "cancelled", label: "Cancelled train", hint: "The first train does not run." },
];

/** ok = nothing to do · changed = new plan, confirm it · act = you must move. */
export type Tone = "ok" | "changed" | "act";

export type Verdict = {
  tone: Tone;
  headline: string;
  detail: string;
  why: string;
  /** Notes shown on the affected legs, keyed by index into `connection.sections`. */
  notes: Record<number, string>;
  /** The one connection we recommend instead, and how much later it arrives. */
  alternative?: { query: JourneyQuery; connection: Connection; lateMinutes: number };
};

const SMALL_DELAY = 4;
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
      notes: { [first.i]: "Cancelled" },
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
      notes: { [first.i]: `+${delay}' late` },
    };
  }

  const station = first.s.arrival.station;
  const stationName = station.name ?? "the next station";
  const arr = first.s.arrival.arrivalTimestamp ?? 0;
  const slack = Math.round(((next.s.departure.departureTimestamp ?? 0) - arr) / 60);

  if (scenario === "delay" && slack > SMALL_DELAY) {
    return {
      tone: "ok",
      headline: `You'll still arrive at ${plannedArrival}`,
      detail: `${line} is running ${SMALL_DELAY} min late. Your change in ${stationName} still works.`,
      why: WHY_LATE,
      notes: { [first.i]: `+${SMALL_DELAY}' late` },
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
    notes: { [first.i]: `+${delay}' late`, [next.i]: "You'll miss this" },
    alternative: alt && { query: queryForConnection(onward, alt), connection: alt, lateMinutes: lateBy(alt, conn) },
  };
}
