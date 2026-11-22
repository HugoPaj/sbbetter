"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Connection, FaresResponse, NovaFare } from "./transport";
import { coverageOf, partRef, type Passes } from "./passes";
import { priceConnection, quoteConnection, type Fare, type Quote } from "./pricing";

/**
 * Real NOVA prices for OJP connections, fetched in batches from
 * /api/transport/fares and cached for the session. Connections without a
 * `fareRef` (opendata fallback) or a disabled fare API resolve to "estimate".
 *
 * A fare ref prices a whole trip, or one stretch of it (partRef) when a
 * travelcard covers the rest.
 */

export type FareState = { status: "loading" } | { status: "estimate" } | { status: "nova"; fare: NovaFare };

const cache = new Map<string, NovaFare | null>();
const inflight = new Set<string>();
/** Failed lookups per key: retried a couple of times before settling for the estimate. */
const failures = new Map<string, number>();
const MAX_RETRIES = 2;
/** The server said fares are unavailable (no OJP Fare access): use estimates until then, then ask again. */
let unavailableUntil = 0;
const UNAVAILABLE_FOR = 10 * 60_000;
const available = () => Date.now() >= unavailableUntil;
let version = 0;
/** Bumped when held-back or failed refs may be asked for again: the hooks then re-request what they still show. */
let retries = 0;
const listeners = new Set<() => void>();

const keyOf = (ref: string, halfFare: boolean) => `${ref}|${halfFare ? 1 : 0}`;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function load(refs: string[], halfFare: boolean) {
  const todo = refs.filter((r) => !cache.has(keyOf(r, halfFare)) && !inflight.has(keyOf(r, halfFare)));
  if (!todo.length || !available()) return;
  todo.forEach((r) => inflight.add(keyOf(r, halfFare)));
  // A ref the server couldn't price this time is left out of its answer. Held back for the API's
  // rate limit: come back when it says (as often as it takes). Failed: try again a couple of times.
  // Retrying is left to the hooks, so prices nobody is looking at any more stop using up the quota.
  let again = false;
  let wait = 3000;
  const failed = (r: string) => {
    const k = keyOf(r, halfFare);
    const n = (failures.get(k) ?? 0) + 1;
    failures.set(k, n);
    if (n > MAX_RETRIES) cache.set(k, null);
    else again = true;
  };
  for (let i = 0; i < todo.length; i += 12) {
    const chunk = todo.slice(i, i + 12);
    try {
      const res = await fetch("/api/transport/fares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refs: chunk, hta: halfFare }),
      });
      const data = (await res.json()) as FaresResponse;
      for (const r of chunk) {
        if (r in data.fares) cache.set(keyOf(r, halfFare), data.fares[r]);
        else if (!data.available) continue; // Not cached: priced again once fares are back.
        else if (data.retryAfter) again = true;
        else failed(r);
      }
      if (!data.available) {
        unavailableUntil = Date.now() + UNAVAILABLE_FOR;
        todo.slice(i).forEach((r) => inflight.delete(keyOf(r, halfFare)));
        emit();
        setTimeout(() => {
          retries++;
          emit();
        }, UNAVAILABLE_FOR + 1000);
        return;
      }
      if (data.retryAfter) {
        // The budget is spent: asking for the remaining batches now would only be held back too.
        wait = Math.max(wait, data.retryAfter);
        again = true;
        todo.slice(i).forEach((r) => inflight.delete(keyOf(r, halfFare)));
        emit();
        break;
      }
    } catch {
      chunk.forEach(failed);
    }
    chunk.forEach((r) => inflight.delete(keyOf(r, halfFare)));
    // Prices show as each batch arrives, not when a whole day has been priced.
    emit();
  }
  if (again)
    setTimeout(() => {
      retries++;
      emit();
    }, wait);
}

/** The refs to price for a connection: the whole trip, plus each stretch a travelcard leaves uncovered. */
function refsOf(c: Connection, passes: Passes): string[] {
  if (!c.fareRef) return [];
  const coverage = coverageOf(c, passes);
  return [c.fareRef, ...(coverage.pass ? coverage.parts.map((p) => partRef(c.fareRef!, p)) : [])];
}

/** The refs a quote needs (see quoteConnection): where a travelcard covers the trip, only the stretches it leaves uncovered. */
function quoteRefsOf(c: Connection, passes: Passes): string[] {
  if (!c.fareRef) return [];
  const coverage = coverageOf(c, passes);
  return coverage.pass ? coverage.parts.map((p) => partRef(c.fareRef!, p)) : [c.fareRef];
}

const fareState = (ref: string | undefined, halfFare: boolean): FareState => {
  if (!ref) return { status: "estimate" };
  const k = keyOf(ref, halfFare);
  // While fares are unavailable, prices already found still show; the rest are estimates.
  if (!cache.has(k)) return available() ? { status: "loading" } : { status: "estimate" };
  const fare = cache.get(k);
  return fare && fare.second !== null ? { status: "nova", fare } : { status: "estimate" };
};

/**
 * Returns `quoteOf(connection)`: the 2nd class price for comparing departures,
 * with as few lookups as possible; null while loading. `connections` are
 * priced in this order, so put the ones that matter most first.
 */
export function useQuotes(connections: Connection[] | null | undefined, passes: Passes): (c: Connection) => Quote | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const retry = useSyncExternalStore(subscribe, () => retries, () => 0);
  const halfFare = passes.halfFare;
  const refsKey = (connections ?? []).flatMap((c) => quoteRefsOf(c, passes)).join(",");
  useEffect(() => {
    if (refsKey) void load(refsKey.split(","), halfFare);
  }, [refsKey, halfFare, retry]);
  return (c) => quoteConnection(c, (ref) => fareState(ref, halfFare), passes);
}

/** Returns `priceOf(connection)`: the fare with the traveller's travelcards applied; null while loading. Re-renders as prices arrive. */
export function usePrices(connections: Connection[] | null | undefined, passes: Passes): (c: Connection, opts?: { returnTrip?: boolean }) => Fare | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const retry = useSyncExternalStore(subscribe, () => retries, () => 0);
  const halfFare = passes.halfFare;
  const refsKey = (connections ?? []).flatMap((c) => refsOf(c, passes)).join(",");
  useEffect(() => {
    if (refsKey) void load(refsKey.split(","), halfFare);
  }, [refsKey, halfFare, retry]);

  return (c, opts) => priceConnection(c, (ref) => fareState(ref, halfFare), { passes, returnTrip: opts?.returnTrip });
}
