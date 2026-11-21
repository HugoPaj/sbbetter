import { connectionKey, uniqueConnections } from "./connection-key";
import { zurichDateTime } from "./format";
import { toConnectionsRequest, type JourneyQuery } from "./journey-query";
import type { Quote } from "./pricing";
import { getConnections, type Connection } from "./transport";

/**
 * "Leave a little earlier or later and pay less": compares the connection the
 * traveller asked for with the departures around it. Prices already include
 * Supersaver tickets and travelcards, so this catches both a cheaper train and
 * a travelcard that only starts or stops being valid (Night GA at 19:00).
 */

/** "Closest to my time" never looks further than this from the requested connection (minutes). */
export const NEARBY_MINUTES = 60;
/** "Lowest price" on the day of travel: as far as the journey is long, between NEARBY_MINUTES and this. */
const SAME_DAY_MINUTES = 120;
/** "Lowest price" for a later day: you are choosing a time, not waiting on a platform. */
const PLANNED_MINUTES = 180;
/** Savings below this (CHF) aren't worth changing plans for; a suggestion must save this much per started hour it moves the departure. */
const MIN_SAVING = 1;
/** Connections asked for per timetable request when scanning a stretch of the day. */
const PAGE = 8;

/** What the traveller would rather give up when several cheaper departures exist. Persisted as the "search.cheaper" setting. */
export type CheaperPriority = "price" | "time";
export const CHEAPER_SETTING = "search.cheaper";
export const CHEAPER_PRIORITIES: { value: CheaperPriority; label: string; hint: string }[] = [
  { value: "price", label: "Lowest price", hint: "The biggest saving. Looks further from your time: up to 2 h on the day, 3 h when you plan ahead" },
  { value: "time", label: "Closest to my time", hint: "The smallest change to your journey that still saves money, within 1 h" },
];

export type Cheaper = {
  dir: "earlier" | "later";
  connection: Connection;
  fare: Quote;
  /** CHF saved in 2nd class against the requested connection. */
  saving: number;
  /** Minutes the departure moves. */
  shift: number;
};

const depOf = (c: Connection) => c.from.departureTimestamp ?? 0;
const arrOf = (c: Connection) => c.to.arrivalTimestamp ?? 0;
const zurichDay = (t: number) => zurichDateTime(new Date(t * 1000)).date;

/** Does `ref` leave on a later day than `now` (epoch seconds), Zurich time? */
export const plannedAhead = (ref: Connection, now: number) => zurichDay(depOf(ref)) > zurichDay(now);

/**
 * How far around `ref` a suggestion may be, in minutes. Waiting two hours to
 * save on a half-hour trip is silly, so on the day of travel "Lowest price"
 * looks as far as the journey is long; planned ahead it looks further.
 */
export function searchWindow(ref: Connection, prefer: CheaperPriority, now: number): number {
  if (prefer === "time") return NEARBY_MINUTES;
  if (plannedAhead(ref, now)) return PLANNED_MINUTES;
  const journey = Math.round((arrOf(ref) - depOf(ref)) / 60);
  return Math.min(SAME_DAY_MINUTES, Math.max(NEARBY_MINUTES, journey));
}

/** `c` against `ref`: how much cheaper, if both prices are known and comparable. */
function compare(ref: Connection, base: Quote, c: Connection, priceOf: (c: Connection) => Quote | null): Cheaper | null {
  const delta = depOf(c) - depOf(ref);
  const fare = priceOf(c);
  // An estimate against a real price says nothing; a trip a travelcard covers entirely is free either way.
  const covered = !!fare?.pass && !fare.pass.tickets.length;
  if (!fare || delta === 0 || (fare.source !== base.source && !covered)) return null;
  const saving = Math.round((base.secondClass - fare.secondClass) * 100) / 100;
  if (saving < MIN_SAVING) return null;
  return { dir: delta < 0 ? "earlier" : "later", connection: c, fare, saving, shift: Math.round(Math.abs(delta) / 60) };
}

/** Can the traveller still catch `c` when the earliest they can leave is `earliest` (epoch seconds)? */
const catchable = (c: Connection, earliest: number) => depOf(c) - (c.accessWalk?.minutes ?? 0) * 60 >= earliest;

/**
 * The best cheaper departure before and after `ref`, at most one each way.
 * `earliest` (epoch seconds) is when the traveller could leave at the soonest;
 * `later: false` for arrive-by searches, where leaving later means arriving too late.
 * `prefer` picks among several: the biggest saving, or the least time given up
 * (how much later you arrive, or how much earlier you have to leave).
 */
export function cheaperNearby(
  ref: Connection,
  candidates: Connection[],
  priceOf: (c: Connection) => Quote | null,
  opts: { earliest: number; later: boolean; prefer: CheaperPriority },
): Cheaper[] {
  const base = priceOf(ref);
  if (!base) return [];
  const refKey = connectionKey(ref);
  const window = searchWindow(ref, opts.prefer, opts.earliest) * 60;
  const best: Partial<Record<Cheaper["dir"], Cheaper & { lost: number }>> = {};
  for (const c of candidates) {
    if (connectionKey(c) === refKey) continue;
    const delta = depOf(c) - depOf(ref);
    if (Math.abs(delta) > window) continue;
    if (delta > 0 && !opts.later) continue;
    // Leaving earlier only helps if it is still catchable and doesn't arrive later.
    if (delta < 0 && (!catchable(c, opts.earliest) || arrOf(c) > arrOf(ref))) continue;
    const found = compare(ref, base, c, priceOf);
    // Moving a departure by hours for one franc is no suggestion.
    if (!found || found.saving < MIN_SAVING * Math.ceil(found.shift / 60)) continue;
    const lost = found.dir === "later" ? arrOf(c) - arrOf(ref) : -delta;
    const cur = best[found.dir];
    const better =
      !cur || (opts.prefer === "price" ? found.saving > cur.saving || (found.saving === cur.saving && lost < cur.lost) : lost < cur.lost || (lost === cur.lost && found.saving > cur.saving));
    if (better) best[found.dir] = { ...found, lost };
  }
  return [best.earlier, best.later].filter((x) => !!x);
}

