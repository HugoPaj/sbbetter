/**
 * Builders for timetable objects in tests: a connection described as rides
 * (and walks) with stops and Zurich wall-clock times, nothing else to fill in.
 */
import type { Checkpoint, Connection, Section } from "@/lib/transport";

/** Seconds since epoch for a Zurich wall-clock time, "2026-11-23T18:40" (winter, +01:00) or with an explicit offset. */
export const zurich = (local: string) => Date.parse(/[+-]\d\d:\d\d$|Z$/.test(local) ? local : `${local}:00+01:00`) / 1000;

/** A stop: [id, name, "HH:MM" or full local time]. Times are on 2026-11-23 (a Monday) unless given in full. */
export type StopSpec = [id: string, name: string, time: string];

const at = (time: string) => zurich(time.length <= 5 ? `2026-11-23T${time}` : time);

export function checkpoint([id, name, time]: StopSpec): Checkpoint {
  const t = at(time);
  const iso = new Date(t * 1000).toISOString();
  return {
    station: { id, name, score: null, coordinate: { type: "WGS84", x: null, y: null }, distance: null },
    arrival: iso,
    arrivalTimestamp: t,
    departure: iso,
    departureTimestamp: t,
    delay: 0,
    platform: null,
    prognosis: null,
  };
}

export type RideSpec = { line: string; stops: StopSpec[]; track?: [number, number][] };
export type WalkSpec = { walk: [StopSpec, StopSpec] };

export function ride({ line, stops, track }: RideSpec): Section {
  const [category, number = ""] = line.split(" ");
  const passList = stops.map(checkpoint);
  return {
    journey: { name: line, category, subcategory: null, categoryCode: null, number, operator: "SBB", to: stops.at(-1)![1], passList, capacity1st: null, capacity2nd: null },
    walk: null,
    departure: passList[0],
    arrival: passList.at(-1)!,
    track,
  };
}

export function connection(parts: (RideSpec | WalkSpec)[], extra: Partial<Connection> = {}): Connection {
  const sections = parts.map((p): Section => {
    if ("walk" in p) {
      const [a, b] = p.walk.map(checkpoint);
      return { journey: null, walk: { duration: ((b.arrivalTimestamp ?? 0) - (a.departureTimestamp ?? 0)) || 60 }, departure: a, arrival: b };
    }
    return ride(p);
  });
  const rides = sections.filter((s) => s.journey);
  return {
    from: sections[0].departure,
    to: sections.at(-1)!.arrival,
    duration: "00d00:00:00",
    transfers: Math.max(0, rides.length - 1),
    products: rides.map((s) => `${s.journey!.category} ${s.journey!.number}`),
    capacity1st: null,
    capacity2nd: null,
    sections,
    ...extra,
  };
}
