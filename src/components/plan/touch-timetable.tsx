"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus, X } from "lucide-react";
import { CURRENT_LOCATION, type Endpoint } from "@/lib/use-position";
import { actions, useAppState } from "@/lib/store";
import { FromIcon, TargetIcon, ToIcon } from "../icons";
import { DESK_COL, Overlap, cn, toast } from "../ui";
import { LocationPicker } from "./location-picker";

function seededRandom(seed: number) {
  let s = seed * 9301 + 49297;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/** Deterministic miniature map (lake, streets, a railway line and its stop) so each tile looks a bit different. */
function MapLines({ seed }: { seed: number }) {
  const rnd = seededRandom(seed);
  const streets = Array.from({ length: 7 }, () => {
    const x1 = rnd() * 220;
    const y1 = rnd() * 110;
    const ang = rnd() * Math.PI;
    const len = 60 + rnd() * 160;
    return { x1, y1, x2: x1 + Math.cos(ang) * len, y2: y1 + Math.sin(ang) * len, w: rnd() > 0.7 ? 1.6 : 0.8 };
  });
  const lake = { cx: 130 + rnd() * 80, cy: 4 + rnd() * 36, rx: 34 + rnd() * 30, ry: 13 + rnd() * 12, rot: rnd() * 50 - 25 };
  // The railway is a quadratic curve; the stop sits on it, clear of the label.
  const [y0, cy, y1] = [36 + rnd() * 40, rnd() * 100, 30 + rnd() * 40];
  const t = 0.62 + rnd() * 0.2;
  const stop = { x: 2 * t * (1 - t) * 110 + t * t * 220, y: (1 - t) * (1 - t) * y0 + 2 * t * (1 - t) * cy + t * t * y1 };
  const rail = `M0 ${y0} Q 110 ${cy} 220 ${y1}`;
  return (
    <svg viewBox="0 0 220 110" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
      <ellipse {...lake} transform={`rotate(${lake.rot} ${lake.cx} ${lake.cy})`} fill="#6f9bd6" opacity={0.22} />
      <g opacity={0.3}>
        {streets.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#9fb0d8" strokeWidth={l.w} />
        ))}
      </g>
      <g opacity={0.45} fill="none">
        <path d={rail} stroke="#cfd8ef" strokeWidth={3} />
        <path d={rail} stroke="#2a3250" strokeWidth={1.6} strokeDasharray="6 6" />
      </g>
      <circle cx={stop.x} cy={stop.y} r={4.2} fill="#fff" stroke="#2a3250" strokeWidth={1.6} opacity={0.75} />
    </svg>
  );
}

