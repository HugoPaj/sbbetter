import { appUrl } from "./app-url";
import { formatTime, haversine } from "./format";
import { normName } from "./line-memory";
import type { Connection, Disruption, Section } from "./transport";

/**
 * Replay a real disruption on today's timetable.
 *
 * public/replays.json (scripts/build-replays.py) holds real September 2026
 * disruptions update by update, as the three SBB sources published them: the
 * timetable (VIA event log: when it reached the timetable, which lines and stops),
 * the public live ticker (every version of the text, the end estimate, the advice)
 * and the control centre's internal ticker (a few translated staff messages).
 *
 * A replay moves the incident to "now": the update being shown happens at the
 * moment it was picked, and every clock time is moved by the same amount. The
 * incident is then laid over live connections as an ordinary service alert
 * (`withReplay`), so the alert, the end forecast and Plan B react to it exactly
 * as they would to a live one. `nextMove` is what the app tells the traveller.
 */

export type ReplayStop = { id: string; name: string; lat: number; lon: number };

/** One advice line of the public ticker: travel via a station, or take the replacement bus. */
export type Advice = { kind: "via" | "bus"; a: ReplayStop[]; b: ReplayStop[]; via: ReplayStop | null; text: string };

/** What the public sources said from minute `t` on. */
export type ReplayState = {
  t: number;
  /** "timetable" before the ticker has a text (only the VIA event is known). */
  source: "timetable" | "ticker";
  summary: string;
  description: string;
  /** Affected lines as SBB lists them: "IC1", "IR15". */
  lines: string[];
  /** Closed stretches: two stops, or one stop for a disruption at a station. */
  segments: ReplayStop[][];
  advice: Advice[];
  /** SBB's announced end, minutes after the start. */
  end: number | null;
  atLeast: boolean;
  lifecycle: "INFO" | "ENDED";
  limited: boolean;
};

export type Source = "timetable" | "ticker" | "message" | "staff";

export type ReplayUpdate = {
  /** Minutes after the start. */
  t: number;
  /** Original time, ISO. */
  at: string;
  source: Source;
  /** timetable: start | lines | advice | bus | end · ticker · message · staff: info | forecast | bus | restored */
  kind: string;
  title: string;
  text: string;
  /** Ticker: what changed. Staff: the original message (French/German). */
  changes: string[];
};

export type Replay = {
  key: string;
  id: string;
  title: string;
  pitch: string;
  /** Original start, ISO with offset. */
  start: string;
  cause: string;
  causeLabel: string;
  /** A journey that runs over the closed line. */
  journey: { from: { id: string; name: string }; to: { id: string; name: string } };
  states: ReplayState[];
  updates: ReplayUpdate[];
  /** Minutes after the start (null: never). */
  outcome: {
    firstEstimate: number | null;
    firstEstimateAt: number | null;
    trainsAgain: number | null;
    ended: number | null;
    publicAt: number;
    adviceAt: number | null;
    busPublicAt: number | null;
    busStaffAt: number | null;
    restoredStaffAt: number | null;
  };
};

let loading: Promise<Replay[]> | null = null;
export function loadReplays(): Promise<Replay[]> {
  loading ??= fetch(appUrl("/replays.json")).then(async (r) => {
    if (!r.ok) throw new Error(`replays: ${r.status}`);
    return ((await r.json()) as { replays: Replay[] }).replays;
  });
  loading.catch(() => (loading = null));
  return loading;
}

// ---------------------------------------------------------------------------
// Where a replay stands
// ---------------------------------------------------------------------------

/** A running replay: which one, the update shown, and the real time (epoch ms) that update was picked. */
export type ReplayRun = { key: string; step: number; anchor: number };

export const encodeRun = (r: ReplayRun) => `${r.key}|${r.step}|${Math.round(r.anchor)}`;
export function decodeRun(s: string | undefined | null): ReplayRun | null {
  const [key, step, anchor] = (s ?? "").split("|");
  return key && step && anchor ? { key, step: +step, anchor: +anchor } : null;
}

