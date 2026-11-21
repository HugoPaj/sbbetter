import { haversine } from "./format";
import type { Connection } from "./transport";

/**
 * MOCK fare model. There is no public SBB pricing API, so prices are estimated
 * from the straight-line distance. Roughly calibrated so that
 * EPFL → Genève-Aéroport with a Half Fare card ≈ CHF 14.20, like the real app.
 */
export type Fare = {
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
