"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, cn } from "@/components/ui";
import { WalkIcon } from "@/components/icons";
import { Capacity, DelayLabel, type DelayNote, LineLabel, ModeBadge, delayNote } from "@/components/journey";
import { formatTime } from "@/lib/format";
import type { Checkpoint } from "@/lib/transport";
import { buildItems, gone, schedule, transitionNames, type Leg, type Stop } from "./timeline";

/** Station name that opens the stop's departure board. */
export function StopButton({ checkpoint, onStop, className }: { checkpoint: Checkpoint; onStop: (s: Stop) => void; className?: string }) {
  const { id, name } = checkpoint.station;
  if (!id || !name) return <span className={className}>{name}</span>;
  return (
    <button onClick={() => onStop({ id, name })} className={cn("text-left", className)}>
      {name}
    </button>
  );
}

const GRID = "grid grid-cols-[49.5px_20px_minmax(0,1fr)]";

export const LINE = "absolute left-1/2 -translate-x-1/2";
/** Two rail styles only: solid for riding, dotted for walking. Travelled is bright, ahead is dimmed. */
const lineStyle = (leg: Leg) => (leg.kind !== "ride" ? "w-0 border-l-[3px] border-dotted border-fg" : "w-[3px] bg-fg");
/** The "you are here" look, shared by the marker on a rail and the stop being waited at. */
const HERE = "ring-4 ring-fg/25";

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-fg/12 px-1.75 text-[12px] leading-[18px] font-bold whitespace-nowrap text-fg/85">{children}</span>;
}

/**
 * The whole journey as one continuous timeline: stops are dots, rides are solid
 * lines, walks are dotted lines. It fills from the top as the journey goes on:
 * what is travelled at `now` is bright with solid dots, what is ahead is dimmed
 * with hollow dots, and a haloed dot marks where you are. A leg that no longer
 * works carries the "Take instead" box; the plan itself only changes once the
 * user accepts it.
 */
export function Itinerary({ legs, now, header, onStop }: { legs: Leg[]; /** Seconds; null until known. */ now: number | null; header?: ReactNode; onStop: (s: Stop) => void }) {
  const items = buildItems(legs);
  const brokenAt = items.findIndex((x) => x.type === "leg" && gone(x.leg));
  const spans = schedule(items);
  /** Travelled share of each leg, 0 to 1. */
  const done = spans.map((s) => (!s || s.off || now === null || now <= s.t0 ? 0 : now >= s.t1 ? 1 : (now - s.t0) / (s.t1 - s.t0)));
  const MOVE = "duration-500 motion-reduce:transition-none";
  const names = transitionNames(items);
  const vt = (i: number, part: string): CSSProperties => ({ viewTransitionName: `${names[i]}-${part}` });

  return (
    <Card className="overflow-hidden">
      {header && <div className="space-y-3 border-b border-line px-[15px] py-3.5">{header}</div>}
      <div className={cn(GRID, "px-[15px] py-[15px] text-[16px] tracking-tight")}>
        {/* One rail per leg, from the centre of its first dot to the centre of its last. */}
        {items.map((item, i) => {
          if (item.type !== "leg") return null;
          const rail = cn(LINE, "top-2.5 -bottom-2.5", lineStyle(item.leg));
          return (
            <span key={`rail${i}`} className="relative col-start-2" style={{ gridRow: `${i} / span 2`, ...vt(i, "rail") }}>
              <span className={cn(rail, "opacity-35")} />
              <span className={cn(rail, "transition-[clip-path]", MOVE)} style={{ clipPath: `inset(0 0 ${(1 - done[i]) * 100}% 0)` }} />
              {done[i] > 0 && done[i] < 1 && (
                <span className={cn("absolute left-1/2 size-3.5 -translate-1/2 rounded-full bg-fg transition-[top]", HERE, MOVE)} style={{ top: `calc(10px + ${done[i] * 100}%)` }} />
              )}
            </span>
          );
        })}
        {items.map((item, i) => {
          const row = { gridRow: i + 1 };
          if (item.type === "leg") return <Segment key={i} leg={item.leg} style={{ ...row, ...vt(i, "seg") }} onStop={onStop} />;
          const n = item.node;
          const next = spans[i + 1];
          const change = !!n.arr && !!n.dep;
          // Reached once the leg into it is done (the first stop: once it is time to leave).
          const reached = i > 0 ? done[i - 1] === 1 : !!next && now !== null && now >= next.t0;
          // Waiting here: the next leg has not started (or never will).
          const here = reached && !!next && done[i + 1] === 0;
          // The ride from here has left.
          const left = !!next && now !== null && now >= next.t0;
          // Boarding a missed/cancelled ride, or anywhere after it: no longer part of the trip.
          const off = brokenAt >= 0 && i >= brokenAt - 1;
          return (
            <Fragment key={i}>
              <span className={cn("relative col-start-1 leading-5 tabular-nums", off && "text-muted")} style={{ ...row, ...vt(i, "time") }}>
                {n.arr && <span className={cn("block tracking-[-0.03em]", n.arrLate ? "font-light text-muted line-through decoration-1" : change ? "font-light" : "font-bold")}>{n.arr}</span>}
                {n.arrLate && <span className={cn("block font-bold tracking-[-0.04em]", n.delayed && "text-sbb-red")}>{n.arrLate}</span>}
                {/* Each delay sits right under the time it belongs to, so it reads with that stop.
                    Once a moment has passed it shows what happened, never a forecast (see delayNote). */}
                {n.arrCp && <DelayLine note={delayNote(n.arrCp, "arrival", { forecast: n.forecast, past: reached })} />}
                {n.dep && <span className={cn("block font-bold tracking-[-0.04em]", n.depGone && "text-muted")}>{n.dep}</span>}
                {n.depCp && <DelayLine note={delayNote(n.depCp, "departure", { past: left })} />}
                {!n.arr && !n.dep && n.at && <span className="block font-bold tracking-[-0.04em]">{n.at}</span>}
              </span>
              <span className="relative col-start-2" style={{ ...row, ...vt(i, "dot") }}>
                <span
                  className={cn(
                    "absolute top-2.5 left-1/2 size-3.5 -translate-1/2 rounded-full border-[3px] transition-colors",
                    MOVE,
                    reached ? "border-fg bg-fg" : cn("bg-surface", off ? "border-fg/40" : n.delayed ? "border-sbb-red" : "border-fg"),
                    here && HERE,
                  )}
                />
              </span>
              <div className={cn("col-start-3 pl-3 leading-5", off && "text-muted")} style={{ ...row, ...vt(i, "stop") }}>
                <div className="flex items-start justify-between gap-1.75">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.75 gap-y-1">
                    {n.checkpoint ? <StopButton checkpoint={n.checkpoint} onStop={onStop} className="font-bold" /> : <span className="font-bold">{n.name}</span>}
                    {n.pill && <Pill>{n.pill}</Pill>}
                  </span>
                  {(n.arrPl || n.depPl) && (
                    <span className="text-right whitespace-nowrap">
                      {n.arrPl && <span className={cn("block", change ? "font-light" : "font-bold")}>{n.arrPl}</span>}
                      {n.depPl && n.depPl !== n.arrPl && <span className={cn("block font-bold", n.depGone && "text-muted")}>{n.depPl}</span>}
                    </span>
                  )}
                </div>
                {n.note && <p className={cn("mt-0.5 text-[13px] font-light", n.note.tone === "ok" ? "text-ok" : "text-muted")}>{n.note.text}</p>}
              </div>
            </Fragment>
          );
        })}
      </div>
    </Card>
  );
}