export type Snapshot = {
  replay: Replay;
  step: number;
  /** Minutes into the disruption at the update shown. */
  t: number;
  /** The disruption's start moved to today, epoch ms. */
  start: number;
  /** Add to an original time (ms) to get today's. */
  shift: number;
  /** What the public sources said; null before the timetable knew. */
  state: ReplayState | null;
  /** Every update up to and including the one shown. */
  seen: ReplayUpdate[];
  /** Stable for one step of one run: memo key. */
  id: string;
};

export function snapshot(replay: Replay, run: ReplayRun): Snapshot {
  const step = Math.max(0, Math.min(replay.updates.length - 1, run.step));
  const t = replay.updates[step].t;
  const start = run.anchor - t * 60000;
  const state = replay.states.findLast((s) => s.t <= t) ?? null;
  // To the minute, like the minutes in the data (the original start has seconds).
  const original = Math.round(Date.parse(replay.start) / 60000) * 60000;
  return { replay, step, t, start, shift: start - original, state, seen: replay.updates.slice(0, step + 1), id: `${replay.key}|${step}|${run.anchor}` };
}

/** Today's clock time for minute `m` of the disruption. */
export const clockAt = (s: Snapshot, m: number) => formatTime(new Date(s.start + m * 60000).toISOString());

/** "lasts until approx. 18:30" → today's time (the same shift as everything else). */
export function shiftClock(text: string, s: Snapshot): string {
  const start = Math.round(Date.parse(s.replay.start) / 60000) * 60000;
  const off = /([+-])(\d\d):(\d\d)$/.exec(s.replay.start);
  const offMs = off ? (off[1] === "-" ? -1 : 1) * (+off[2] * 60 + +off[3]) * 60000 : 0;
  // Midnight before the start, in the original's own (Zurich) time.
  const midnight = Math.floor((start + offMs) / 86400e3) * 86400e3 - offMs;
  return text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h: string, m: string) => {
    let ms = midnight + (+h * 60 + +m) * 60000;
    // A time well before the start is on the next day ("until approx. 00:30").
    if (ms < start - 3 * 3600e3) ms += 86400e3;
    return formatTime(new Date(ms + s.shift).toISOString());
  });
}

// ---------------------------------------------------------------------------
// Which trains does it hit?
// ---------------------------------------------------------------------------

type Point = { id: string | null; name: string | null; lat: number | null; lon: number | null };

const pointOf = (c: Section["departure"]): Point => ({ id: c.station.id, name: c.station.name, lat: c.station.coordinate?.x ?? null, lon: c.station.coordinate?.y ?? null });
const km = (a: { lat: number | null; lon: number | null }, b: { lat: number | null; lon: number | null }) =>
  a.lat === null || a.lon === null || b.lat === null || b.lon === null ? NaN : haversine(a.lat, a.lon, b.lat, b.lon) / 1000;
const same = (p: Point, s: ReplayStop) => p.id === s.id || (!!p.name && normName(p.name) === normName(s.name));

/**
 * Does this ride run over the closed stretch? It stops at both ends, or it runs
 * between two of its stops and the way through the stretch is hardly longer than
 * the direct line between them (an IC from Lausanne to Genève runs through
 * Renens – Morges without stopping; Lausanne – Yverdon does not).
 * One stop: the ride calls at it, or passes right by it between two stops.
 */
export function runsOver(s: Section, seg: ReplayStop[]): boolean {
  if (!s.journey || !seg.length) return false;
  const pts = s.journey.passList.map(pointOf);
  const [a, b] = seg;
  if (!b) {
    if (pts.some((p) => same(p, a))) return true;
    for (let i = 1; i < pts.length; i++) if (km(pts[i - 1], a) + km(a, pts[i]) <= 1.2 * km(pts[i - 1], pts[i]) + 2) return true;
    return false;
  }
  const ia = pts.findIndex((p) => same(p, a));
  const ib = pts.findIndex((p) => same(p, b));
  if (ia >= 0 && ib >= 0) return true;
  const ab = km(a, b);
  // A stop on the stretch itself (Palézieux, between Puidoux and Vauderens): the ride uses part of it.
  // Tight, as a stop just off it is on another line (Bussigny is near Renens – Morges, on the Yverdon line).
  if (pts.some((p) => !same(p, a) && !same(p, b) && km(a, p) > 1 && km(p, b) > 1 && km(a, p) + km(p, b) <= 1.1 * ab + 0.3)) return true;
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1], pts[i]];
    const direct = km(p, q);
    const through = Math.min(km(p, a) + ab + km(b, q), km(p, b) + ab + km(a, q));
    if (through <= 1.2 * direct + 2) return true;
  }
  return false;
}

