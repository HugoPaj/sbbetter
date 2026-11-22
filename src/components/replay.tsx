"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, History, Lock, RotateCcw, Square, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Sheet, Skeleton, cn, toast } from "./ui";
import { ConnectionCard } from "./journey";
import { backtest, disruptionEnd } from "@/lib/disruption-forecast";
import { connectionKey, loadConnection, queryForConnection, rememberConnections } from "@/lib/connection-key";
import { formatMinutes, formatTime, zurichDateTime } from "@/lib/format";
import { journeyHref, type JourneyQuery } from "@/lib/journey-query";
import { actions, readState, useAppState, useSetting } from "@/lib/store";
import { askToNotify, notify } from "@/lib/push";
import { boardingStop } from "@/lib/trip-label";
import { getConnections, type Connection } from "@/lib/transport";
import {
  clockAt,
  decodeRun,
  disruptionOf,
  encodeRun,
  hitSections,
  loadReplays,
  nextMove,
  shiftClock,
  snapshot,
  withReplay,
  type Move,
  type Replay,
  type ReplayUpdate,
  type Snapshot,
  type Source,
} from "@/lib/replay";

/**
 * Demo: replay a real disruption from September 2026 on today's timetable
 * (see lib/replay.ts). Start it from Profile → "Replay a real disruption", from a
 * connection's ⋮ → "Simulate a disruption", or with ?replay=<key> on any URL
 * (?replay=renens-morges&step=3). A dock above the tab bar steps through the updates
 * (also → / ← on a keyboard); the connection pages show what the traveller is told.
 */

const SETTING = "replay";

