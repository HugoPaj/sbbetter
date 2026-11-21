import { causeCode, forecast } from "./disruption-forecast";
import { queryForConnection } from "./connection-key";
import { zurichDateTime } from "./format";
import { toConnectionsRequest, type JourneyQuery } from "./journey-query";
import { getConnections, type Connection, type Disruption, type Section } from "./transport";

/**
 * Line memory: what happened the last times a stretch of line was disrupted.
 *
 * Built by scripts/build-line-memory.py from the SBB hackathon export: every
 * disruption of a stretch since March 2024, where staff sent travellers
 * instead ("via …") and how late that advice came, and the usual order of
 * events per cause. The app uses it to say all of that at minute zero.
 */

export type StretchEnd = { name: string; id: string | null; lat: number | null; lon: number | null };

/** A way round that staff recommended in past disruptions of a stretch. */
export type Detour = {
  via: string;
  /** Stop id of the via station. */
  id: string;
  /** Disruptions of this stretch in which the public ticker gave this advice. */
  n: number;
  /** Median minutes into the disruption when it was given. */
  after: number | null;
  /** What staff wrote (English, machine-translated in the source), and on which day. */
  quote: string | null;
  quoted: string | null;
  /** Also the control centre's own travel advice (September 2026). */
  staff: boolean;
};

export type PastIncident = { i: number; /** YYYY-MM-DD */ d: string; /** EG code */ c: string; /** Duration, minutes. */ m: number | null; via: string[] | null };

export type Stretch = {
  key: string;
  /** Two neighbouring stations, or one station for a disruption at a station. */
  ends: StretchEnd[];
  line: string | null;
  n: number;
  /** Of `n`, how often the line was fully interrupted (the rest: limited service). */
  closed: number;
  causes: [string, number][];
  /** Replacement buses: announced in `n` of `of` disruptions with a ticker, a median `after` minutes in. */
  bus: { of: number; n: number; after: number | null };
  detours: Detour[];
  /** Stations via which tickets for this stretch were also valid in past disruptions. */
  ticketVia: string[];
  /** Newest first. */
  incidents: PastIncident[];
};

export type StepKey = "bus" | "detour" | "onsite" | "forecast";
type StepData = { n: number; minutes: number[] };

export type LineMemory = {
  builtFrom: string;
  since: string;
  until: string;
  incidents: number;
  causes: Record<string, string>;
  script: Record<string, Partial<Record<StepKey, StepData>>>;
  stretches: Stretch[];
};

let loading: Promise<LineMemory> | null = null;
/** ~100 KB, fetched once, lazily, from /public. */
export function loadLineMemory(): Promise<LineMemory> {
  loading ??= fetch("/line-memory.json").then((r) => {
    if (!r.ok) throw new Error(`line memory: ${r.status}`);
    return r.json();
  });
  loading.catch(() => (loading = null));
  return loading;
}

