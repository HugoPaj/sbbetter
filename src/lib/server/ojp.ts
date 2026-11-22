/**
 * Server-side client for the official Open Journey Planner 2.0 API
 * (https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp-landing-page/).
 *
 * OJP speaks SIRI/XML. Everything here converts its responses into the JSON
 * shapes of transport.opendata.ch (see src/lib/transport.ts) so the UI does
 * not care which upstream answered.
 *
 * Needs OJP_API_KEY in .env.local (token from api-manager.opentransportdata.swiss).
 */
import { XMLParser } from "fast-xml-parser";
import { rememberTrip } from "./ojp-fare";
import type { Checkpoint, Connection, Disruption, Journey, Location, Section, StationboardEntry } from "../transport";

const ENDPOINT = "https://api.opentransportdata.swiss/ojp20";
const REQUESTOR = "sbb-travelers-hackathon_prod";
const LANGUAGE = "en";

export const ojpEnabled = () => Boolean(process.env.OJP_API_KEY);

// ---------------------------------------------------------------------------
// Transport + parsing
// ---------------------------------------------------------------------------

const ARRAY_TAGS = new Set([
  "TripResult",
  "Leg",
  "LegIntermediate",
  "PlaceResult",
  "StopEventResult",
  "PtSituation",
  "SituationFullRef",
  "ExpectedDepartureOccupancy",
  "PreviousCall",
  "OnwardCall",
  "Place",
  "TrackSection",
  "PathGuidanceSection",
  "Position",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false, // keep "61/62", "4", ids… as strings
  isArray: (name) => ARRAY_TAGS.has(name),
});