/** A delay on its own line under its time; nothing when there is none. */
function DelayLine({ note }: { note: DelayNote | null }) {
  return note ? <span className="-mt-0.5 block leading-4"><DelayLabel note={note} /></span> : null;
}

/** What happens between two stops; its rail is drawn by the timeline. */
function Segment({ leg, style, onStop }: { leg: Leg; style: CSSProperties; onStop: (s: Stop) => void }) {
  const [open, setOpen] = useState(false);

  if (leg.kind === "walk") {
    const m = leg.metres ?? leg.minutes * 75;
    return (
      <button onClick={() => leg.onOpen(m)} style={style} className="col-start-3 my-3 ml-3 flex items-center gap-2 rounded-full border border-fg/30 py-2 pr-3 pl-3.5 text-left text-[14.5px] leading-5 font-light">
        <WalkIcon className="size-4.25 shrink-0" />
        Walk {Math.max(1, leg.minutes)} min · {m} m
        <ChevronRight className="ml-auto size-4.25 shrink-0" strokeWidth={1.5} />
      </button>
    );
  }

  if (leg.kind === "change") {
    return (
      <div style={style} className="col-start-3 my-3 ml-3 flex items-center gap-2 rounded-full border border-fg/30 py-2 pr-3.5 pl-3.5 text-[14.5px] leading-5 font-light">
        <WalkIcon className="size-4.25 shrink-0" />
        Change · {Math.max(1, leg.minutes)} min
      </div>
    );
  }

  const j = leg.section.journey!;
  const stops = j.passList.slice(1, -1);
  return (
    <div style={style} className={cn("col-start-3 pl-3", gone(leg) ? "pt-3 pb-4" : "pt-4 pb-4")}>
      <div className={cn("flex items-center gap-1.75", gone(leg) && "opacity-45")}>
        <ModeBadge category={j.category} />
        <LineLabel journey={j} />
        {!gone(leg) && <Capacity first={j.capacity1st} second={j.capacity2nd} className="ml-auto" />}
      </div>
      {!gone(leg) && <p className="mt-1.5 text-[14.5px] leading-snug font-light">Direction {j.to}</p>}
      {!gone(leg) && stops.length > 0 && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 flex items-center gap-[3.5px] text-[13px] font-light text-muted">
          {stops.length} stop{stops.length > 1 ? "s" : ""}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
      {open && (
        <ul className="mt-1.75 space-y-1.25">
          {stops.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] font-light text-fg/80">
              <span className="w-9.25 shrink-0 tabular-nums">{formatTime(p.departure ?? p.arrival)}</span>
              <StopButton checkpoint={p} onStop={onStop} />
            </li>
          ))}
        </ul>
      )}
      {!gone(leg) && leg.memory}
      {leg.instead}
    </div>
  );
}
