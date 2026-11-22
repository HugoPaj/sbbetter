import { appUrl } from "./app-url";
/**
 * Thin typed client for Swiss timetable data. All calls go through our proxy at
 * /api/transport/*, which uses the official OJP 2.0 API when OJP_API_KEY is set
 * and falls back to https://transport.opendata.ch otherwise. Both upstreams are
 * returned in transport.opendata.ch's JSON shape.
 *
 * NOTE: in this API `coordinate.x` is LATITUDE and `coordinate.y` is LONGITUDE.
 */

export type Coordinate = { type: string; x: number | null; y: number | null };

export type Location = {
  id: string | null;
  name: string | null;
  score: number | null;
  coordinate: Coordinate;
  distance: number | null;
  icon?: string | null;
};

export type Prognosis = {
  platform: string | null;
  arrival: string | null;
  departure: string | null;
  capacity1st: number | null;
  capacity2nd: number | null;
};

export type Checkpoint = {
  station: Location;
  arrival: string | null;
  arrivalTimestamp: number | null;
  departure: string | null;
  departureTimestamp: number | null;
  delay: number | null;
  platform: string | null;
  prognosis: Prognosis | null;
};

export type Journey = {
  name: string;
  category: string;
  subcategory: string | null;
  categoryCode: number | null;
  number: string;
  operator: string;
  to: string;
  passList: Checkpoint[];
  capacity1st: number | null;
  capacity2nd: number | null;
};

export type Section = {
  journey: Journey | null;
  walk: { duration: number | null } | null;
  departure: Checkpoint;
  arrival: Checkpoint;
  /** Path actually travelled, as [lon, lat] (OJP leg projection; only when requested with `track`). */
  track?: [number, number][];
};

export type Connection = {
  from: Checkpoint;
  to: Checkpoint;
  duration: string;
  transfers: number;
  products: string[];
  capacity1st: number | null;
  capacity2nd: number | null;
  sections: Section[];
  /** Walk from a coordinate origin ("coord:lat,lon") to the first stop. */
  accessWalk?: { minutes: number; metres: number | null; track?: [number, number][] };
  /** Service alerts that touch this connection (OJP only). */
  disruptions?: Disruption[];
  /** Signed handle carrying this exact trip, to price it via /api/transport/fares (OJP only). */
  fareRef?: string;
};

/** Real ticket price from SBB's NOVA price service (via OJP Fare), CHF, single trip. */
export type NovaFare = {
  second: number | null;
  first: number | null;
  /** Price of the regular point-to-point ticket when a cheaper Supersaver exists. */
  secondRegular: number | null;
  firstRegular: number | null;
  /** English name of the cheapest product, e.g. "Supersaver Ticket" (through tickets only). */
  secondName: string | null;
  firstName: string | null;
  halfFare: boolean;
};

export type FaresResponse = {
  /** false when the OJP Fare API isn't reachable / subscribed: use the estimate. */
  available: boolean;
  /** Refs missing here could not be priced this time: ask again. `null` means there is no price. */
  fares: Record<string, NovaFare | null>;
  /** Set when refs were held back to respect the API's rate limit: ask again after this many ms. */
  retryAfter?: number;
};

export type Disruption = {
  summary: string;
  reason?: string;
  description?: string;
  cause?: string;
  /** When it started and SBB's current estimate of its end (ISO), and whether it was planned (construction). */
  start?: string;
  end?: string;
  planned?: boolean;
};

export type StationboardEntry = Omit<Journey, "passList"> & {
  stop: Checkpoint;
  passList: Checkpoint[];
};

/** Values accepted by the API's `transportations[]` filter. */
export const TRANSPORT_FILTERS = [
  "ice_tgv_rj",
  "ec_ic",
  "ir",
  "re_d",
  "s_sn_r",
  "arz_ext",
  "bus",
  "ship",
  "cableway",
  "tramway_underground",
] as const;
export type TransportFilter = (typeof TRANSPORT_FILTERS)[number];

type Params = Record<string, string | number | boolean | string[] | undefined | null>;

function toQuery(params: Params): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(`${key}[]`, v));
    else qs.set(key, String(value));
  }
  return qs.toString();
}

async function get<T>(path: string, params: Params, signal?: AbortSignal): Promise<T> {
  const res = await fetch(appUrl(`/api/transport/${path}?${toQuery(params)}`), { signal });
  if (!res.ok) throw new Error(`Transport API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Autocomplete stops/addresses by name. */
export async function searchLocations(query: string, signal?: AbortSignal) {
  const data = await get<{ stations: Location[] }>("locations", { query }, signal);
  return data.stations.filter((s) => s.name);
}

/** Stops near a coordinate, nearest first. */
export async function nearbyStations(lat: number, lon: number, signal?: AbortSignal) {
  const data = await get<{ stations: Location[] }>("locations", { x: lat, y: lon, type: "station" }, signal);
  return data.stations.filter((s) => s.id && s.name);
}

export type ConnectionsRequest = {
  from: string;
  to: string;
  via?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  isArrivalTime?: boolean;
  transportations?: TransportFilter[];
  limit?: number;
  page?: number;
  /** Include each section's path geometry (OJP only; larger and slower, so only for the detail page). */
  track?: boolean;
};

export async function getConnections(req: ConnectionsRequest, signal?: AbortSignal) {
  const data = await get<{ connections: Connection[] }>(
    "connections",
    {
      from: req.from,
      to: req.to,
      via: req.via,
      date: req.date,
      time: req.time,
      isArrivalTime: req.isArrivalTime ? 1 : undefined,
      transportations: req.transportations,
      limit: req.limit ?? 6,
      page: req.page,
      track: req.track ? 1 : undefined,
    },
    signal,
  );
  return data.connections;
}

export async function getStationboard(
  station: string,
  opts: { limit?: number; type?: "departure" | "arrival" } = {},
  signal?: AbortSignal,
) {
  const data = await get<{ station: Location; stationboard: StationboardEntry[] }>(
    "stationboard",
    { id: station, limit: opts.limit ?? 15, type: opts.type },
    signal,
  );
  return data;
}