/**
 * Every departure on the day of `ref` that is cheaper than it, in order of
 * departure: the whole-day view, where the traveller decides what is too far.
 * `pending` counts departures whose price is still loading.
 */
export function cheaperThatDay(ref: Connection, candidates: Connection[], priceOf: (c: Connection) => Quote | null, earliest: number): { items: Cheaper[]; pending: number; lowest: number | null } {
  const base = priceOf(ref);
  const day = zurichDay(depOf(ref));
  const refKey = connectionKey(ref);
  const items: Cheaper[] = [];
  let pending = 0;
  for (const c of uniqueConnections(candidates)) {
    if (connectionKey(c) === refKey || zurichDay(depOf(c)) !== day || !catchable(c, earliest)) continue;
    if (!base || !priceOf(c)) pending++;
    const found = base && compare(ref, base, c, priceOf);
    if (found) items.push(found);
  }
  items.sort((a, b) => depOf(a.connection) - depOf(b.connection));
  return { items, pending, lowest: items.length ? Math.min(...items.map((i) => i.fare.secondClass)) : null };
}

/** Epoch seconds of a Zurich wall-clock date ("2026-11-21") and time ("18:50"). */
function zurichEpoch(date: string, time: string): number | null {
  const guess = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(guess)) return null;
  const shown = zurichDateTime(new Date(guess));
  const offset = Date.parse(`${shown.date}T${shown.time}:00Z`) - guess;
  return (guess - offset) / 1000;
}

/**
 * Departures between two moments (epoch seconds), a page at a time: each
 * timetable request continues after the last departure of the one before.
 * `onFound` gets every page as it arrives. Failures just end the scan.
 */
async function scan(q: JourneyQuery, from: number, to: number, pages: number, onFound: (found: Connection[]) => void, signal?: AbortSignal, pause = 0): Promise<void> {
  const req = { ...toConnectionsRequest(q), isArrivalTime: false };
  for (let t = from, i = 0; i < pages && t < to && !signal?.aborted; i++) {
    // The timetable API is rate limited too (50 requests a minute): a long scan takes its time.
    if (i && pause) await new Promise((resolve) => setTimeout(resolve, pause));
    const list = await getConnections({ ...req, ...zurichDateTime(new Date(t * 1000)), limit: PAGE }, signal).catch(() => [] as Connection[]);
    if (signal?.aborted || !list.length) return;
    onFound(uniqueConnections(list).filter((c) => depOf(c) >= from && depOf(c) <= to));
    const last = Math.max(...list.map(depOf));
    if (last < t) return; // no progress
    t = last + 60;
  }
}

/**
 * Departures around `ref` that the result list doesn't show, as far as "Lowest
 * price" may look (see searchWindow): before the list, when that isn't already
 * in the past, and after it if it stops short of the window. Leaving later is
 * no use for an arrive-by search. `onFound` is called as pages arrive.
 */
export async function fetchNearby(q: JourneyQuery, ref: Connection, shown: Connection[], now: number, onFound: (found: Connection[]) => void, signal?: AbortSignal): Promise<void> {
  const window = searchWindow(ref, "price", now) * 60;
  const seen = new Set(shown.map(connectionKey));
  const fresh = (found: Connection[]) => {
    const list = found.filter((c) => !seen.has(connectionKey(c)));
    list.forEach((c) => seen.add(connectionKey(c)));
    if (list.length) onFound(list);
  };
  const first = depOf(shown[0] ?? ref);
  const last = depOf(shown.at(-1) ?? ref);
  const jobs: Promise<void>[] = [];
  // Earlier: up to the first listed departure, or up to the requested time when the list starts there.
  const start = Math.max(now, depOf(ref) - window);
  const end = q.isArrivalTime ? first : Math.min(first, zurichEpoch(q.date, q.time) ?? now);
  if (end - start > 5 * 60) jobs.push(scan(q, start, end - 60, 4, fresh, signal));
  if (!q.isArrivalTime && last < depOf(ref) + window) jobs.push(scan(q, last + 60, depOf(ref) + window, 4, fresh, signal));
  await Promise.all(jobs);
}

/** Every departure from now until the end of the day `ref` leaves on (Zurich time). On request only: a busy route takes some twenty timetable requests. */
export async function fetchDay(q: JourneyQuery, ref: Connection, now: number, onFound: (found: Connection[]) => void, signal?: AbortSignal): Promise<void> {
  const day = zurichDay(depOf(ref));
  const from = Math.max(now, zurichEpoch(day, "00:00") ?? now);
  const to = (zurichEpoch(day, "23:59") ?? depOf(ref)) + 59;
  await scan(q, from, to, 24, onFound, signal, 400);
}
