import type { Checkpoint, Connection } from "./transport";
import type { LocalPass } from "./travelcards";

/**
 * Travelcards and what they cover on a given connection.
 *
 * The Half Fare Travelcard is a discount (NOVA applies it). GA-style cards make
 * stretches of a trip free, so pricing a connection means: find the stretches
 * the card does not cover, and buy tickets for those only.
 *
 * Night GA rules (sbb.ch → Help with the Night GA Travelcard):
 *  - valid 19:00–05:00, until 07:00 on Saturday and Sunday mornings, 2nd class;
 *  - validity follows the SCHEDULED departure: on a train leaving before 19:00
 *    you need a ticket as far as its first stop after 19:00;
 *  - in the morning it is valid up to the last stop reached before 05:00/07:00.
 * Public holidays (also 07:00) and night supplements are not modelled.
 *
 * Zone and area passes (src/lib/travelcards.ts, from NOVA tariff data) are valid
 * at any time on the edges between stops they cover. Beyond them you need a
 * ticket from the last stop the vehicle calls at inside, which is exactly a
 * stop-to-stop rule.
 */
export type Passes = {
  halfFare: boolean;
  /** Name of a card valid everywhere, all day ("GA", "Swiss Travel Pass"); null without one. */
  ga: string | null;
  nightGa: boolean;
  /** Zone and area passes. */
  local: LocalPass[];
};

/** "Night GA", "Night GA and Mobilis pass". */
const joined = (names: string[]) => names.join(" and ");

type Spot = { lat: number; lon: number };
/** The zone/area pass valid at this spot, if any. */
const localAt = (passes: Passes, at: Spot | null | undefined) => (at ? passes.local.find((p) => p.containsSpot(at.lat, at.lon)) : undefined);

/** A stop of a connection: `leg` counts the rides (sections with a journey), `stop` indexes that ride's passList. */
export type StopRef = { leg: number; stop: number };

/** A stretch that needs a ticket. */
export type PaidPart = { from: Checkpoint; to: Checkpoint; a: StopRef; b: StopRef };

export type Coverage = {
  /** Travelcard(s) covering at least one stretch, e.g. "Night GA and Mobilis pass"; null when the whole trip needs a ticket. */
  pass: string | null;
  /** `pass` names more than one card. */
  several: boolean;
  /** Stretches to buy tickets for (empty: nothing to buy in 2nd class). */
  parts: PaidPart[];
};

/** Handle to price one stretch of a trip via /api/transport/fares (see ojp-fare.ts). */
export const partRef = (fareRef: string, p: PaidPart) => `${fareRef}~${p.a.leg}.${p.a.stop}-${p.b.leg}.${p.b.stop}`;

