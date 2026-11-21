"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Connection, FaresResponse, NovaFare } from "./transport";

/**
 * Real NOVA prices for OJP connections, fetched in batches from
 * /api/transport/fares and cached for the session. Connections without a
 * `fareRef` (opendata fallback) or a disabled fare API resolve to "estimate".
 */

export type FareState = { status: "loading" } | { status: "estimate" } | { status: "nova"; fare: NovaFare };

const cache = new Map<string, NovaFare | null>();
const inflight = new Set<string>();
let available = true;
let version = 0;
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
  if (!todo.length || !available) return;
  todo.forEach((r) => inflight.add(keyOf(r, halfFare)));
  try {
    for (let i = 0; i < todo.length; i += 12) {
      const chunk = todo.slice(i, i + 12);
      try {
        const res = await fetch(`/api/transport/fares?refs=${chunk.map(encodeURIComponent).join(",")}&hta=${halfFare ? 1 : 0}`);
        const data = (await res.json()) as FaresResponse;
        if (!data.available) available = false;
        for (const r of chunk) cache.set(keyOf(r, halfFare), data.fares[r] ?? null);
      } catch {
        for (const r of chunk) cache.set(keyOf(r, halfFare), null);
      }
    }
  } finally {
    todo.forEach((r) => inflight.delete(keyOf(r, halfFare)));
    emit();
  }
}

/** Returns a lookup `fareOf(connection)` that re-renders as prices arrive. */
export function useNovaFares(connections: Connection[] | null | undefined, halfFare: boolean): (c: Connection) => FareState {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const refsKey = (connections ?? [])
    .map((c) => c.fareRef)
    .filter(Boolean)
    .join(",");
  useEffect(() => {
    if (refsKey) void load(refsKey.split(","), halfFare);
  }, [refsKey, halfFare]);

  return (c) => {
    if (!c.fareRef || !available) return { status: "estimate" };
    const k = keyOf(c.fareRef, halfFare);
    if (!cache.has(k)) return { status: "loading" };
    const fare = cache.get(k);
    return fare && fare.second !== null ? { status: "nova", fare } : { status: "estimate" };
  };
}
