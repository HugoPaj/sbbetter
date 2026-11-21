/**
 * Real ticket prices from SBB's NOVA price service, via the "OJP Fare" API
 * (https://opentransportdata.swiss/en/cookbook/ojp-fare/, beta).
 *
 * OJP Fare prices whole OJP Trips, so ojpConnections() hands every raw <Trip>
 * to rememberTrip() and puts the returned handle on the connection as
 * `fareRef`. The browser later asks /api/transport/fares?refs=… and we send
 * the stored trip to OJP Fare.
 *
 * The API key must be subscribed to the "OJP Fare" product in the API manager
 * (separate from OJP 2.0). Until then every call returns 403 and the UI falls
 * back to the estimate in src/lib/pricing.ts.
 */
import { createHash } from "node:crypto";
import type { FaresResponse, NovaFare } from "../transport";
import { OjpHttpError, num, ojpPost, parseOjp, text } from "./ojp";

const FARE_ENDPOINT = process.env.OJP_FARE_URL || "https://api.opentransportdata.swiss/ojpfare/";
const TRIP_TTL = 30 * 60_000;
const FARE_TTL = 30 * 60_000;
const MAX_TRIPS = 1000;
/** NOVA product code of a discounted day pass sometimes returned instead of a ticket. */
const DAY_PASS_CODES = new Set(["2361"]);
/** NOVA product code of the regular point-to-point ticket (anything else may be a Supersaver). */
const REGULAR_CODE = "125";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type X = any;

const trips = new Map<string, { xml: string; expires: number }>();
const fares = new Map<string, { fare: NovaFare | null; expires: number }>();
let blockedUntil = 0;

/** OJP Fare is a separate API product; its key may differ from the OJP 2.0 one. */
const fareKey = () => process.env.OJP_FARE_API_KEY || process.env.OJP_API_KEY;
export const faresEnabled = () => Boolean(fareKey());
let warned = false;

/**
 * Store a raw <Trip> for pricing and return its handle. Platform refs are
 * replaced by their stop place (NOVA prices commercial stops) and real-time
 * bits are dropped (fares are based on the timetable).
 */
export function rememberTrip(xml: string, parents: Map<string, string>): string {
  const clean = xml
    .replace(/<siri:StopPointRef>([^<]+)<\/siri:StopPointRef>/g, (_, ref: string) => `<siri:StopPointRef>${parents.get(ref) ?? ref}</siri:StopPointRef>`)
    .replace(/<LegTrack>[\s\S]*?<\/LegTrack>/g, "")
    .replace(/<EstimatedTime>[^<]*<\/EstimatedTime>/g, "")
    .replace(/<EstimatedQuay>[\s\S]*?<\/EstimatedQuay>/g, "")
    .replace(/<SituationFullRefs>[\s\S]*?<\/SituationFullRefs>/g, "")
    .replace(/<siri:ExpectedDepartureOccupancy>[\s\S]*?<\/siri:ExpectedDepartureOccupancy>/g, "");
  const ref = createHash("sha1").update(clean).digest("base64url").slice(0, 16);
  if (trips.size >= MAX_TRIPS) {
    const now = Date.now();
    for (const [k, v] of trips) if (v.expires < now || trips.size >= MAX_TRIPS) trips.delete(k);
  }
  trips.set(ref, { xml: clean, expires: Date.now() + TRIP_TTL });
  return ref;
}

/** Price several remembered trips (deduplicated, cached, max 3 in flight). */
export async function ojpFares(refs: string[], halfFare: boolean, signal?: AbortSignal): Promise<FaresResponse> {
  const out: FaresResponse = { available: Date.now() >= blockedUntil, fares: {} };
  if (!out.available) return out;

  const queue = [...new Set(refs)];
  const worker = async () => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      if (Date.now() < blockedUntil) {
        out.available = false;
        return;
      }
      out.fares[ref] = await priceTrip(ref, halfFare, signal).catch((err: Error) => {
        if (err instanceof OjpHttpError && (err.status === 401 || err.status === 403)) {
          // Key not subscribed to OJP Fare: stop trying for a while.
          blockedUntil = Date.now() + 10 * 60_000;
          out.available = false;
          if (!warned) console.warn("[fares] OJP Fare denied access (subscribe the key to 'OJP Fare'); using estimates.");
          warned = true;
        } else if (!signal?.aborted) {
          console.warn(`[fares] ${ref}: ${err.message}`);
        }
        return null;
      });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (!out.available) out.fares = {};
  return out;
}