/** Same folding as the build script: "Biel/Bienne" → "biel bienne". */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[.,;:!?'’/\-–()"«»]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export const stretchName = (s: Stretch) => s.ends.map((e) => e.name).join(" – ");
/** "once", "twice", "6 times" */
export const timesWord = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
export const causeLabel = (m: LineMemory, code: string) => m.causes[code] ?? "Disruption";

const quantile = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

/**
 * How long disruptions of these stretches lasted, in a way one week-long closure can't distort:
 * from five cases on, the time two in three were over within (`most`); always the shortest and longest.
 */
export function overWithin(stretches: Stretch[]): { most: number | null; low: number; high: number } | null {
  const seen = new Set<number>();
  const mins: number[] = [];
  for (const i of stretches.flatMap((s) => s.incidents)) {
    if (!i.m || seen.has(i.i)) continue;
    seen.add(i.i);
    mins.push(i.m);
  }
  if (!mins.length) return null;
  mins.sort((a, b) => a - b);
  return { most: mins.length >= 5 ? mins[Math.ceil((mins.length * 2) / 3) - 1] : null, low: mins[0], high: mins[mins.length - 1] };
}

/** Disruptions on these stretches, each counted once (one at a junction sits on two stretches). */
export function countIncidents(stretches: Stretch[]): number {
  return new Set(stretches.flatMap((s) => s.incidents.map((i) => i.i))).size;
}

// ---------------------------------------------------------------------------
// Which remembered stretches does a connection run over?
// ---------------------------------------------------------------------------

/** A station counts as on the path within this distance of it. */
const NEAR_KM = 0.35;

/** Distance in km from a point to the segment a–b ([lon, lat]). */
function segmentKm(lat: number, lon: number, a: [number, number], b: [number, number]): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  const ax = (a[0] - lon) * kx;
  const ay = (a[1] - lat) * ky;
  const dx = (b[0] - lon) * kx - ax;
  const dy = (b[1] - lat) * ky - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const isStop = (s: Section, e: StretchEnd) => s.journey!.passList.some((p) => (e.id && p.station.id === e.id) || (!!p.station.name && normName(p.station.name) === normName(e.name)));

/**
 * Does this ride pass the station? Stopping there always counts. Trains that run
 * through need the path actually travelled (`track`, OJP only): without it a
 * fast train is only matched at its own stops.
 */
function passes(s: Section, e: StretchEnd): boolean {
  if (isStop(s, e)) return true;
  const { lat, lon } = e;
  if (lat === null || lon === null || !s.track) return false;
  for (let i = 1; i < s.track.length; i++) if (segmentKm(lat, lon, s.track[i - 1], s.track[i]) <= NEAR_KM) return true;
  return false;
}

export type Hit = { stretch: Stretch; /** Index into `connection.sections` of the ride that runs over it. */ section: number };

const hitsOf = new WeakMap<Connection, Hit[]>();

/** The remembered stretches a connection runs over, the most disrupted first. */
export function stretchesOn(conn: Connection, memory: LineMemory): Hit[] {
  const known = hitsOf.get(conn);
  if (known) return known;
  const hits: Hit[] = [];
  conn.sections.forEach((s, section) => {
    if (!s.journey) return;
    for (const stretch of memory.stretches) {
      if (hits.some((h) => h.stretch === stretch)) continue;
      if (stretch.ends.every((e) => passes(s, e))) hits.push({ stretch, section });
    }
  });
  hits.sort((a, b) => b.stretch.n - a.stretch.n);
  hitsOf.set(conn, hits);
  return hits;
}

/**
 * Where staff sent travellers when one of these stretches was closed: the detour advised most often,
 * with the stretch it was advised for. Not a station the journey starts or ends at anyway.
 */
export function advisedDetour(stretches: Stretch[], not: (string | null | undefined)[] = []): { detour: Detour; stretch: Stretch; n: number } | null {
  const best = new Map<string, { detour: Detour; stretch: Stretch; n: number }>();
  for (const stretch of stretches) {
    for (const detour of stretch.detours) {
      if (not.includes(detour.id)) continue;
      const seen = best.get(detour.id);
      // Counted over all the stretches; shown for the stretch where it was advised most.
      if (!seen) best.set(detour.id, { detour, stretch, n: detour.n });
      else best.set(detour.id, { ...(detour.n > seen.detour.n ? { detour, stretch } : seen), n: seen.n + detour.n });
    }
  }
  return [...best.values()].sort((a, b) => b.n - a.n || Number(b.detour.staff) - Number(a.detour.staff))[0] ?? null;
}

/** The stretch a live service message is about ("Interrupted service: Chavornay - Ependes VD"). */
export function stretchOf(d: Pick<Disruption, "summary">, memory: LineMemory): Stretch | null {
  const where = d.summary.includes(": ") ? d.summary.slice(d.summary.indexOf(": ") + 2) : d.summary;
  const [a, rest] = where.split(/\s+[-–]\s+/);
  if (!a) return null;
  const keyOf = (names: string[]) => names.map(normName).sort().join(" | ");
  const keys = rest ? rest.split(" and ").map((b) => keyOf([a, b])) : [keyOf([a])];
  return memory.stretches.find((s) => keys.includes(s.key)) ?? null;
}

// ---------------------------------------------------------------------------
// What usually happens next
// ---------------------------------------------------------------------------

const STEP_LABEL: Record<StepKey, string> = {
  bus: "Replacement buses announced",
  detour: "Detour advice published",
  onsite: "Specialists on site",
  forecast: "New forecast for the end",
};

export type Step = {
  key: StepKey | "end";
  label: string;
  /** Share of past disruptions in which it happened at all (not for the end). */
  share: number | null;
  /** Expected minutes after the start, given how long it has been running. */
  minutes: number;
  /** Usually behind us by now. */
  done: boolean;
};

/**
 * The usual order of events for a disruption with this cause that has been
 * running for `elapsed` minutes: what is typically behind us, what comes next
 * and when, and when the line is likely open again (see disruption-forecast).
 */
export function scriptFor(memory: LineMemory, cause: string, elapsed: number, announced?: number | null): Step[] {
  const steps: Step[] = [];
  for (const key of Object.keys(STEP_LABEL) as StepKey[]) {
    const data = memory.script[cause]?.[key] ?? memory.script.ALL[key];
    if (!data?.minutes.length) continue;
    const all = data.minutes;
    const left = all.filter((m) => m > elapsed);
    // Few past cases were still waiting for it at this point: it has usually happened.
    const done = left.length < Math.max(3, all.length * 0.2);
    steps.push({ key, label: STEP_LABEL[key], share: all.length / data.n, minutes: done ? quantile(all, 0.5) : quantile(left, 0.5), done });
  }
  steps.sort((a, b) => Number(b.done) - Number(a.done) || a.minutes - b.minutes);
  const end = forecast(cause, elapsed, announced).likelyMinutes;
  // What would only come after the line is likely open again is not worth announcing.
  return [...steps.filter((s) => s.done || s.minutes <= end), { key: "end", label: "Line likely open again", share: null, minutes: end, done: false }];
}

/** "8 in 10" */
export const inTen = (share: number) => `${Math.max(1, Math.min(9, Math.round(share * 10)))} in 10`;

/** A running, unplanned disruption as line memory sees it. */
export type Closure = {
  /** Key of the stretch, when it is one we remember. */
  stretch: string | null;
  /** EG code, or "ALL". */
  cause: string;
  /** ISO start. */
  start: string;
  /** SBB's announced end, ISO, if any. */
  end?: string;
  /** Not real: part of the "Simulate a disruption" demo. */
  simulated?: boolean;
};

/** The first live service message that is an unplanned disruption running right now. */
export function closureOf(disruptions: Disruption[] | undefined, memory: LineMemory, now = Date.now()): Closure | null {
  for (const d of disruptions ?? []) {
    const start = d.start ? Date.parse(d.start) : NaN;
    // The script covers the first hours; days-old messages are a different kind of event.
    if (d.planned || Number.isNaN(start) || start > now || now - start > 12 * 3600e3) continue;
    const stretch = stretchOf(d, memory);
    // A line that is closed or restricted, not any service message (a lift out of order, a platform change).
    if (!stretch && !/interrupt|limited service|restrict|line closed/i.test(d.summary)) continue;
    const words = /(?:due to|reason:)\s*(?:an? |the )?([^.]+)/i.exec(d.reason ?? "")?.[1] ?? null;
    const named = causeCode(words);
    const end = d.end ? Date.parse(d.end) : NaN;
    return {
      stretch: stretch?.key ?? null,
      // However the feed phrases it ("The reason is a signal box failure"): fall back to the whole sentence.
      cause: named === "ALL" ? causeCode(d.reason ?? null) : named,
      start: d.start!,
      end: Number.isFinite(end) && end - start < 7 * 24 * 3600e3 ? d.end : undefined,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plan B: the detour staff recommended, as a real connection
// ---------------------------------------------------------------------------

export type PlanB = {
  detour: Detour;
  connection: Connection;
  /** Re-fetches exactly this connection (via the detour station). */
  query: JourneyQuery;
  /** Minutes later than the planned arrival. */
  extraMinutes: number;
};

/** A detour that costs more than this is no plan. */
const MAX_EXTRA = 150;

/**
 * Does a connection searched "via" a detour station still run over the stretch it should avoid?
 * (A fast train can pass the detour station and the closed stretch alike.)
 */
function stillOn(c: Connection, stretch: Stretch, viaId: string): boolean {
  return c.sections.some((s) => {
    if (!s.journey || !stretch.ends.every((e) => passes(s, e))) return false;
    if (stretch.ends.length < 2) return true;
    // Stopping at the detour station between the two ends means another line links them (Olten – Bern via Langenthal).
    const at = (e: StretchEnd) => s.journey!.passList.findIndex((p) => (e.id && p.station.id === e.id) || normName(p.station.name ?? "") === normName(e.name));
    const [i, j] = [at(stretch.ends[0]), at(stretch.ends[1])].sort((a, b) => a - b);
    const via = s.journey.passList.findIndex((p) => p.station.id === viaId);
    return !(i >= 0 && via > i && via < j);
  });
}

/**
 * The best real connection round a stretch, trying the detours staff recommended
 * there (most often first). `query` is the journey from where it has to start,
 * at the time it can start; `plannedArrival` (epoch seconds) is what it is compared to.
 * `prefer` is the stop id of a detour that wins whenever it works.
 */
export async function findPlanB(query: JourneyQuery, plannedArrival: number, stretch: Stretch, signal?: AbortSignal, prefer?: string): Promise<PlanB | null> {
  const ends = new Set([query.from, query.to]);
  const detours = stretch.detours.filter((d) => !ends.has(d.id)).sort((a, b) => Number(b.id === prefer) - Number(a.id === prefer)).slice(0, 3);
  // Zurich clock time as text, like the query's own date and time.
  const clock = (iso: string | null) => {
    if (!iso) return "";
    const z = zurichDateTime(new Date(iso));
    return `${z.date}T${z.time}`;
  };
  const found = await Promise.all(
    detours.map(async (detour): Promise<PlanB | null> => {
      const q: JourneyQuery = { ...query, isArrivalTime: false, via: detour.id, viaName: detour.via };
      // With the path of each leg (OJP), so a train that runs through the closed stretch without stopping is caught.
      const list = await getConnections({ ...toConnectionsRequest(q), limit: 3, track: true }, signal).catch((e: Error) => {
        if (e.name === "AbortError") throw e;
        return [] as Connection[];
      });
      // Not a train that has left before the journey can start, and not one that takes the closed stretch after all.
      const connection = list.find((c) => !stillOn(c, stretch, detour.id) && clock(c.from.departure) >= `${query.date}T${query.time}`);
      if (!connection) return null;
      const extraMinutes = Math.round(((connection.to.arrivalTimestamp ?? 0) - plannedArrival) / 60);
      return extraMinutes <= MAX_EXTRA ? { detour, connection, query: queryForConnection(q, connection), extraMinutes } : null;
    }),
  );
  const options = found.filter((p): p is PlanB => !!p);
  // The detour the traveller was already told about, whenever it works.
  const promised = options.find((p) => p.detour.id === prefer);
  if (promised) return promised;
  // Earliest arrival wins; within a few minutes, the detour staff advised more often.
  options.sort((a, b) => (Math.abs(a.extraMinutes - b.extraMinutes) > 5 ? a.extraMinutes - b.extraMinutes : b.detour.n - a.detour.n));
  return options[0] ?? null;
}