export function useReplays(): Replay[] | null {
  const [list, setList] = useState<Replay[] | null>(null);
  useEffect(() => {
    let live = true;
    loadReplays()
      .then((r) => live && setList(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** Where the running replay stands, or null. */
export function useReplay(): Snapshot | null {
  const [raw] = useSetting<string>(SETTING, "");
  const replays = useReplays();
  // One object per step, so it can be a memo key.
  return useMemo(() => {
    const run = decodeRun(raw);
    const replay = run && replays?.find((r) => r.key === run.key);
    return replay && run ? snapshot(replay, run) : null;
  }, [raw, replays]);
}

/** Each step is "now" when it is picked: the clock times of the replay follow the real clock from there. */
const go = (key: string, step: number) => actions.setSetting(SETTING, encodeRun({ key, step, anchor: Date.now() }));
/** Setting: id of the saved trip the replay follows (shown on the Plan page while it runs). */
export const REPLAY_TRIP = "replayTrip";
/** Setting: that trip was saved by the replay, so stopping it removes it again. */
const REPLAY_TRIP_ADDED = "replayTripAdded";

/** Ends the replay, and takes away the trip it saved. */
export function stopReplay() {
  actions.setSetting(SETTING, "");
  const id = readSetting(REPLAY_TRIP);
  if (id && readSetting(REPLAY_TRIP_ADDED)) actions.removeTrip(String(id));
  actions.setSetting(REPLAY_TRIP, "");
  actions.setSetting(REPLAY_TRIP_ADDED, false);
}
const stop = stopReplay;
const readSetting = (key: string) => readState().settings[key];

// ---------------------------------------------------------------------------
// The trip the replay follows: the connection open on screen (set by the detail page)
// ---------------------------------------------------------------------------

type Watched = { conn: Connection; query: JourneyQuery; href: string };
let watched: Watched | null = null;
const listeners = new Set<() => void>();

export function watchTrip(w: Watched | null) {
  if (w && watched && connectionKey(w.conn) === connectionKey(watched.conn) && w.href === watched.href) return;
  watched = w;
  listeners.forEach((l) => l());
}

function useWatched(): Watched | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => watched,
    () => null,
  );
}

let openPicker: (() => void) | null = null;
/** Opens the list of replays (from Profile, or a connection's "Simulate a disruption"). */
export function showReplayPicker() {
  openPicker?.();
}

/**
 * Start a replay: search the replay's journey now, open the first connection the
 * disruption hits (any time during it), and follow that trip.
 */
async function start(r: Replay, router: ReturnType<typeof useRouter>, step = 0) {
  go(r.key, step);
  const { date, time } = zurichDateTime();
  const q: JourneyQuery = { from: r.journey.from.id, fromName: r.journey.from.name, to: r.journey.to.id, toName: r.journey.to.name, date, time, isArrivalTime: false, transportations: [] };
  try {
    const list = await getConnections({ from: q.from, to: q.to, date, time, limit: 6 });
    rememberConnections(list);
    // The trip the disruption hits earliest (from its first update, ideally), else the first one.
    const firstHit = (c: Connection) => {
      const i = r.states.findIndex((st) => hitSections(c, st).length);
      return i < 0 ? Infinity : i;
    };
    const hit = [...list].sort((a, b) => firstHit(a) - firstHit(b))[0];
    if (!hit) throw new Error("no connections");
    // The traveller is on this trip: it is saved, and the Plan page shows it while the replay runs.
    const id = connectionKey(hit);
    const query = queryForConnection(q, hit);
    const old = readSetting(REPLAY_TRIP);
    if (old && old !== id && readSetting(REPLAY_TRIP_ADDED)) actions.removeTrip(String(old));
    const had = readState().trips.some((t) => t.id === id);
    if (!had) actions.toggleTrip({ id, query, index: 0, departure: hit.from.departure ?? "", arrival: hit.to.arrival ?? "", summary: hit.products.join(" → "), fromStop: boardingStop(hit) });
    actions.setSetting(REPLAY_TRIP, id);
    actions.setSetting(REPLAY_TRIP_ADDED, !had || (old === id && !!readSetting(REPLAY_TRIP_ADDED)));
    router.push(journeyHref("/connections/detail", query, { key: id }));
  } catch {
    router.push(journeyHref("/connections", q));
  }
}

// ---------------------------------------------------------------------------
// Global: the dock, the notification banner, the sheets, keyboard and ?replay=
// ---------------------------------------------------------------------------

export function ReplayDock() {
  const snap = useReplay();
  const replays = useReplays();
  const trip = useWatched();
  const router = useRouter();
  const [sheet, setSheet] = useState<"replay" | "pick" | null>(null);
  /** The dock's controls are shown (else just a small round button). */
  const [open, setOpen] = useState(false);
  const drag = useDrag();
  const [banner, setBanner] = useState<{ move: Move; trip: Watched; id: number } | null>(null);

  useEffect(() => {
    openPicker = () => setSheet("pick");
    return () => {
      openPicker = null;
    };
  }, []);

  // ?replay=<key>[&step=n] on any page starts (or jumps in) a replay. Done once per page load.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !replays) return;
    handled.current = true;
    const sp = new URLSearchParams(window.location.search);
    const key = sp.get("replay");
    const r = key && replays.find((x) => x.key === key);
    if (!r) return;
    const step = Math.max(0, Number(sp.get("step") ?? 0) || 0);
    // On a connection page: replay over it. Elsewhere: find the replay's own trip.
    if (window.location.pathname.startsWith("/connections/detail")) go(r.key, step);
    else void start(r, router, step);
  }, [replays, router]);

  // A step forward that changes what the traveller is told: that is the moment to notify them.
  const last = useRef<{ key: string; step: number; move: string } | null>(null);
  useEffect(() => {
    if (!snap || !trip) {
      last.current = null;
      return;
    }
    const move = nextMove(snap, trip.conn);
    const said = move ? `${move.tone}|${move.headline}` : "";
    const prev = last.current;
    last.current = { key: snap.replay.key, step: snap.step, move: said };
    if (!move || !prev || prev.key !== snap.replay.key || snap.step <= prev.step || prev.move === said) return;
    // A real notification on the installed app: pushed by the server if subscribed, else shown locally
    // (allowed when the replay was picked). Neither: the app's own banner.
    let live = true;
    void notify({
      title: move.headline,
      body: `${trip.query.fromName} → ${trip.query.toName}\n${move.detail}`,
      url: trip.href,
      tag: `replay-${snap.replay.key}`,
    }).then((shown) => {
      if (!shown && live) setBanner({ move, trip, id: Date.now() });
    });
    return () => {
      live = false;
    };
  }, [snap, trip]);
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 7000);
    return () => clearTimeout(id);
  }, [banner]);

  // → / ← step through the updates (presenting from a laptop).
  useEffect(() => {
    if (!snap) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "n") step(1);
      else if (e.key === "ArrowLeft" || e.key === "p") step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function step(by: number) {
    if (!snap) return;
    const next = snap.step + by;
    if (next < 0) return;
    if (next >= snap.replay.updates.length) return toast("That was the last update of this replay.");
    go(snap.replay.key, next);
  }

  const u = snap?.replay.updates[snap.step];
  return (
    <>
      {snap && u && (
        <div className="pointer-events-none fixed right-0 bottom-[calc(var(--home-inset)+133px)] left-0 z-40 mx-auto flex w-full max-w-[430px] justify-end px-[8.5px] lg:right-6 lg:bottom-6 lg:left-auto lg:w-auto">
          {/* Small by default, so it covers little of the screen; tap to open the controls. Drag to move it. */}
          <div {...drag} className="pointer-events-auto touch-none select-none">
            {!open ? (
              <button
                onClick={() => setOpen(true)}
                aria-label={`Replay, ${formatMinutes(snap.t)} in: show the controls`}
                className="relative flex size-11 items-center justify-center rounded-full border border-fg/20 bg-[#262626] shadow-lg shadow-black/50 transition-colors hover:bg-[#333] light:bg-white"
              >
                <History className="size-5" strokeWidth={1.75} />
                <span className="absolute top-0.5 right-0.5 flex size-2.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-sbb-red opacity-60" />
                  <span className="relative size-2.5 rounded-full bg-sbb-red" />
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-1 rounded-full border border-fg/20 bg-[#262626] py-1 pr-1 pl-3 shadow-lg shadow-black/50 light:bg-white">
                <button onClick={() => setSheet("replay")} className="flex min-w-0 items-center gap-2 text-left" aria-label="Open the replay">
                  <span className="relative flex size-2.5 shrink-0">
                    <span className="absolute inset-0 animate-ping rounded-full bg-sbb-red opacity-60" />
                    <span className="relative size-2.5 rounded-full bg-sbb-red" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] leading-tight font-bold">Replay · {formatMinutes(snap.t)} in</span>
                    <span className="block truncate text-[11.5px] leading-tight font-light text-muted">
                      {snap.step + 1}/{snap.replay.updates.length} · {SOURCE[u.source].label}
                    </span>
                  </span>
                </button>
                <button onClick={() => step(-1)} disabled={snap.step === 0} aria-label="Previous update" className="ml-1 flex size-9 items-center justify-center rounded-full transition-colors hover:bg-fg/10 disabled:opacity-30">
                  <ChevronLeft className="size-5" strokeWidth={1.75} />
                </button>
                <button onClick={() => step(1)} aria-label="Next update" className="flex h-9 items-center gap-0.5 rounded-full bg-sbb-red pr-2.5 pl-3 text-[13px] font-bold text-white transition-colors hover:bg-[#d40000]">
                  Next
                  <ChevronRight className="size-4.5" strokeWidth={2} />
                </button>
                <button onClick={stop} aria-label="Stop the replay" className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-fg/10">
                  <X className="size-4.5" strokeWidth={1.75} />
                </button>
                <button onClick={() => setOpen(false)} aria-label="Hide the controls" className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-fg/10">
                  <ChevronDown className="size-4.5" strokeWidth={1.75} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gone with the replay when it is stopped. */}
      {banner && snap && (
        <button
          key={banner.id}
          onClick={() => {
            setBanner(null);
            router.push(banner.trip.href);
          }}
          className="animate-fade-in fixed top-[calc(var(--safe-top)+8px)] left-1/2 z-[60] flex w-[calc(100%-16px)] max-w-[414px] -translate-x-1/2 items-start gap-3 rounded-[18px] border border-fg/10 bg-[#2a2a2a]/95 p-3 text-left shadow-2xl shadow-black/60 backdrop-blur light:bg-white/95 lg:left-auto lg:right-6 lg:translate-x-0"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-sbb-red text-[11px] font-bold text-white">SBB</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2 text-[12px] text-muted">
              <span className="truncate">
                {banner.trip.query.fromName} → {banner.trip.query.toName}
              </span>
              <span>now</span>
            </span>
            <span className="block text-[14.5px] leading-snug font-bold">{banner.move.headline}</span>
            <span className="line-clamp-2 block text-[13px] leading-snug font-light text-fg/85">{banner.move.detail}</span>
          </span>
        </button>
      )}

      {sheet === "replay" && snap && <ReplaySheet snap={snap} trip={trip} onStep={(s) => go(snap.replay.key, s)} onPick={() => setSheet("pick")} onClose={() => setSheet(null)} />}
      {sheet === "pick" && (
        <PickerSheet
          replays={replays}
          running={snap?.replay.key}
          onPick={(r) => {
            // From the tap itself: iOS only asks then. The replay's updates come as notifications.
            void askToNotify();
            setSheet(null);
            void start(r, router);
          }}
          onStop={() => {
            stop();
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

type Offset = { x: number; y: number };
const DOCK_OFFSET = "replayDockOffset";
const MARGIN = 8;

/**
 * Lets the dock be dragged anywhere on screen (so it never sits over what you want to see).
 * A press that moves more than a few pixels is a drag, and the click it ends in is swallowed;
 * one that doesn't is an ordinary tap. The spot is remembered on this device.
 */
function useDrag() {
  const ref = useRef<HTMLDivElement>(null);
  const [off, setOff] = useState<Offset>(() => {
    try {
      const saved = typeof window === "undefined" ? null : (JSON.parse(localStorage.getItem(DOCK_OFFSET) ?? "null") as Offset | null);
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return saved;
    } catch {}
    return { x: 0, y: 0 };
  });
  const press = useRef<{ id: number; x: number; y: number; from: Offset; moved: boolean; last?: Offset } | null>(null);
  const swallow = useRef(false);

  /** Keeps the whole dock on screen: after a drag, opening it (it grows), or a resize. */
  function clamp(o: Offset): Offset {
    const r = ref.current?.getBoundingClientRect();
    // Not laid out (hidden while the page changes): nothing to keep on screen, and nudging would never settle.
    if (!r || r.width === 0 || r.height === 0) return o;
    const left = r.left - off.x + o.x;
    const top = r.top - off.y + o.y;
    const dx = Math.max(MARGIN - left, Math.min(0, window.innerWidth - MARGIN - (left + r.width)));
    const dy = Math.max(MARGIN - top, Math.min(0, window.innerHeight - MARGIN - (top + r.height)));
    return { x: o.x + dx, y: o.y + dy };
  }
  useLayoutEffect(() => {
    const fit = () =>
      setOff((o) => {
        const c = clamp(o);
        return c.x === o.x && c.y === o.y ? o : c;
      });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });

  return {
    ref,
    // No transform until it has been moved: a transformed layer over the page is one more thing for the browser to composite.
    style: off.x || off.y ? { transform: `translate(${off.x}px, ${off.y}px)` } : undefined,
    onPointerDown(e: ReactPointerEvent) {
      if (e.button === 0) press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: off, moved: false };
    },
    onPointerMove(e: ReactPointerEvent) {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        p.moved = true;
        ref.current?.setPointerCapture(e.pointerId);
      }
      p.last = clamp({ x: p.from.x + dx, y: p.from.y + dy });
      setOff(p.last);
    },
    onPointerUp(e: ReactPointerEvent) {
      const p = press.current;
      press.current = null;
      if (!p?.moved) return;
      // The click this press ends in (if the browser sends one, it comes right away) is not a tap.
      swallow.current = true;
      setTimeout(() => (swallow.current = false), 0);
      ref.current?.releasePointerCapture(e.pointerId);
      try {
        localStorage.setItem(DOCK_OFFSET, JSON.stringify(p.last ?? off));
      } catch {}
    },
    onPointerCancel() {
      press.current = null;
    },
    onClickCapture(e: ReactMouseEvent) {
      if (!swallow.current) return;
      swallow.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}

const SOURCE: Record<Source, { label: string; icon: LucideIcon; className: string }> = {
  timetable: { label: "Timetable (VIA)", icon: History, className: "border-sky-400/60 text-sky-300 light:text-sky-700" },
  ticker: { label: "Public ticker", icon: TriangleAlert, className: "border-fg/40 text-fg" },
  message: { label: "Ticker message", icon: TriangleAlert, className: "border-fg/40 text-fg/85" },
  staff: { label: "Staff only", icon: Lock, className: "border-amber-400/60 text-amber-300 light:text-amber-700" },
};

function Chip({ source }: { source: Source }) {
  const s = SOURCE[source];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.75 py-px text-[10.5px] font-bold tracking-wide uppercase", s.className)}>
      <s.icon className="size-3" strokeWidth={2} />
      {s.label}
    </span>
  );
}

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(iso));
const thenAt = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(new Date(iso));

function PickerSheet({ replays, running, onPick, onStop, onClose }: { replays: Replay[] | null; running?: string; onPick: (r: Replay) => void; onStop: () => void; onClose: () => void }) {
  return (
    <Sheet title="Replay a real disruption" onClose={onClose}>
      <p className="text-[13.5px] leading-snug font-light text-fg/85">
        Real September 2026 disruptions, replayed on today&apos;s trains. Step with <b className="font-bold">Next</b> or →.
      </p>
      <ul className="mt-3.5 space-y-2">
        {(replays ?? [null, null, null]).map((r, i) =>
          r ? (
            <li key={r.key}>
              <button onClick={() => onPick(r)} className="block w-full rounded-[15px] border border-fg/20 px-3.5 py-3 text-left transition-colors hover:bg-fg/5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[15.5px] leading-snug font-bold">{r.title}</span>
                  {running === r.key && <span className="shrink-0 text-[12px] font-bold text-sbb-red">Running</span>}
                </span>
                <span className="mt-0.5 block text-[12.5px] font-light text-muted">
                  {dayOf(r.start)} · {r.causeLabel}
                </span>
                <span className="mt-1 block text-[13.5px] leading-snug font-light">{r.pitch}</span>
                <span className="mt-1.5 flex items-center gap-1 text-[13px] font-bold">
                  {r.journey.from.name} → {r.journey.to.name}
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </span>
              </button>
            </li>
          ) : (
            <Skeleton key={i} className="h-[96px] rounded-[15px]" />
          ),
        )}
      </ul>
      <Backtest className="mt-4" />
      {running && (
        <button onClick={onStop} className="mt-4 flex h-[40px] w-full items-center justify-center gap-2 rounded-full border border-fg/50 text-[15px] font-light">
          <Square className="size-3.5" strokeWidth={2} />
          Stop the replay
        </button>
      )}
    </Sheet>
  );
}

/** How the end forecast did on the September 2026 disruptions it never saw. */
export function Backtest({ className }: { className?: string }) {
  return (
    <p className={cn("text-[12.5px] leading-snug font-light text-muted", className)}>
      On {backtest.events} unseen disruptions, SBB&apos;s first end estimate held {backtest.endedBySbbEstimate} times; our 80 % estimate held {backtest.endedByModel80}.
    </p>
  );
}

function ReplaySheet({ snap, trip, onStep, onPick, onClose }: { snap: Snapshot; trip: Watched | null; onStep: (step: number) => void; onPick: () => void; onClose: () => void }) {
  const r = snap.replay;
  const o = r.outcome;
  const d = disruptionOf(snap);
  const end = d ? disruptionEnd(d) : null;
  const sbbEnd = snap.state?.end;
  // Which steps changed what this trip's traveller is told (they got a notification).
  const told = new Map<number, Move | null>();
  if (trip) {
    let before = "";
    r.updates.forEach((_, i) => {
      if (i > snap.step) return;
      const m = nextMove(snapshot(r, { key: r.key, step: i, anchor: snap.start + r.updates[i].t * 60000 }), trip.conn);
      const now = m ? `${m.tone}|${m.headline}` : "";
      // The first update opens the trip itself, with its advice on screen: nothing is sent for it.
      told.set(i, i > 0 && now && now !== before ? m : null);
      before = now;
    });
  }
  const move = trip ? nextMove(snap, trip.conn) : null;
  const shown = r.updates.slice(0, snap.step + 1).map((u, i) => ({ u, i })).reverse();
  return (
    <Sheet title={`Replay: ${r.title}`} onClose={onClose} full>
      <p className="text-[12.5px] leading-snug font-light text-muted">
        {dayOf(r.start)}, from {thenAt(r.start)} · {r.causeLabel}. Clock times are moved to today, so it plays on live trains.
      </p>

      <div className="sticky top-0 z-10 -mx-4 mt-2.5 flex items-center gap-2 bg-[#171717] px-4 py-2 light:bg-[#f2f2f2]">
        <button onClick={() => onStep(snap.step - 1)} disabled={snap.step === 0} className="flex h-[38px] items-center gap-1 rounded-full border border-fg/40 px-3 text-[14px] font-light disabled:opacity-30">
          <ChevronLeft className="size-4" strokeWidth={1.75} />
          Back
        </button>
        <span className="flex-1 text-center text-[12.5px] font-light text-muted tabular-nums">
          {formatMinutes(snap.t)} in · {snap.step + 1} of {r.updates.length}
        </span>
        <button
          onClick={() => (snap.step + 1 < r.updates.length ? onStep(snap.step + 1) : toast("That was the last update of this replay."))}
          className="flex h-[38px] items-center gap-1 rounded-full bg-sbb-red px-3.5 text-[14px] font-bold text-white"
        >
          Next update
          <ChevronRight className="size-4" strokeWidth={2} />
        </button>
      </div>

      {trip && (
        <section className="mt-2 rounded-[15px] bg-surface px-3.5 py-3">
          <p className="text-[12px] font-bold tracking-wide text-muted uppercase">
            Your trip · {trip.query.fromName} → {trip.query.toName}, {formatTime(trip.conn.from.departure)}
          </p>
          {move ? <MoveLine move={move} className="mt-1.5" /> : <p className="mt-1.5 text-[14px] font-light">Not affected so far. Nothing to tell you.</p>}
        </section>
      )}
      {!trip && <p className="mt-2 text-[13.5px] font-light">Open a connection that runs over the closed line to see what its traveller is told.</p>}

      <section className="mt-3">
        <p className="text-[12px] font-bold tracking-wide text-muted uppercase">When will it be over?</p>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13.5px] leading-snug">
          <dt className="font-light text-muted">This app</dt>
          <dd>{d?.limited ? "trains run again, so only SBB's time" : end ? `likely ${formatTime(new Date(end.likely).toISOString())}, 80 % sure by ${formatTime(new Date(end.safe).toISOString())}` : "—"}</dd>
          <dt className="font-light text-muted">SBB says</dt>
          <dd>{sbbEnd != null ? `${snap.state?.atLeast ? "at least " : "about "}${clockAt(snap, sbbEnd)}` : "nothing yet"}</dd>
          <dt className="font-light text-muted">In hindsight</dt>
          <dd className="font-light">
            {o.trainsAgain !== null ? `trains again ${clockAt(snap, o.trainsAgain)}` : "—"}
            {o.ended !== null && o.ended !== o.trainsAgain && `, all clear ${clockAt(snap, o.ended)}`}
          </dd>
        </dl>
        <Backtest className="mt-1.5" />
      </section>

      <section className="mt-3.5">
        <p className="text-[12px] font-bold tracking-wide text-muted uppercase">Updates so far</p>
        <ol className="mt-1.5 space-y-2.5">
          {shown.map(({ u, i }) => (
            <UpdateItem key={i} u={u} snap={snap} current={i === snap.step} told={trip ? told.get(i) : undefined} />
          ))}
        </ol>
        {snap.step + 1 < r.updates.length && <p className="mt-2.5 text-[12.5px] font-light text-muted">{r.updates.length - snap.step - 1} more to come.</p>}
      </section>

      <Lead snap={snap} />

      <div className="mt-4 flex gap-2">
        <button onClick={() => onStep(0)} className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-full border border-fg/40 text-[14px] font-light">
          <RotateCcw className="size-3.5" strokeWidth={1.75} />
          From the start
        </button>
        <button onClick={onPick} className="flex h-[38px] flex-1 items-center justify-center rounded-full border border-fg/40 text-[14px] font-light">
          Other replays
        </button>
        <button
          onClick={() => {
            stop();
            onClose();
          }}
          className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-full border border-fg/40 text-[14px] font-light"
        >
          <Square className="size-3" strokeWidth={2} />
          Stop
        </button>
      </div>
    </Sheet>
  );
}

function UpdateItem({ u, snap, current, told }: { u: ReplayUpdate; snap: Snapshot; current: boolean; told: Move | null | undefined }) {
  const [open, setOpen] = useState(false);
  const staff = u.source === "staff";
  const text = u.source === "timetable" && !u.text ? null : shiftClock(u.text, snap);
  return (
    <li className={cn("rounded-[13px] px-3 py-2", current ? "bg-fg/8 ring-1 ring-fg/25" : "")}>
      <div className="flex items-center gap-2">
        <span className="w-[38px] shrink-0 text-[13px] font-bold tabular-nums">{clockAt(snap, u.t)}</span>
        <Chip source={u.source} />
        <span className="ml-auto text-[11.5px] font-light text-muted tabular-nums" title="Original time">
          {thenAt(u.at)}
        </span>
      </div>
      <p className="mt-1 pl-[46px] text-[13.5px] leading-snug font-bold">{u.title}</p>
      {text && <p className="mt-0.5 pl-[46px] text-[13px] leading-snug font-light text-fg/85">{text}</p>}
      {!staff && u.changes.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 pl-[46px]">
          {u.changes.map((c, i) => (
            <li key={i} className="text-[13px] leading-snug font-light text-fg/85">
              · {shiftClock(c, snap)}
            </li>
          ))}
        </ul>
      )}
      {staff && (
        <button onClick={() => setOpen((x) => !x)} className="mt-0.5 pl-[46px] text-left text-[12px] font-light text-muted">
          {open ? u.changes[0] : "Show original (FR/DE)"}
        </button>
      )}
      {told !== undefined && (
        <p className={cn("mt-1 flex items-center gap-1.5 pl-[46px] text-[12px] leading-snug", told ? "font-bold text-fg" : "font-light text-muted")}>
          {told ? <Bell className="size-3.5 shrink-0" strokeWidth={2} /> : <BellOff className="size-3.5 shrink-0" strokeWidth={1.75} />}
          {told ? `Sent to you: “${told.headline}”` : "Nothing new for your trip: no notification"}
        </p>
      )}
    </li>
  );
}

/** Where the internal ticker was ahead of the public one, in this replay (hindsight, so at the end). */
function Lead({ snap }: { snap: Snapshot }) {
  const o = snap.replay.outcome;
  const rows: string[] = [];
  if (o.busStaffAt !== null && (o.busPublicAt === null || o.busStaffAt < o.busPublicAt))
    rows.push(`Buses: in the staff ticker ${formatMinutes(o.busStaffAt)} in${o.busPublicAt !== null ? `, public ${formatMinutes(o.busPublicAt)} in` : ", never in the public timetable"}.`);
  if (o.restoredStaffAt !== null && o.trainsAgain !== null && o.restoredStaffAt < o.trainsAgain)
    rows.push(`Trains again: staff knew ${formatMinutes(o.restoredStaffAt)} in, the public ticker said so ${formatMinutes(o.trainsAgain)} in.`);
  if (o.firstEstimate !== null && o.trainsAgain !== null && o.trainsAgain > o.firstEstimate + 15)
    rows.push(`SBB's first end estimate was ${formatMinutes(o.firstEstimate)} after the start; trains ran again after ${formatMinutes(o.trainsAgain)}.`);
  if (!rows.length || snap.step + 1 < snap.replay.updates.length) return null;
  return (
    <section className="mt-3.5 rounded-[15px] border border-fg/20 px-3.5 py-3">
      <p className="text-[12px] font-bold tracking-wide text-muted uppercase">In hindsight</p>
      <ul className="mt-1 space-y-1">
        {rows.map((x) => (
          <li key={x} className="text-[13.5px] leading-snug font-light">
            {x}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// On the connection page: what to do now
// ---------------------------------------------------------------------------

function MoveLine({ move, className }: { move: Move; className?: string }) {
  const Icon = move.tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div className={className}>
      <p className="flex items-start gap-2.5">
        <Icon className={cn("mt-px size-4.5 shrink-0", move.tone === "ok" ? "text-ok" : move.tone === "act" ? "text-sbb-red" : "text-amber-400")} strokeWidth={2} />
        <span className="text-[14.5px] leading-snug font-bold">{move.headline}</span>
      </p>
      <p className="mt-1 pl-7 text-[14px] leading-snug font-light">{move.detail}</p>
      {move.source && <p className="mt-0.5 pl-7 text-[12px] font-light text-muted">{move.source}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On the Plan page: the trip the traveller is on, while the replay runs
// ---------------------------------------------------------------------------

/** The saved trip a running replay follows, and that trip as it runs today. */
export function useReplayTrip() {
  const snap = useReplay();
  const { trips, settings } = useAppState();
  const trip = snap ? trips.find((t) => t.id === settings[REPLAY_TRIP]) : undefined;
  const [loaded, setLoaded] = useState<{ id: string; conn: Connection | null } | null>(null);
  const id = trip?.id ?? null;
  useEffect(() => {
    if (!id || !trip) return;
    const ctrl = new AbortController();
    // A re-routed trip's id is "<planned key>~<onward key>"; the onward part is in its params.
    loadConnection(trip.query, new URLSearchParams({ key: id.split("~")[0], ...trip.params }), ctrl.signal)
      .then((conn) => setLoaded({ id, conn }))
      .catch((e: Error) => e.name !== "AbortError" && setLoaded({ id, conn: null }));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the id covers the trip's query and params.
  }, [id]);
  return { snap, trip, conn: id && loaded?.id === id ? loaded.conn : undefined };
}

/**
 * Plan → "On your way" during a replay: the trip with its timeline and the disruption on it,
 * and what to do now. Opens the trip, where the way round is offered.
 */
export function ReplayTripCard() {
  const { snap, trip, conn } = useReplayTrip();
  if (!snap || !trip) return null;
  const href = journeyHref("/connections/detail", trip.query, { key: trip.id, ...trip.params });
  if (conn === undefined) return <Skeleton className="h-[118px] rounded-[19px]" />;
  if (conn === null) return <p className="px-1 text-[14px] font-light">This trip can no longer be found.</p>;
  const move = nextMove(snap, conn);
  return (
    <div className="space-y-1.25">
      <ConnectionCard connection={withReplay(conn, snap)} href={href} />
      <Link href={href} className="flex items-start gap-2.5 rounded-[19px] bg-surface px-[15px] py-3 transition-colors hover:bg-[#2b2b2b] light:hover:bg-[#f5f5f5]">
        {move ? (
          <MoveLine move={move} className="min-w-0 flex-1" />
        ) : (
          <span className="flex-1 text-[14.5px] leading-snug font-light">Your trip isn&apos;t affected so far.</span>
        )}
        <ChevronRight className="mt-0.5 size-4.25 shrink-0 text-fg/70" strokeWidth={1.5} />
      </Link>
    </div>
  );
}