/** "IR15", as SBB lists affected lines. */
export const lineOf = (s: Section) => (s.journey ? `${s.journey.category}${s.journey.number}`.replace(/\s+/g, "") : "");

/** Indices into `conn.sections` of the rides that run over a closed stretch. */
export function hitSections(conn: Connection, state: ReplayState): number[] {
  return conn.sections.flatMap((s, i) => (s.journey && state.segments.some((seg) => runsOver(s, seg)) ? [i] : []));
}

/** The service alert this replay puts on an affected connection. */
export function disruptionOf(s: Snapshot): Disruption | null {
  const st = s.state;
  if (!st || st.lifecycle === "ENDED") return null;
  return {
    summary: st.summary,
    description: shiftClock(st.description, s) || `Lines ${st.lines.join(", ")} are affected.`,
    reason: /This is due to [^.]+\./.exec(st.description)?.[0],
    causeCode: s.replay.cause,
    start: new Date(s.start).toISOString(),
    end: st.end !== null ? new Date(s.start + st.end * 60000).toISOString() : undefined,
    planned: false,
    segments: st.segments,
    replay: s.replay.key,
  };
}

const replayed = new Map<string, WeakMap<Connection, Connection>>();

/**
 * The connection with the replayed disruption on it when one of its rides runs
 * over the closed line, else the connection itself. Same input, same object back
 * (it is used in effect dependencies).
 */
export function withReplay<C extends Connection | null | undefined>(conn: C, s: Snapshot | null): C {
  if (!conn || !s?.state) return conn;
  let memo = replayed.get(s.id);
  if (!memo) {
    replayed.clear();
    replayed.set(s.id, (memo = new WeakMap()));
  }
  const known = memo.get(conn);
  if (known) return known as C;
  const d = disruptionOf(s);
  const out = d && hitSections(conn, s.state).length ? { ...conn, disruptions: [d, ...(conn.disruptions ?? []).filter((x) => !x.replay)] } : conn;
  memo.set(conn, out);
  return out as C;
}

// ---------------------------------------------------------------------------
// What to tell the traveller
// ---------------------------------------------------------------------------

export type Move = {
  /** ok = go as planned · changed = trains again, check · act = do something now. */
  tone: "ok" | "changed" | "act";
  headline: string;
  detail: string;
  /** Who said it, for the small print ("SBB ticker, 18:57"). */
  source: string;
  /** SBB's detour for this journey: search it as a real connection. */
  via?: ReplayStop;
};

/** Every stop this connection calls at, plus its two ends. */
function stopsOf(conn: Connection): Point[] {
  return conn.sections.flatMap((s) => (s.journey ? s.journey.passList.map(pointOf) : [pointOf(s.departure), pointOf(s.arrival)]));
}

/** An advice line that concerns this connection: it travels between a stop of each side. */
export function relevantAdvice(conn: Connection, state: ReplayState, hits: number[]): Advice[] {
  const stops = stopsOf(conn);
  const on = (list: ReplayStop[]) => list.some((x) => stops.some((p) => same(p, x)));
  return state.advice.filter((a) =>
    a.kind === "via"
      ? on(a.a) && on(a.b) && !stops.some((p) => a.via && same(p, a.via))
      : a.a[0] && a.b[0] && hits.some((i) => runsOver(conn.sections[i], [a.a[0], a.b[0]])),
  );
}

const sourceLabel: Record<Source, string> = { timetable: "Timetable", ticker: "SBB ticker", message: "SBB ticker", staff: "Control centre (internal)" };