export function TouchTimetable({ onSearch }: { onSearch: (from: Endpoint, to: Endpoint) => void }) {
  const [mode, setMode] = useState<"from" | "to">("to");
  const [from, setFrom] = useState<Endpoint>({ id: CURRENT_LOCATION, name: "Current location" });
  const { favourites } = useAppState();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  // Swipe from one tile to another: start tile = departure, release tile = destination.
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; start: Endpoint; x0: number; y0: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [line, setLine] = useState<{ start: Endpoint; x1: number; y1: number; x2: number; y2: number; over: Endpoint | null } | null>(null);

  const endpointAt = (x: number, y: number): { ep: Endpoint; el: HTMLElement } | null => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-tt-id]");
    if (!el || !wrapRef.current?.contains(el)) return null;
    return { ep: { id: el.dataset.ttId!, name: el.dataset.ttName! }, el };
  };

  const epOf = (el: HTMLElement): Endpoint => ({ id: el.dataset.ttId!, name: el.dataset.ttName! });

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (editing || e.button !== 0) return;
    suppressClick.current = false;
    drag.current = { id: e.pointerId, start: epOf(e.currentTarget), x0: e.clientX, y0: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    const wrap = wrapRef.current;
    if (!d || d.id !== e.pointerId || !wrap) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) return;
    d.moved = true;
    const box = wrap.getBoundingClientRect();
    const src = e.currentTarget.getBoundingClientRect();
    const hit = endpointAt(e.clientX, e.clientY);
    const over = hit && hit.ep.id !== d.start.id ? hit : null;
    const tgt = over?.el.getBoundingClientRect();
    setLine({
      start: d.start,
      over: over?.ep ?? null,
      x1: src.left + src.width / 2 - box.left,
      y1: src.top + src.height / 2 - box.top,
      x2: (tgt ? tgt.left + tgt.width / 2 : e.clientX) - box.left,
      y2: (tgt ? tgt.top + tgt.height / 2 : e.clientY) - box.top,
    });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    setLine(null);
    if (!d || d.id !== e.pointerId || !d.moved) return;
    // A drag never counts as a tap, even if it ends where it started.
    suppressClick.current = true;
    const hit = endpointAt(e.clientX, e.clientY);
    if (hit && hit.ep.id !== d.start.id) onSearch(d.start, hit.ep);
  };
  const onPointerCancel = () => {
    drag.current = null;
    setLine(null);
  };
  const dragProps = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };

  const pick = (e: Endpoint) => {
    if (mode === "from") {
      setFrom(e);
      setMode("to");
    } else {
      onSearch(from, e);
    }
  };

  return (
    <Overlap className={DESK_COL}>
      <div ref={wrapRef} className="relative overflow-hidden rounded-[19px] select-none">
        <div className="grid grid-cols-2 gap-[3px] lg:grid-cols-4">
          {favourites.map((f, i) => (
            <button
              key={f.id}
              data-tt-id={f.id}
              data-tt-name={f.id}
              {...dragProps}
              aria-label={editing ? `Remove ${f.id}` : undefined}
              onClick={() => {
                if (suppressClick.current) return void (suppressClick.current = false);
                if (!editing) return pick({ id: f.id, name: f.id });
                actions.set({ favourites: favourites.filter((x) => x.id !== f.id) });
              }}
              className={cn(
                "relative h-[84px] touch-none overflow-hidden bg-gradient-to-br from-[#3a4466] via-[#2a3250] to-[#1d2440] px-3 pb-2.5 text-left text-white",
                (line ? line.start.id === f.id || line.over?.id === f.id : from.id === f.id) && "ring-2 ring-sbb-red ring-inset",
              )}
            >
              <MapLines seed={i + 1} />
              <span className="relative flex h-full flex-col justify-end">
                {f.line1 && <span className="text-[14.5px] leading-[1.15] font-light tracking-wide">{f.line1}</span>}
                <span className="text-[16px] leading-[1.15] font-bold hyphens-auto">{f.line2}</span>
              </span>
              {editing && (
                <span aria-hidden className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-sbb-red text-white">
                  <X className="size-4" strokeWidth={2} />
                </span>
              )}
            </button>
          ))}
          {editing && (
            <button onClick={() => setAdding(true)} className="flex h-[84px] flex-col items-center justify-center gap-1 bg-surface text-[14.5px] font-light tracking-tight">
              <Plus className="size-6" strokeWidth={1.25} />
              Add stop
            </button>
          )}
        </div>
        <div className="mt-[3px] grid grid-cols-4 gap-[3px] text-[16px] font-light tracking-tight">
          <button
            data-tt-id={CURRENT_LOCATION}
            data-tt-name="Current location"
            {...dragProps}
            onClick={() => {
              if (suppressClick.current) return void (suppressClick.current = false);
              setFrom({ id: CURRENT_LOCATION, name: "Current location" });
              setMode("to");
            }}
            className={cn(
              "col-span-2 flex h-[94px] touch-none flex-col justify-end gap-[7px] bg-surface px-3 pb-2 text-left",
              line && (line.start.id === CURRENT_LOCATION || line.over?.id === CURRENT_LOCATION) && "ring-2 ring-sbb-red ring-inset",
            )}
          >
            <TargetIcon className="size-6" strokeWidth={1.25} />
            Current location
          </button>
          <button
            aria-pressed={mode === "from"}
            onClick={() => setMode("from")}
            className={cn("flex h-[94px] flex-col items-center justify-end gap-[7px] bg-surface pb-2", mode === "from" && "bg-surface-2")}
          >
            <FromIcon className="size-6" />
            from
          </button>
          <button
            aria-pressed={mode === "to"}
            onClick={() => setMode("to")}
            className={cn("flex h-[94px] flex-col items-center justify-end gap-[7px] bg-surface pb-2", mode === "to" && "bg-surface-2")}
          >
            <ToIcon className="size-6" />
            to
          </button>
        </div>
        {line && (
          <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="var(--color-sbb-red, #eb0000)" strokeWidth={4} strokeLinecap="round" />
            <circle cx={line.x1} cy={line.y1} r={7} fill="#fff" stroke="var(--color-sbb-red, #eb0000)" strokeWidth={3} />
            <circle cx={line.x2} cy={line.y2} r={line.over ? 9 : 6} fill="var(--color-sbb-red, #eb0000)" stroke="#fff" strokeWidth={2} />
          </svg>
        )}
      </div>
      <div className="mt-[21.5px] flex items-center justify-between gap-2.5 pl-[3.5px]">
        <p className="text-[12px] font-light text-muted">
          {editing ? "Tap a tile to remove it, or add a new stop" : mode === "from" ? "Tap a tile to set the departure" : line
              ? line.over
                ? `${line.start.name} → ${line.over.name}`
                : `From ${line.start.name} — release on a destination`
              : `From ${from.name} — tap a destination, or swipe from one tile to another`}
        </p>
        <button
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
          className={cn("flex h-[31px] shrink-0 items-center rounded-full border border-fg/50 bg-surface px-5 text-[14.5px] font-light", editing && "bg-fg text-page")}
        >
          {editing ? "done" : "edit"}
        </button>
      </div>
      {adding && (
        <LocationPicker
          title="Add stop"
          allowCurrent={false}
          onClose={() => setAdding(false)}
          onPick={(e) => {
            setAdding(false);
            if (favourites.some((f) => f.id === e.name)) return toast(`${e.name} is already on your touch timetable.`);
            // "Town, Stop" → two lines like the built-in tiles.
            const [a, ...rest] = e.name.split(", ");
            actions.set({ favourites: [...favourites, rest.length ? { id: e.name, line1: a, line2: rest.join(", ") } : { id: e.name, line1: "", line2: e.name }] });
          }}
        />
      )}
    </Overlap>
  );
}
