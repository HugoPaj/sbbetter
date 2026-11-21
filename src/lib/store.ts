"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_TRAVELCARDS, FAVOURITES, seedExpiredTickets } from "./mock-data";
import type { TravelcardSelection } from "./travelcards";
import type { JourneyQuery } from "./journey-query";

/**
 * Tiny localStorage-backed store for prototype state (purchased tickets,
 * saved trips). Swap for a real backend when needed.
 */

export type Ticket = {
  id: string;
  product: string;
  from: string;
  to: string;
  via: string;
  validFrom: string; // ISO
  validTo: string; // ISO
  price: number;
  travelClass: 1 | 2;
};

export type SavedTrip = {
  id: string;
  query: JourneyQuery;
  index: number;
  departure: string; // ISO
  arrival: string; // ISO
  summary: string; // e.g. "B 701 → RE 33"
  /** Extra URL params to reopen it (e.g. a re-routed onward connection). */
  params?: Record<string, string>;
};

export type Favourite = { id: string; line1: string; line2: string };
/** A stop picked in a search, offered again in the next one. */
export type RecentStop = { id: string; name: string };
export type CoPassenger = { id: string; name: string; birthDate: string; reduction: string };
export type Commute = { from: string; fromName: string; to: string; toName: string; outTime: string; backTime: string };
export type SettingValue = string | number | boolean;

type State = {
  tickets: Ticket[];
  trips: SavedTrip[];
  /** Touch-timetable tiles (editable). */
  favourites: Favourite[];
  coPassengers: CoPassenger[];
  plates: string[];
  commute: Commute | null;
  /** Stops picked in searches, newest first. */
  recentStops: RecentStop[];
  /** The traveller's travelcards (Profile → Travelcards). */
  travelcards: TravelcardSelection;
  /** Free-form persisted switches / choices (profile settings, shop stop, …). */
  settings: Record<string, SettingValue>;
};

const EXTRA = { favourites: FAVOURITES as Favourite[], coPassengers: [] as CoPassenger[], plates: [] as string[], commute: null, recentStops: [] as RecentStop[], travelcards: DEFAULT_TRAVELCARDS, settings: {} as Record<string, SettingValue> };
const fresh = (): State => ({ tickets: seedExpiredTickets(), trips: [], ...EXTRA });

const KEY = "sbb-proto-state-v1";
const listeners = new Set<() => void>();
const EMPTY: State = { tickets: [], trips: [], ...EXTRA };
let state: State | null = null;

function load(): State {
  if (state) return state;
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    // Older saved states lack the newer fields: fill them in.
    state = raw ? { ...fresh(), ...(JSON.parse(raw) as Partial<State>) } : fresh();
  } catch {
    state = fresh();
  }
  return state;
}

function save(next: State) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppState(): State {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

const noSubscribe = () => () => {};

/**
 * False on the server and during hydration, when `useAppState` still returns the empty state:
 * the saved state isn't known yet, so don't present "nothing saved" as fact.
 */
export function useStoreReady(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

export const actions = {
  addTicket(t: Ticket) {
    const s = load();
    save({ ...s, tickets: [t, ...s.tickets] });
  },
  toggleTrip(trip: SavedTrip) {
    const s = load();
    const exists = s.trips.some((t) => t.id === trip.id);
    save({ ...s, trips: exists ? s.trips.filter((t) => t.id !== trip.id) : [trip, ...s.trips] });
  },
  removeTrip(id: string) {
    const s = load();
    save({ ...s, trips: s.trips.filter((t) => t.id !== id) });
  },
  removeTicket(id: string) {
    const s = load();
    save({ ...s, tickets: s.tickets.filter((t) => t.id !== id) });
  },
  addRecentStop(stop: RecentStop, max = 8) {
    const s = load();
    save({ ...s, recentStops: [stop, ...s.recentStops.filter((r) => r.id !== stop.id)].slice(0, max) });
  },
  set(patch: Partial<Omit<State, "settings">>) {
    save({ ...load(), ...patch });
  },
  setSetting(key: string, value: SettingValue) {
    const s = load();
    save({ ...s, settings: { ...s.settings, [key]: value } });
  },
  reset() {
    save(fresh());
  },
};

/** One persisted setting with a default. */
export function useSetting<T extends SettingValue>(key: string, fallback: T): [T, (v: T) => void] {
  const { settings } = useAppState();
  const v = settings[key];
  return [(v === undefined ? fallback : v) as T, (next: T) => actions.setSetting(key, next)];
}