/**
 * One sentence for the traveller on this connection at this point of the replay, or
 * null when the disruption does not touch it. Built only from what was known by then.
 */
export function nextMove(s: Snapshot, conn: Connection): Move | null {
  const st = s.state;
  if (!st) return null;
  const hits = hitSections(conn, st);
  if (!hits.length) return null;
  const ride = conn.sections[hits[0]];
  const line = ride.journey ? `${ride.journey.category} ${ride.journey.number}`.trim() : "train";
  const said = (u: ReplayUpdate | undefined) => (u ? `${sourceLabel[u.source]}, ${clockAt(s, u.t)}` : "");
  const lastPublic = s.seen.findLast((u) => u.source === "ticker" || u.source === "timetable");
  const staff = (kind: string) => s.seen.findLast((u) => u.source === "staff" && u.kind === kind);
  const where = st.segments.map((seg) => seg.map((x) => x.name).join(" – ")).join(" and ");

  if (st.lifecycle === "ENDED") return { tone: "ok", headline: "Trains are running again", detail: "SBB has lifted the disruption. Some delays are still possible.", source: said(lastPublic) };
  if (st.limited)
    return { tone: "changed", headline: `Trains run again, not all of them`, detail: `Limited service ${where ? `between ${where}` : ""}. Check that your ${line} runs before you go.`, source: said(lastPublic) };
  const restored = staff("restored");
  if (restored)
    return {
      tone: "changed",
      headline: "Trains are about to run again",
      detail: `The control centre has named the first trains through. SBB's public ticker doesn't say it yet. Stay close to the station.`,
      source: said(restored),
    };

  const advice = relevantAdvice(conn, st, hits);
  const adviceAt = (a: Advice) => s.seen.find((u) => u.source === "ticker" && u.changes.some((c) => c.includes(a.text))) ?? s.seen.find((u) => u.source === "ticker");
  const via = advice.find((a) => a.kind === "via");
  if (via?.via) return { tone: "act", headline: `Travel via ${via.via.name}`, detail: `SBB: “${via.text}” Your ${line} can't get through ${where}.`, source: said(adviceAt(via)), via: via.via };
  const bus = advice.find((a) => a.kind === "bus");
  if (bus)
    return {
      tone: "act",
      headline: `Replacement bus ${bus.a[0].name} – ${bus.b[0].name}`,
      detail: `No trains between ${bus.a[0].name} and ${bus.b[0].name}. Take your ${line} as far as it goes, then the bus.`,
      source: said(adviceAt(bus)),
    };
  // Buses the control centre has ordered and SBB hasn't announced yet (not once SBB has announced, then withdrawn them).
  const busStaff = staff("bus");
  const busPublic = s.replay.states.some((x) => x.t <= s.t && x.advice.some((a) => a.kind === "bus"));
  if (busStaff && !busPublic)
    return {
      tone: "act",
      headline: `Line closed. Replacement buses are on the way`,
      detail: `The control centre has ordered buses for ${where}. SBB hasn't announced them publicly yet.`,
      source: said(busStaff),
    };
  const until = st.end !== null ? ` SBB expects it to reopen ${st.atLeast ? "at" : "around"} ${clockAt(s, st.end)}${st.atLeast ? " at the earliest" : ""}.` : "";
  return {
    tone: "act",
    headline: `Your ${line} can't get through`,
    detail: `Line closed ${where ? `between ${where}` : ""}${s.replay.causeLabel ? ` (${s.replay.causeLabel.toLowerCase()})` : ""}. SBB has no detour for this journey.${until}`,
    source: said(lastPublic),
  };
}

/** Steps whose update changes what the traveller is told: those are the moments to notify. */
export function notifySteps(replay: Replay, conn: Connection, anchor = Date.now()): Set<number> {
  const out = new Set<number>();
  let before = "";
  replay.updates.forEach((_, step) => {
    const m = nextMove(snapshot(replay, { key: replay.key, step, anchor }), conn);
    const now = m ? `${m.tone}|${m.headline}` : "";
    if (now !== before && now) out.add(step);
    before = now;
  });
  return out;
}
