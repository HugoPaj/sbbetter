"use client";

import { useEffect, useState } from "react";
import { actions, useAppState } from "./store";
import type { Passes } from "./passes";
import type { Checkpoint } from "./transport";

/**
 * The traveller's travelcards, picked in Profile → Travelcards.
 *
 * National cards follow rules (src/lib/passes.ts). Zone and area passes come
 * from NOVA tariff data (opentransportdata.swiss, built by scripts/build-passes.py
 * into public/passes/): the edges each covers, so a stretch is covered when the
 * pass is valid on the edge between its two stops.
 */

export const NATIONAL = [
  { id: "halfFare", name: "Half Fare Travelcard" },
  { id: "ga2", name: "GA Travelcard, 2nd class" },
  { id: "ga1", name: "GA Travelcard, 1st class" },
  { id: "nightGa", name: "Night GA Travelcard" },
  { id: "sts", name: "Swiss Travel Pass" },
  { id: "interrail", name: "Interrail / Eurail Pass" },
] as const;
export type NationalId = (typeof NATIONAL)[number]["id"];

/** Valid on every line, all day (the GA family). */
const ANYWHERE: NationalId[] = ["ga1", "ga2", "sts", "interrail"];

export type TravelcardSelection = {
  national: NationalId[];
  /** Zone passes: a network's subscription plan and the zones bought. */
  zones: { id: string; zones: string[] }[];
  /** Area passes (a fixed network, e.g. Berner Oberland Pass). */
  areas: string[];
};

export type ZonePassMeta = { id: string; network: string; label: string; zones: { id: string; name: string }[] };
export type Catalog = { zonePasses: ZonePassMeta[]; areaPasses: { id: string; name: string }[] };

type PassFile = { edges: Record<string, string[]> | string[]; stopZone?: Record<string, string>; coords: Record<string, [number, number]> };

/** Fetch JSON, failing on HTTP errors (a 404 page isn't data). */
const getJson = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });

// Cached once loaded; a failure (offline on a train) is forgotten so the next use tries again.
let catalog: Promise<Catalog> | null = null;
export const loadCatalog = (): Promise<Catalog> =>
  (catalog ??= getJson<Catalog>("/passes/index.json").catch((e) => {
    catalog = null;
    throw e;
  }));
const files = new Map<string, Promise<PassFile>>();
const loadFile = (id: string) => {
  if (!files.has(id))
    files.set(
      id,
      getJson<PassFile>(`/passes/${id}.json`).catch((e) => {
        files.delete(id);
        throw e;
      }),
    );
  return files.get(id)!;
};

/** A zone or area pass, as pricing uses it. */
export type LocalPass = {
  /** Short name used in sentences, e.g. "Mobilis travelcard". */
  name: string;
  /** Is it valid between these two consecutive stops? */
  covers: (a: Checkpoint, b: Checkpoint) => boolean;
  /** Is this spot (latitude, longitude) inside its area (nearest stop within 600 m)? */
  containsSpot: (lat: number, lon: number) => boolean;
};

const edgeKey = (a: string, b: string) => (Number(a) < Number(b) ? `${a}-${b}` : `${b}-${a}`);

function nearestStop(coords: PassFile["coords"], lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestD = (0.6 / 111) ** 2; // ~600 m, in degrees²
  const k = Math.cos((lat * Math.PI) / 180) ** 2;
  for (const id in coords) {
    const [y, x] = coords[id];
    const d = (y - lat) ** 2 + (x - lon) ** 2 * k;
    if (d < bestD) [best, bestD] = [id, d];
  }
  return best;
}

function zonePass(meta: ZonePassMeta, zones: string[], file: PassFile): LocalPass {
  const bought = new Set(zones);
  const edges = file.edges as Record<string, string[]>;
  const inZones = (id: string | null) => !!id && bought.has(file.stopZone?.[id] ?? "");
  return {
    name: `${meta.network} travelcard`,
    covers(a, b) {
      const [x, y] = [a.station.id, b.station.id];
      if (!x || !y) return false;
      const edge = edges[edgeKey(x, y)];
      // An edge runs through zones; trains skipping stops have no edge: judge by the stops' own zones.
      return edge ? edge.every((z) => bought.has(z)) : inZones(x) && inZones(y);
    },
    containsSpot: (lat, lon) => inZones(nearestStop(file.coords, lat, lon)),
  };
}

