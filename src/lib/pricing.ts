import { haversine } from "./format";
import type { Connection, NovaFare } from "./transport";
import type { FareState } from "./fares";

/**
 * Ticket prices. Real NOVA prices (via OJP Fare, see src/lib/fares.ts) when
 * available; otherwise a MOCK estimate from the straight-line distance, roughly
 * calibrated so that EPFL → Genève-Aéroport with a Half Fare card ≈ CHF 14.20.
 */
export type Fare = {
  source: "nova" | "estimate";
  /** Product NOVA priced, e.g. "Supersaver Ticket" (real fares only). */
  secondName?: string | null;
  firstName?: string | null;
  secondClass: number;
  firstClass: number;
  supersaverUpgrade: number;
  pointToPointUpgrade: number;
  cityAddOn: number;
};

const roundUp20 = (v: number) => Math.ceil(v * 5) / 5;

export function estimateFare(connection: Connection, opts: { halfFare: boolean; returnTrip?: boolean }): Fare {
  const a = connection.from.station.coordinate;
  const b = connection.to.station.coordinate;
  const km = a.x && a.y && b.x && b.y ? (haversine(a.x, a.y, b.x, b.y) / 1000) * 1.2 : 10;

  let full = Math.max(4.4, 3.6 + km * 0.39);
  if (opts.returnTrip) full *= 2;
  const factor = opts.halfFare ? 0.5 : 1;

  const second = roundUp20(full * factor);
  const first = roundUp20(full * 1.75 * factor);
  return {
    source: "estimate",
    secondClass: second,
    firstClass: first,
    supersaverUpgrade: roundUp20((first - second) * 0.6),
    pointToPointUpgrade: roundUp20(first - second),
    cityAddOn: opts.halfFare ? 1.8 : 3.6,
  };
}

/** City name for the "City <x>" add-on, e.g. "Genève-Aéroport" → "Genève". */
export function cityOf(stationName: string): string {
  return stationName.split(/[,\s-]/)[0] ?? stationName;
}

/**
 * Fare for a connection: NOVA's cheapest ticket (often a Supersaver) when we
 * have it, else the estimate. Upgrades and the City add-on stay modelled.
 * Returns null while the real price is still loading.
 */
export function priceConnection(connection: Connection, state: FareState, opts: { halfFare: boolean; returnTrip?: boolean }): Fare | null {
  if (state.status === "loading") return null;
  if (state.status === "estimate") return estimateFare(connection, opts);
  return fromNova(state.fare, estimateFare(connection, opts), opts);
}

function fromNova(n: NovaFare, est: Fare, opts: { halfFare: boolean; returnTrip?: boolean }): Fare {
  const mult = opts.returnTrip ? 2 : 1;
  const second = n.second! * mult;
  // NOVA sometimes prices only 2nd class; keep the usual 1st/2nd ratio then.
  const first = n.first !== null ? n.first * mult : roundUp20(second * 1.75);
  const diff = Math.max(0, first - second);
  return {
    source: "nova",
    secondName: n.secondName,
    firstName: n.firstName,
    secondClass: round2(second),
    firstClass: round2(first),
    supersaverUpgrade: roundUp20(diff * 0.6),
    pointToPointUpgrade: round2(diff),
    cityAddOn: est.cityAddOn,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