// The XML is loosely typed; we navigate it defensively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type X = any;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** POST an OJP 2.0 request body (the part inside ServiceRequest) and return the raw XML. */
export async function ojpPost(body: string, opts: { endpoint?: string; key?: string; signal?: AbortSignal } = {}): Promise<string> {
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest><siri:ServiceRequest>
    <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
    <siri:ServiceRequestContext><siri:Language>${LANGUAGE}</siri:Language></siri:ServiceRequestContext>
    <siri:RequestorRef>${REQUESTOR}</siri:RequestorRef>
    ${body.replaceAll("__NOW__", now)}
  </siri:ServiceRequest></OJPRequest>
</OJP>`;
  const res = await fetch(opts.endpoint ?? ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml",
      Authorization: `Bearer ${opts.key ?? process.env.OJP_API_KEY}`,
      "User-Agent": "sbb-travelers-hackathon",
      "Accept-Encoding": "gzip",
    },
    body: xml,
    signal: opts.signal,
  });
  if (!res.ok) throw new OjpHttpError(res.status);
  return res.text();
}

export class OjpHttpError extends Error {
  constructor(readonly status: number) {
    super(`OJP HTTP ${status}`);
  }
}

export const parseOjp = (raw: string): X => parser.parse(raw);

/** The ServiceDelivery of a raw OJP response. */
function deliveryOf(raw: string): X {
  const delivery = parseOjp(raw)?.OJP?.OJPResponse?.ServiceDelivery;
  if (!delivery) throw new Error("OJP: empty response");
  return delivery;
}

/** Text out of `{Text: {"#text": …}}`, `{"#text": …}` or a plain string. */
export function text(n: X): string {
  if (n == null) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (n.Text !== undefined) return text(n.Text);
  if (n["#text"] !== undefined) return String(n["#text"]);
  return "";
}

export const num = (v: X) => (v === undefined || v === null || v === "" ? null : Number(v));

// ---------------------------------------------------------------------------
// Ids, places, time
// ---------------------------------------------------------------------------

/** "ch:1:sloid:1214:0:1901" → "8501214" (UIC), so ids match transport.opendata.ch. */
export function sloidToUic(ref: string | undefined | null): string | null {
  if (!ref) return null;
  const m = /^ch:1:sloid:(\d+)/.exec(ref);
  if (m) return String(8500000 + Number(m[1]));
  return /^\d+$/.test(ref) ? ref : null;
}

/** Parse "coord:lat,lon" or "lat,lon". */
export function parseCoord(s: string): { lat: number; lon: number } | null {
  const m = /^(?:coord:)?(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(s.trim());
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

const ICON: Record<string, string> = { rail: "train", bus: "bus", trolleyBus: "bus", coach: "bus", tram: "tram", metro: "tram", water: "ship", telecabin: "cableway", funicular: "cableway" };

function placeToLocation(p: X, origin?: { lat: number; lon: number }): Location | null {
  const place = p?.Place?.[0] ?? p?.Place ?? p;
  const geo = place?.GeoPosition;
  const lat = num(geo?.Latitude);
  const lon = num(geo?.Longitude);
  const stop = place?.StopPlace;
  const name = text(stop?.StopPlaceName) || text(place?.Name);
  if (!name) return null;
  const id = stop ? sloidToUic(stop.StopPlaceRef) : lat !== null && lon !== null ? `coord:${lat},${lon}` : null;
  const modes = [place?.Mode].flat().filter(Boolean);
  return {
    id,
    name,
    score: null,
    coordinate: { type: "WGS84", x: lat, y: lon },
    distance: origin && lat !== null && lon !== null ? Math.round(haversine(origin.lat, origin.lon, lat, lon)) : null,
    icon: modes.length ? (ICON[modes[0].PtMode] ?? null) : place?.Address ? null : null,
  };
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const r = (v: number) => (v * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Local Zurich date+time → ISO string with the correct offset. */
export function zurichIso(date?: string, time?: string): string {
  if (!date && !time) return new Date().toISOString();
  const d = date || new Date().toISOString().slice(0, 10);
  const t = time || "00:00";
  const guess = new Date(`${d}T${t}:00Z`);
  const off =
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", timeZoneName: "longOffset" })
      .formatToParts(guess)
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "") || "+00:00";
  return `${d}T${t}:00${off}`;
}

const ts = (iso: string | null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

/** ISO-8601 duration ("PT1H8M48S") → minutes. */
function isoMinutes(d: string | undefined): number {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d ?? "");
  if (!m) return 0;
  return (+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0) + Math.round(+(m[4] ?? 0) / 60);
}

/** Minutes → "00d01:23:00" (transport.opendata.ch format). */
function apiDuration(min: number): string {
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return `${String(d).padStart(2, "0")}d${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** PlaceRef XML for a stop id, sloid, "coord:lat,lon" or free-text name. */
async function placeRef(input: string, signal?: AbortSignal): Promise<string> {
  const coord = parseCoord(input);
  if (coord) {
    return `<PlaceRef><GeoPosition><siri:Longitude>${coord.lon}</siri:Longitude><siri:Latitude>${coord.lat}</siri:Latitude></GeoPosition><Name><Text>Current location</Text></Name></PlaceRef>`;
  }
  if (/^\d+$/.test(input) || input.startsWith("ch:1:sloid:")) {
    return `<PlaceRef><StopPlaceRef>${esc(input)}</StopPlaceRef><Name><Text>${esc(input)}</Text></Name></PlaceRef>`;
  }
  const [hit] = await ojpLocations(input, signal);
  if (!hit?.id) throw new Error(`OJP: no stop found for "${input}"`);
  return placeRef(hit.id, signal);
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function ojpLocations(query: string, signal?: AbortSignal): Promise<Location[]> {
  const raw = await ojpPost(
    `<OJPLocationInformationRequest>
      <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
      <InitialInput><Name>${esc(query)}</Name></InitialInput>
      <Restrictions><Type>stop</Type><Type>address</Type><Type>poi</Type><NumberOfResults>12</NumberOfResults></Restrictions>
    </OJPLocationInformationRequest>`,
    { signal },
  );
  return parseLocationResponse(raw);
}

/** Stop search results from a raw OJP LocationInformation response. */
export function parseLocationResponse(raw: string): Location[] {
  const results: X[] = deliveryOf(raw).OJPLocationInformationDelivery?.PlaceResult ?? [];
  // Stops first (like the native app), then addresses / POIs.
  const locs = results.map((r) => placeToLocation(r)).filter((l): l is Location => !!l);
  return [...locs.filter((l) => l.icon), ...locs.filter((l) => !l.icon)];
}

export async function ojpNearby(lat: number, lon: number, signal?: AbortSignal): Promise<Location[]> {
  const raw = await ojpPost(
    `<OJPLocationInformationRequest>
      <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
      <InitialInput><GeoRestriction><Circle><Center><siri:Longitude>${lon}</siri:Longitude><siri:Latitude>${lat}</siri:Latitude></Center><Radius>1000</Radius></Circle></GeoRestriction></InitialInput>
      <Restrictions><Type>stop</Type><NumberOfResults>20</NumberOfResults></Restrictions>
    </OJPLocationInformationRequest>`,
    { signal },
  );
  const results: X[] = deliveryOf(raw).OJPLocationInformationDelivery?.PlaceResult ?? [];
  return results
    .map((r) => placeToLocation(r, { lat, lon }))
    .filter((l): l is Location => !!l?.id)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
}

// ---------------------------------------------------------------------------
// Journeys (shared by trips + stop events)
// ---------------------------------------------------------------------------

const OCCUPANCY: Record<string, number> = {
  empty: 1,
  manySeatsAvailable: 1,
  fewSeatsAvailable: 2,
  standingRoomOnly: 3,
  crushedStandingRoomOnly: 3,
  full: 3,
  notAcceptingPassengers: 3,
};

function occupancy(call: X): { first: number | null; second: number | null } {
  const list: X[] = call?.ExpectedDepartureOccupancy ?? [];
  const lvl = (cls: string) => {
    // Values come padded ("secondClass "), so trim.
    const o = list.find((x) => String(x.FareClass ?? "").trim() === cls);
    return o ? (OCCUPANCY[String(o.OccupancyLevel ?? "").trim()] ?? null) : null;
  };
  return { first: lvl("firstClass"), second: lvl("secondClass") };
}

const MODE_CATEGORY: Record<string, string> = { bus: "B", trolleyBus: "B", coach: "B", tram: "T", metro: "M", water: "BAT", telecabin: "GB", funicular: "FUN", rail: "R" };

function journeyMeta(service: X): Pick<Journey, "name" | "category" | "subcategory" | "categoryCode" | "number" | "operator" | "to"> {
  const category = text(service?.ProductCategory?.ShortName) || text(service?.Mode?.ShortName) || MODE_CATEGORY[service?.Mode?.PtMode] || "";
  const code = String(service?.PublicCode ?? text(service?.PublishedServiceName) ?? "");
  const number = code.startsWith(category) && /^[A-Z]+$/.test(category) ? code.slice(category.length) : code;
  return {
    name: String(service?.JourneyRef ?? ""),
    category,
    subcategory: null,
    categoryCode: null,
    number,
    operator: String(service?.OperatorRef ?? "").replace("ojp:", ""),
    to: text(service?.DestinationText),
  };
}

/** A call at a stop (LegBoard / LegIntermediate / LegAlight / ThisCall.CallAtStop) → Checkpoint. */
function checkpoint(call: X, coords: Map<string, { lat: number; lon: number }>): Checkpoint {
  const ref = String(call?.StopPointRef ?? "");
  const uic = sloidToUic(ref);
  const c = uic ? coords.get(uic) : undefined;
  const dep = call?.ServiceDeparture;
  const arr = call?.ServiceArrival;
  const depT = dep?.TimetabledTime ?? null;
  const arrT = arr?.TimetabledTime ?? null;
  const depE = dep?.EstimatedTime ?? null;
  const arrE = arr?.EstimatedTime ?? null;
  const planned = text(call?.PlannedQuay) || null;
  const estimated = text(call?.EstimatedQuay) || null;
  // Compare whole minutes, as displayed (estimates carry seconds: 13:02:50 is "13:02", not +1').
  const minuteOf = (iso: string) => Math.floor(ts(iso)! / 60);
  const delayMin = depT && depE ? minuteOf(depE) - minuteOf(depT) : arrT && arrE ? minuteOf(arrE) - minuteOf(arrT) : 0;
  const occ = occupancy(call);
  return {
    station: {
      id: uic,
      name: text(call?.StopPointName),
      score: null,
      coordinate: { type: "WGS84", x: c?.lat ?? null, y: c?.lon ?? null },
      distance: null,
    },
    arrival: arrT,
    arrivalTimestamp: ts(arrT),
    departure: depT,
    departureTimestamp: ts(depT),
    delay: Math.max(0, delayMin),
    platform: planned ?? estimated,
    prognosis: {
      platform: estimated,
      arrival: arrE,
      departure: depE,
      capacity1st: occ.first,
      capacity2nd: occ.second,
    },
  };
}

/** Platform-level StopPointRef → its stop place (NOVA prices commercial stops, not platforms). */
function stopParents(ctx: X): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of (ctx?.Places?.Place ?? []) as X[]) {
    const ref = p?.StopPoint?.StopPointRef;
    const parent = p?.StopPoint?.ParentRef;
    if (ref && parent) map.set(String(ref), String(parent));
  }
  return map;
}

function situationsById(ctx: X): Map<string, Disruption> {
  const map = new Map<string, Disruption>();
  for (const s of (ctx?.Situations?.PtSituation ?? []) as X[]) {
    const actions = [s?.PublishingActions?.PublishingAction].flat().filter(Boolean);
    const content = actions.map((a: X) => a?.PassengerInformationAction?.TextualContent).find(Boolean);
    const summary = text(content?.SummaryContent?.SummaryText);
    if (!summary) continue;
    map.set(String(s.SituationNumber), {
      summary,
      reason: text(content?.ReasonContent?.ReasonText) || undefined,
      description: text(content?.DescriptionContent?.DescriptionText) || undefined,
      cause: s.AlertCause ? String(s.AlertCause) : undefined,
      start: s.ValidityPeriod?.StartTime ? String(s.ValidityPeriod.StartTime) : undefined,
      end: s.ValidityPeriod?.EndTime ? String(s.ValidityPeriod.EndTime) : undefined,
      planned: s.Planned === undefined ? undefined : String(s.Planned) === "true",
    });
  }
  return map;
}

function placeCoords(ctx: X): Map<string, { lat: number; lon: number }> {
  const map = new Map<string, { lat: number; lon: number }>();
  for (const p of (ctx?.Places?.Place ?? []) as X[]) {
    const id = sloidToUic(p?.StopPlace?.StopPlaceRef ?? p?.StopPoint?.StopPointRef);
    const lat = num(p?.GeoPosition?.Latitude);
    const lon = num(p?.GeoPosition?.Longitude);
    if (id && lat !== null && lon !== null && !map.has(id)) map.set(id, { lat, lon });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export type OjpTripQuery = {
  from: string;
  to: string;
  /** A stop the trip has to pass through. */
  via?: string;
  date?: string;
  time?: string;
  isArrivalTime?: boolean;
  limit?: number;
  /** Ask for leg projections (the path of every leg). */
  track?: boolean;
};

export async function ojpConnections(q: OjpTripQuery, signal?: AbortSignal): Promise<Connection[]> {
  const [origin, destination, via] = await Promise.all([placeRef(q.from, signal), placeRef(q.to, signal), q.via ? placeRef(q.via, signal) : null]);
  // A ViaPoint is a place reference itself, not a wrapper around one.
  const viaPoint = via ? `\n      <Via><ViaPoint>${via.replace(/<\/?PlaceRef>/g, "")}</ViaPoint></Via>` : "";
  const when = `<DepArrTime>${zurichIso(q.date, q.time)}</DepArrTime>`;
  const raw = await ojpPost(
    `<OJPTripRequest>
      <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
      <Origin>${origin}${q.isArrivalTime ? "" : when}</Origin>
      <Destination>${destination}${q.isArrivalTime ? when : ""}</Destination>${viaPoint}
      <Params>
        <NumberOfResults>${q.limit ?? 6}</NumberOfResults>
        <IncludeIntermediateStops>true</IncludeIntermediateStops>
        <IncludeAllRestrictedLines>true</IncludeAllRestrictedLines>
        <UseRealtimeData>explanatory</UseRealtimeData>${q.track ? "\n        <IncludeLegProjection>true</IncludeLegProjection>" : ""}
      </Params>
    </OJPTripRequest>`,
    { signal },
  );
  return parseTripResponse(raw, q.from);
}

/**
 * Connections from a raw OJP Trip response, earliest first. `from` is the origin
 * as asked for: from a coordinate, the walk to the first stop becomes `accessWalk`.
 */
export function parseTripResponse(raw: string, from: string): Connection[] {
  const delivery = deliveryOf(raw).OJPTripDelivery;
  const coords = placeCoords(delivery?.TripResponseContext);
  const situations = situationsById(delivery?.TripResponseContext);
  const origCoord = parseCoord(from);

  // Keep each trip's raw XML so its fare can be requested later (OJP Fare needs the full Trip).
  const rawTrips = raw.match(/<Trip>[\s\S]*?<\/Trip>/g) ?? [];
  const parents = stopParents(delivery?.TripResponseContext);

  const connections: Connection[] = [];
  ((delivery?.TripResult ?? []) as X[]).forEach((r, i) => {
    const c = tripToConnection(r.Trip, coords, situations, origCoord);
    if (!c) return;
    if (rawTrips[i]) c.fareRef = rememberTrip(rawTrips[i], parents);
    connections.push(c);
  });
  return connections.sort((a, b) => (a.from.departureTimestamp ?? 0) - (b.from.departureTimestamp ?? 0));
}

function tripToConnection(
  trip: X,
  coords: Map<string, { lat: number; lon: number }>,
  situations: Map<string, Disruption>,
  origin: { lat: number; lon: number } | null,
): Connection | null {
  const legs: X[] = trip?.Leg ?? [];
  if (!legs.some((l) => l.TimedLeg)) return null; // walk-only result

  const sections: Section[] = [];
  const disruptions = new Map<string, Disruption>();
  let accessWalk: Connection["accessWalk"];
  let cursor = trip.StartTime as string; // running clock for walk legs (they carry no times)

  legs.forEach((leg, i) => {
    if (leg.TimedLeg) {
      const tl = leg.TimedLeg;
      const pass = [tl.LegBoard, ...(tl.LegIntermediate ?? []), tl.LegAlight].map((c) => checkpoint(c, coords));
      const occ = occupancy(tl.LegBoard);
      const journey: Journey = { ...journeyMeta(tl.Service), passList: pass, capacity1st: occ.first, capacity2nd: occ.second };
      sections.push({ journey, walk: null, departure: pass[0], arrival: pass[pass.length - 1], track: legTrack(tl) });
      for (const ref of tl.Service?.SituationFullRefs?.SituationFullRef ?? []) {
        const s = situations.get(String(ref.SituationNumber));
        if (s) disruptions.set(String(ref.SituationNumber), s);
      }
      cursor = pass[pass.length - 1].arrival ?? cursor;
      return;
    }
    // ContinuousLeg (walk from/to an address) or TransferLeg (walk between platforms).
    const walkLeg = leg.ContinuousLeg ?? leg.TransferLeg;
    if (!walkLeg) return;
    const minutes = isoMinutes(walkLeg.Duration ?? leg.Duration);
    const metres = num(walkLeg.Length) || null;
    if (i === 0 && origin) {
      // Walk from the user's position to the first stop: exposed separately so the
      // connection starts at the boarding stop (same model as the native app).
      accessWalk = { minutes, metres, track: legTrack(walkLeg) };
      return;
    }
    const start = walkLeg.LegStart;
    const end = walkLeg.LegEnd;
    const depIso = cursor;
    const arrIso = new Date(new Date(depIso).getTime() + minutes * 60_000).toISOString();
    const mk = (p: X, iso: string, kind: "dep" | "arr"): Checkpoint => {
      const uic = sloidToUic(p?.StopPointRef ?? p?.StopPlaceRef);
      const c = uic ? coords.get(uic) : undefined;
      const lat = num(p?.GeoPosition?.Latitude) ?? c?.lat ?? null;
      const lon = num(p?.GeoPosition?.Longitude) ?? c?.lon ?? null;
      return {
        station: { id: uic, name: text(p?.Name) || text(p?.StopPointName), score: null, coordinate: { type: "WGS84", x: lat, y: lon }, distance: null },
        arrival: kind === "arr" ? iso : null,
        arrivalTimestamp: kind === "arr" ? ts(iso) : null,
        departure: kind === "dep" ? iso : null,
        departureTimestamp: kind === "dep" ? ts(iso) : null,
        delay: 0,
        platform: null,
        prognosis: null,
      };
    };
    const dep = mk(start, depIso, "dep");
    const arr = mk(end, arrIso, "arr");
    // A platform change inside one station isn't a walk the native app lists.
    const sameStop = (dep.station.id && dep.station.id === arr.station.id) || dep.station.name === arr.station.name;
    if (!sameStop) {
      sections.push({ journey: null, walk: { duration: minutes * 60 }, departure: dep, arrival: arr, track: legTrack(walkLeg) });
      cursor = arrIso;
    }
  });

  const timed = sections.filter((s) => s.journey);
  const first = sections[0];
  const last = sections[sections.length - 1];
  const totalMin = Math.round(((last.arrival.arrivalTimestamp ?? 0) - (first.departure.departureTimestamp ?? 0)) / 60);
  return {
    from: first.departure,
    to: last.arrival,
    duration: apiDuration(Math.max(0, totalMin)),
    transfers: Math.max(0, timed.length - 1),
    products: timed.map((s) => `${s.journey!.category} ${s.journey!.number}`.trim()),
    // Local feeders (metro, bus) rarely report occupancy; use the first leg that does.
    capacity1st: timed.find((s) => s.journey!.capacity1st)?.journey?.capacity1st ?? null,
    capacity2nd: timed.find((s) => s.journey!.capacity2nd)?.journey?.capacity2nd ?? null,
    sections,
    accessWalk,
    disruptions: [...disruptions.values()],
  };
}

/**
 * A leg's path, as [lon, lat] (present with IncludeLegProjection): rides carry
 * it in `LegTrack`, transfer walks only in `PathGuidance`. Rail legs come with thousands of
 * points; simplified to ~2 m.
 */
function legTrack(leg: X): [number, number][] | undefined {
  const pts: [number, number][] = [];
  // Some walks carry both (the same path twice): prefer LegTrack.
  const sections: X[] = leg?.LegTrack?.TrackSection ?? ((leg?.PathGuidance?.PathGuidanceSection ?? []) as X[]).flatMap((g) => g?.TrackSection ?? []);
  for (const section of sections) {
    for (const p of section?.LinkProjection?.Position ?? []) {
      const lon = num(p?.Longitude);
      const lat = num(p?.Latitude);
      if (lon === null || lat === null || Number.isNaN(lon) || Number.isNaN(lat)) continue;
      const last = pts[pts.length - 1];
      if (!last || last[0] !== lon || last[1] !== lat) pts.push([lon, lat]);
    }
  }
  return pts.length > 1 ? simplify(pts, 0.00002) : undefined;
}

/** Douglas–Peucker line simplification (tolerance in degrees; fine at Swiss scale). */
function simplify(pts: [number, number][], tolerance: number): [number, number][] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let max = 0;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0 && max > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
}

// ---------------------------------------------------------------------------
// Departure board
// ---------------------------------------------------------------------------

export async function ojpStationboard(
  station: string,
  opts: { limit?: number; type?: "departure" | "arrival" },
  signal?: AbortSignal,
): Promise<{ station: Location; stationboard: StationboardEntry[] }> {
  const ref = await placeRef(station, signal);
  const raw = await ojpPost(
    `<OJPStopEventRequest>
      <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
      <Location>${ref}<DepArrTime>__NOW__</DepArrTime></Location>
      <Params>
        <NumberOfResults>${opts.limit ?? 15}</NumberOfResults>
        <StopEventType>${opts.type ?? "departure"}</StopEventType>
        <IncludeRealtimeData>true</IncludeRealtimeData>
      </Params>
    </OJPStopEventRequest>`,
    { signal },
  );
  return parseStopEventResponse(raw, station);
}

/** A departure (or arrival) board from a raw OJP StopEvent response for `station` (id or name). */
export function parseStopEventResponse(raw: string, station: string): { station: Location; stationboard: StationboardEntry[] } {
  const delivery = deliveryOf(raw).OJPStopEventDelivery;
  const coords = placeCoords(delivery?.StopEventResponseContext);
  const results: X[] = delivery?.StopEventResult ?? [];
  const entries: StationboardEntry[] = results.map((r) => {
    const ev = r.StopEvent;
    const stop = checkpoint(ev?.ThisCall?.CallAtStop, coords);
    const occ = occupancy(ev?.ThisCall?.CallAtStop);
    return { ...journeyMeta(ev?.Service), stop, passList: [], capacity1st: occ.first, capacity2nd: occ.second };
  });
  const first = entries[0]?.stop.station;
  const id = sloidToUic(station) ?? first?.id ?? null;
  const c = id ? coords.get(id) : undefined;
  return {
    station: { id, name: first?.name ?? station, score: null, coordinate: { type: "WGS84", x: c?.lat ?? null, y: c?.lon ?? null }, distance: null },
    stationboard: entries,
  };
}