function areaPass(name: string, file: PassFile): LocalPass {
  const edges = new Set(file.edges as string[]);
  return {
    name,
    covers: (a, b) => !!a.station.id && !!b.station.id && edges.has(edgeKey(a.station.id, b.station.id)),
    containsSpot: (lat, lon) => nearestStop(file.coords, lat, lon) !== null,
  };
}

const zoneList = (zones: string[]) => zones.join(" + ");

/** Display names, e.g. "Mobilis travelcard, zones 11 + 12". */
export function travelcardNames(sel: TravelcardSelection, cat: Catalog | null): string[] {
  return [
    ...NATIONAL.filter((n) => sel.national.includes(n.id)).map((n) => n.name),
    ...sel.zones.map((z) => {
      const meta = cat?.zonePasses.find((p) => p.id === z.id);
      return `${meta?.network ?? "Zone"} travelcard, ${z.zones.length === 1 ? "zone" : "zones"} ${zoneList(z.zones)}`;
    }),
    ...sel.areas.map((id) => cat?.areaPasses.find((p) => p.id === id)?.name ?? id),
  ];
}

const keyOf = (sel: TravelcardSelection) => JSON.stringify(sel);
const built = new Map<string, Passes>();

/** National rules only; zone/area passes are added once their data has loaded. */
function nationalPasses(sel: TravelcardSelection, local: LocalPass[] = []): Passes {
  const anywhere = NATIONAL.find((n) => ANYWHERE.includes(n.id) && sel.national.includes(n.id));
  return { halfFare: sel.national.includes("halfFare"), ga: anywhere ? anywhere.name.replace(/,.*$/, "").replace(" Travelcard", "") : null, nightGa: sel.national.includes("nightGa"), local };
}

/** The pass object for a selection, with zone/area data loaded (cached per selection). */
export async function buildPasses(sel: TravelcardSelection): Promise<Passes> {
  const key = keyOf(sel);
  if (built.has(key)) return built.get(key)!;
  const cat = await loadCatalog();
  const local = await Promise.all([
    ...sel.zones.map(async (z) => {
      const meta = cat.zonePasses.find((p) => p.id === z.id);
      return meta ? zonePass(meta, z.zones, await loadFile(z.id)) : null;
    }),
    ...sel.areas.map(async (id) => {
      const meta = cat.areaPasses.find((p) => p.id === id);
      return meta ? areaPass(meta.name, await loadFile(id)) : null;
    }),
  ]);
  const passes = nationalPasses(sel, local.filter((p): p is LocalPass => !!p));
  built.set(key, passes);
  return passes;
}

const baseCache = new Map<string, Passes>();

/** The traveller's selection, and a setter (persisted with the rest of the app state). */
export function useTravelcards(): [TravelcardSelection, (next: TravelcardSelection) => void] {
  const { travelcards } = useAppState();
  return [travelcards, (next) => actions.set({ travelcards: next })];
}

/**
 * What the traveller's travelcards entitle them to (see src/lib/passes.ts). Stable
 * per selection, so pricing caches work; zone/area passes join once loaded.
 */
export function usePasses(): Passes {
  const [sel] = useTravelcards();
  const key = keyOf(sel);
  const [loaded, setLoaded] = useState<{ key: string; passes: Passes } | null>(null);
  useEffect(() => {
    let live = true;
    buildPasses(sel)
      .then((passes) => live && setLoaded({ key, passes }))
      .catch(() => {});
    return () => {
      live = false;
    };
    // `key` captures the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (loaded?.key === key) return loaded.passes;
  if (!baseCache.has(key)) baseCache.set(key, built.get(key) ?? nationalPasses(sel));
  return baseCache.get(key)!;
}

/** The catalog, once loaded (for settings and names). */
export function useCatalog(): Catalog | null {
  const [cat, setCat] = useState<Catalog | null>(null);
  useEffect(() => {
    loadCatalog()
      .then(setCat)
      .catch(() => {});
  }, []);
  return cat;
}
