"use client";

import { useEffect, useState } from "react";
import { DEFAULT_POSITION } from "./mock-data";
import { zurichDateTime } from "./format";
import type { JourneyQuery } from "./journey-query";

export type Position = { lat: number; lon: number; real: boolean };

/** Browser geolocation with an EPFL fallback (handy for demos). */
export function usePosition(): Position {
  const [pos, setPos] = useState<Position>({ ...DEFAULT_POSITION, real: false });
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude, real: true }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);
  return pos;
}

export const CURRENT_LOCATION = "__current__";

export type Endpoint = { id: string; name: string } | { id: typeof CURRENT_LOCATION; name: "Current location" };

/**
 * Build a JourneyQuery. The current location is sent as "coord:lat,lon": the
 * timetable proxy routes from the exact position (OJP adds the walk to the
 * first stop) or, without OJP, snaps it to the nearest stop.
 */
export async function buildJourney(from: Endpoint, to: Endpoint, pos: Position, when?: { date: string; time: string; arrival?: boolean }): Promise<JourneyQuery> {
  const id = (e: Endpoint) => (e.id === CURRENT_LOCATION ? `coord:${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}` : e.id);
  const now = zurichDateTime();
  return {
    from: id(from),
    fromName: from.name,
    to: id(to),
    toName: to.name,
    date: when?.date ?? now.date,
    time: when?.time ?? now.time,
    isArrivalTime: when?.arrival ?? false,
    transportations: [],
  };
}