const zurich = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Zurich wall clock at a moment (seconds since epoch). */
function zurichClock(timestamp: number): { minutes: number; weekend: boolean } {
  const parts = Object.fromEntries(zurich.formatToParts(new Date(timestamp * 1000)).map((p) => [p.type, p.value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), weekend: parts.weekday === "Sat" || parts.weekday === "Sun" };
}

/** Is the Night GA valid at this moment (seconds since epoch), Zurich time? */
export function inNightGaWindow(timestamp: number): boolean {
  const { minutes, weekend } = zurichClock(timestamp);
  return minutes >= 19 * 60 || minutes < (weekend ? 7 : 5) * 60;
}

/**
 * The travelcard that makes a ticket pointless for travel between two moments
 * (epoch ms), if any. Used wherever something is sold without a timetable:
 * EasyRide, short-distance tickets. `local` is where a ticket for the local
 * zones would be used; leave it out for travel that may go anywhere.
 */
export function passCovering(passes: Passes, startMs: number, endMs: number, local?: Spot | null): string | null {
  if (passes.ga) return passes.ga;
  const zone = localAt(passes, local);
  if (zone) return zone.name;
  if (passes.nightGa && endMs - startMs < 10 * 3600_000 && inNightGaWindow(startMs / 1000) && inNightGaWindow(endMs / 1000)) return "Night GA";
  return null;
}

/** The same for a pass bought now and valid until the end of service: covered once the evening window has opened. */
export function passCoveringRestOfDay(passes: Passes, nowMs: number, local?: Spot | null): string | null {
  if (passes.ga) return passes.ga;
  const zone = localAt(passes, local);
  if (zone) return zone.name;
  return passes.nightGa && zurichClock(nowMs / 1000).minutes >= 19 * 60 ? "Night GA" : null;
}

/**
 * What a journey without a timetable (EasyRide) still has to pay for: the
 * minutes between two moments (epoch ms) that no travelcard covers, and the
 * card(s) covering the rest. A journey that starts and ends inside the zones
 * of a zone pass is covered whatever the time.
 */
export function uncovered(passes: Passes, startMs: number, endMs: number, ends?: { from: Spot | null; to: Spot | null }): { minutes: number; pass: string | null } {
  const total = Math.max(1, Math.round((endMs - startMs) / 60_000));
  if (passes.ga) return { minutes: 0, pass: passes.ga };
  const zone = ends && localAt(passes, ends.from);
  if (zone && ends.to && zone.containsSpot(ends.to.lat, ends.to.lon)) return { minutes: 0, pass: zone.name };
  if (!passes.nightGa) return { minutes: total, pass: null };
  let n = 0;
  for (let i = 0; i < total; i++) if (!inNightGaWindow((startMs + i * 60_000) / 1000)) n++;
  return { minutes: n, pass: n < total ? "Night GA" : null };
}

type Hop = { from: Checkpoint; to: Checkpoint; a: StopRef; b: StopRef; dep: number | null; arr: number | null };

/** Every stop-to-stop hop of the rides, in travel order (walks need no ticket). */
function hopsOf(c: Connection): Hop[] {
  const hops: Hop[] = [];
  let leg = -1;
  for (const s of c.sections) {
    if (!s.journey) continue;
    leg++;
    const stops = s.journey.passList.length >= 2 ? s.journey.passList : [s.departure, s.arrival];
    for (let i = 0; i + 1 < stops.length; i++) {
      hops.push({
        from: stops[i],
        to: stops[i + 1],
        a: { leg, stop: i },
        b: { leg, stop: i + 1 },
        dep: stops[i].departureTimestamp ?? stops[i].arrivalTimestamp,
        arr: stops[i + 1].arrivalTimestamp ?? stops[i + 1].departureTimestamp,
      });
    }
  }
  return hops;
}

/** Scheduled departure inside the window, and the next stop still reached inside the same night. */
const nightGaCovers = (h: Hop) => h.dep !== null && h.arr !== null && h.arr - h.dep < 10 * 3600 && inNightGaWindow(h.dep) && inNightGaWindow(h.arr);

const cache = new WeakMap<Passes, WeakMap<Connection, Coverage>>();

/** Which stretches of this connection still need a ticket with these travelcards. */
export function coverageOf(c: Connection, passes: Passes): Coverage {
  let perPass = cache.get(passes);
  if (!perPass) cache.set(passes, (perPass = new WeakMap()));
  let coverage = perPass.get(c);
  if (!coverage) perPass.set(c, (coverage = compute(c, passes)));
  return coverage;
}

function compute(c: Connection, passes: Passes): Coverage {
  if (passes.ga) return { pass: passes.ga, several: false, parts: [] };
  const hops = hopsOf(c);
  const night = hops.map((h) => passes.nightGa && nightGaCovers(h));
  // The first zone/area pass valid on each hop.
  const zone = hops.map((h) => passes.local.find((p) => p.covers(h.from, h.to)));
  const covered = hops.map((_, i) => night[i] || !!zone[i]);
  // Name only the cards the traveller needs here: just one of them if it covers everything the other does.
  const nightNeeded = night.some((n, i) => n && !zone[i]);
  const zoneNames = [...new Set(zone.filter((z, i) => z && (!night[i] || !nightNeeded)).map((z) => z!.name))];
  const names: string[] = [];
  if (nightNeeded) names.push("Night GA");
  names.push(...zoneNames);
  // Consecutive uncovered hops form one ticket, also across a change of trains.
  const parts: PaidPart[] = [];
  hops.forEach((h, i) => {
    if (covered[i]) return;
    const open = i > 0 && !covered[i - 1] ? parts.at(-1) : undefined;
    if (open) {
      open.to = h.to;
      open.b = h.b;
    } else {
      parts.push({ from: h.from, to: h.to, a: h.a, b: h.b });
    }
  });
  return { pass: names.length ? joined(names) : null, several: names.length > 1, parts };
}

/**
 * The connection cut down to the stretch between two stops (as in a `PaidPart`):
 * what a ticket for that stretch alone is bought for. Walks between the kept rides stay.
 */
export function cutConnection(c: Connection, a: StopRef, b: StopRef): Connection {
  const sections: Connection["sections"] = [];
  let leg = -1;
  for (const s of c.sections) {
    if (s.journey) leg++;
    // Walks belong between rides: keep those after the first kept ride and before the last.
    if (!s.journey ? leg < a.leg || leg >= b.leg : leg < a.leg || leg > b.leg) continue;
    if (!s.journey || (leg !== a.leg && leg !== b.leg)) {
      sections.push(s);
      continue;
    }
    const all = s.journey.passList.length >= 2 ? s.journey.passList : [s.departure, s.arrival];
    const lo = leg === a.leg ? a.stop : 0;
    const hi = leg === b.leg ? b.stop : all.length - 1;
    const stops = all.slice(lo, hi + 1);
    sections.push({ ...s, track: undefined, departure: stops[0], arrival: stops.at(-1)!, journey: { ...s.journey, passList: stops } });
  }
  const rides = sections.filter((s) => s.journey);
  const from = rides[0]?.departure ?? c.from;
  const to = rides.at(-1)?.arrival ?? c.to;
  return {
    ...c,
    from,
    to,
    sections,
    transfers: Math.max(0, rides.length - 1),
    products: rides.map((s) => [s.journey!.category, s.journey!.number].filter(Boolean).join(" ")),
    accessWalk: undefined,
    fareRef: undefined,
  };
}
