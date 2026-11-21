"use client";

import { useEffect, useState } from "react";
import { DEFAULT_POSITION } from "./mock-data";
import { zurichDateTime } from "./format";
import type { JourneyQuery } from "./journey-query";

/**
 * `settled`: a fix arrived, failed, or took too long; until then `real: false` only means "not yet".
 * `accuracy`: the fix's radius of uncertainty in metres (0 when not real).
 */
export type Position = { lat: number; lon: number; real: boolean; settled: boolean; accuracy: number };

/** Give up waiting for a first fix (e.g. an unanswered permission prompt) after this long and use the fallback. */
const SETTLE_AFTER = 6000;

/**
 * Browser geolocation with an EPFL fallback (handy for demos). A quick, possibly cached fix comes
 * first so the page can settle fast; a high-accuracy one then refines it.
 */
export function usePosition(): Position {
  const [pos, setPos] = useState<Position>({ ...DEFAULT_POSITION, real: false, settled: false, accuracy: 0 });
  useEffect(() => {
    const settle = () => setPos((p) => (p.settled ? p : { ...p, settled: true }));
    if (!("geolocation" in navigator)) return settle();
    let live = true;
    const timer = setTimeout(settle, SETTLE_AFTER);
    const take = (g: GeolocationPosition) =>
      live &&
      setPos((p) =>
        // Never trade a sharper fix for a vaguer one (the quick fix can land after the precise one).
        p.real && p.accuracy < g.coords.accuracy ? p : { lat: g.coords.latitude, lon: g.coords.longitude, real: true, settled: true, accuracy: g.coords.accuracy },
      );
    // Denied: settle now instead of after the timer.
    navigator.permissions?.query({ name: "geolocation" }).then((s) => s.state === "denied" && live && settle(), () => {});
    navigator.geolocation.getCurrentPosition(take, () => {}, { enableHighAccuracy: false, timeout: SETTLE_AFTER, maximumAge: 10 * 60_000 });
    navigator.geolocation.getCurrentPosition(take, () => live && settle(), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
    return () => {
      live = false;
      clearTimeout(timer);
    };
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