async function priceTrip(ref: string, halfFare: boolean, signal?: AbortSignal): Promise<NovaFare | null> {
  const cacheKey = `${ref}:${halfFare ? "hta" : "full"}`;
  const hit = fares.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.fare;

  const trip = trips.get(ref);
  if (!trip || trip.expires < Date.now()) return null; // server restarted or stale: client re-searches

  // NOVA needs an <EntitlementProducts> element even for full fare (it 500s without one).
  const entitlement = halfFare
    ? `<EntitlementProduct><FareAuthorityRef>NOVA</FareAuthorityRef><EntitlementProductRef>HTA</EntitlementProductRef><EntitlementProductName>HTA</EntitlementProductName></EntitlementProduct>`
    : "";
  const raw = await ojpPost(
    `<OJPFareRequest>
      <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
      <TripFareRequest>${trip.xml}</TripFareRequest>
      <Params>
        <FareAuthorityFilter>ch:1:NOVA</FareAuthorityFilter>
        <PassengerCategory>Adult</PassengerCategory>
        <TravelClass>second</TravelClass>
        <Traveller><Age>30</Age><EntitlementProducts>${entitlement}</EntitlementProducts></Traveller>
      </Params>
    </OJPFareRequest>`,
    {
      endpoint: FARE_ENDPOINT,
      key: fareKey(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    },
  );
  const fare = parseFareDelivery(parseOjp(raw), halfFare);
  fares.set(cacheKey, { fare, expires: Date.now() + FARE_TTL });
  return fare;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** All values under `key` anywhere in the tree (arrays flattened). */
function findAll(node: X, key: string, acc: X[] = []): X[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, key, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) acc.push(...[v].flat());
    else findAll(v, key, acc);
  }
  return acc;
}

const firstKey = (o: X, re: RegExp) => {
  const k = Object.keys(o ?? {}).find((x) => re.test(x));
  return k ? o[k] : undefined;
};

type Product = { id: string; name: string; cls: "first" | "second"; price: number };

/** NOVA product names are German: translate the common ones. */
function englishName(name: string): string {
  return name
    .replace(/^Sparbillett$/i, "Supersaver Ticket")
    .replace(/Kinder-Tageskarte/i, "Children's Day Pass")
    .replace(/Tageskarte/i, "Day Pass")
    .replace(/Einzelbillett/i, "Single Ticket")
    .replace(/^Billett$|^Streckenbillett$/i, "Point-to-point Ticket");
}

function productOf(fp: X): Product | null {
  const price = num(text(fp?.Price?.Amount ?? fp?.Price));
  if (price === null || Number.isNaN(price) || price <= 0) return null;
  const id = text(fp?.FareProductId ?? fp?.FareProductRef);
  if (DAY_PASS_CODES.has(id)) return null;
  const clsRaw = text(fp?.TravelClass ?? fp?.FareClass ?? findAll(fp, "TravelClass")[0] ?? findAll(fp, "FareClass")[0]);
  return { id, name: englishName(text(fp?.FareProductName)), cls: /first|1/i.test(clsRaw) ? "first" : "second", price };
}

/**
 * NOVA answers with one TripFareResult per (leg range × product). A range is
 * either the whole trip (one through ticket) or a part of it (one ticket per
 * part, to be added up). Several products per range are alternatives
 * (Supersaver vs regular, 1st vs 2nd): take the cheapest of each class.
 */
export function parseFareDelivery(doc: X, halfFare: boolean): NovaFare | null {
  const results = findAll(doc, "TripFareResult");
  type Group = { from: number; to: number; products: Product[] };
  const groups = new Map<string, Group>();
  for (const r of results) {
    const from = Number(text(firstKey(r, /^From.*Ref$/)) || 0);
    const to = Number(text(firstKey(r, /^To.*Ref$/)) || from);
    const key = `${from}-${to}`;
    const g = groups.get(key) ?? { from, to, products: [] };
    for (const fp of [r?.FareProduct].flat()) {
      const p = productOf(fp);
      if (p) g.products.push(p);
    }
    if (g.products.length) groups.set(key, g);
  }
  if (!groups.size) return null;

  const all = [...groups.values()];
  const lo = Math.min(...all.map((g) => g.from));
  const hi = Math.max(...all.map((g) => g.to));
  const through = all.filter((g) => g.from === lo && g.to === hi);
  const parts = through.length ? through : all;

  const min = (ps: Product[], cls: Product["cls"], regularOnly = false) => {
    const xs = ps.filter((p) => p.cls === cls && (!regularOnly || p.id === REGULAR_CODE)).map((p) => p.price);
    return xs.length ? Math.min(...xs) : null;
  };
  const total = (cls: Product["cls"], regularOnly = false) => {
    if (through.length) {
      const xs = through.map((g) => min(g.products, cls, regularOnly)).filter((v): v is number => v !== null);
      return xs.length ? Math.min(...xs) : null;
    }
    let sum = 0;
    for (const g of parts) {
      const v = min(g.products, cls, regularOnly);
      if (v === null) return null;
      sum += v;
    }
    return Math.round(sum * 100) / 100;
  };

  const second = total("second");
  const first = total("first");
  if (second === null && first === null) return null;
  const nameOf = (cls: Product["cls"], price: number | null) =>
    through.length && price !== null ? (through.flatMap((g) => g.products).find((p) => p.cls === cls && p.price === price)?.name || null) : null;
  return {
    second,
    first,
    secondRegular: total("second", true),
    firstRegular: total("first", true),
    secondName: nameOf("second", second),
    firstName: nameOf("first", first),
    halfFare,
  };
}
