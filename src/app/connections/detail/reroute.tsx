"use client";

import { Fragment, useState } from "react";
import { OtherConnectionSkeleton } from "@/components/skeletons";
import { PrimaryButton, Sheet, cn } from "@/components/ui";
import { WalkIcon } from "@/components/icons";
import { LineLabel, ModeBadge } from "@/components/journey";
import { connectionKey } from "@/lib/connection-key";
import { formatTime } from "@/lib/format";
import type { Checkpoint, Connection, Section } from "@/lib/transport";
import { LINE } from "./itinerary";
import { platformLabel } from "./timeline";

/**
 * Re-routing around a leg that no longer works: the suggested replacement shown
 * in its place ("Take instead"), and the other connections to pick from.
 */

/** The suggested replacement for a leg that no longer works. */
export type Box = {
  connection: Connection;
  lateMinutes: number;
  onAccept: () => void;
  onOthers: () => void;
};

/** The recommended replacement, shown in place of the leg that no longer works. */
export function Instead({ box }: { box: Box }) {
  const [open, setOpen] = useState(false);
  const rides = box.connection.sections.filter((s) => s.journey);
  return (
    <div className="mt-3.5 rounded-[15px] border border-fg/25 bg-page/35 px-3 pt-3 pb-3.5">
      <p className="text-[12px] font-bold tracking-wide text-muted uppercase">Take instead</p>
      <ul className={cn("mt-2 space-y-2.5", open && "hidden")}>
        {rides.map((s, i) => {
          const j = s.journey!;
          const pl = platformLabel(s.departure.prognosis?.platform ?? s.departure.platform, j.category);
          return (
            <li key={i}>
              <div className="flex items-center gap-1.75">
                <span className="w-[42px] shrink-0 text-[15.5px] leading-5 font-bold tracking-[-0.04em] tabular-nums">{formatTime(s.departure.departure)}</span>
                <ModeBadge category={j.category} />
                <LineLabel journey={j} />
                {pl && <span className="ml-auto text-[14.5px] font-bold whitespace-nowrap">{pl}</span>}
              </div>
              <p className="mt-0.5 pl-[49px] text-[13px] leading-snug font-light text-fg/80">
                to {s.arrival.station.name}
                {i < rides.length - 1 && `, ${formatTime(s.arrival.arrival)}`}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[14.5px] leading-snug font-light">
        Arrive <b className="font-bold">{formatTime(box.connection.to.arrival)}</b>
        {box.lateMinutes > 0 && <span className="text-muted"> · {box.lateMinutes} min later</span>}
      </p>
      {open && <MiniTimeline connection={box.connection} />}
      <PrimaryButton onClick={box.onAccept} className="mt-3">
        Use this connection
      </PrimaryButton>
      <div className="mt-2.5 flex justify-center gap-5 text-[14px] font-light">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="underline underline-offset-2">
          {open ? "Hide details" : "Details"}
        </button>
        <button onClick={box.onOthers} className="underline underline-offset-2">
          Other connections
        </button>
      </div>
    </div>
  );
}

/** Step-by-step view of a suggested connection, drawn like a small version of the main timeline. */
function MiniTimeline({ connection }: { connection: Connection }) {
  const secs = connection.sections;
  const plOf = (c: Checkpoint, s: Section) => (s.journey ? platformLabel(c.prognosis?.platform ?? c.platform, s.journey.category) : null);
  type Row = { kind: "stop"; name: string; time?: string; pl?: string | null; up?: Section; down?: Section } | { kind: "leg"; section: Section };
  const rows: Row[] = [];
  secs.forEach((s, i) => {
    if (i === 0) rows.push({ kind: "stop", name: s.departure.station.name ?? "", time: s.journey ? formatTime(s.departure.departure) : undefined, pl: plOf(s.departure, s), down: s });
    rows.push({ kind: "leg", section: s });
    const next = secs[i + 1];
    // Where one leg hands over to the next, show when the next ride leaves (walk times are only estimates).
    rows.push({
      kind: "stop",
      name: s.arrival.station.name ?? "",
      time: next?.journey ? formatTime(next.departure.departure) : s.journey ? formatTime(s.arrival.arrival) : undefined,
      pl: next?.journey ? plOf(next.departure, next) : plOf(s.arrival, s),
      up: s,
      down: next,
    });
  });
  const rail = (s: Section) => (s.journey ? "w-[2px] bg-fg" : "w-0 border-l-2 border-dotted border-fg/55");
  const last = rows.length - 1;

  return (
    <div className="mt-3 grid grid-cols-[42px_16px_minmax(0,1fr)] border-t border-fg/15 pt-3.5 text-[14.5px] tracking-tight">
      {rows.map((r, i) =>
        r.kind === "stop" ? (
          <Fragment key={i}>
            <span className="leading-5 font-bold tracking-[-0.04em] tabular-nums">{r.time}</span>
            <span className="relative">
              {r.up && <span className={cn(LINE, "top-0 h-2.5", rail(r.up))} />}
              {r.down && <span className={cn(LINE, "top-2.5 bottom-0", rail(r.down))} />}
              <span className={cn("absolute top-2.5 left-1/2 size-2.5 -translate-1/2 rounded-full border-2 border-fg", i === last ? "bg-fg" : "bg-[#141414] light:bg-white")} />
            </span>
            <span className="flex items-start justify-between gap-2 pl-2.5 leading-5">
              <span className="font-bold">{r.name}</span>
              {r.pl && <span className="font-bold whitespace-nowrap">{r.pl}</span>}
            </span>
          </Fragment>
        ) : (
          <Fragment key={i}>
            <span />
            <span className="relative">
              <span className={cn(LINE, "inset-y-0", rail(r.section))} />
            </span>
            <div className="py-2.5 pl-2.5 text-[13px] leading-snug font-light text-fg/80">
              {r.section.journey ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <ModeBadge category={r.section.journey.category} />
                    <LineLabel journey={r.section.journey} />
                  </div>
                  <p className="mt-1">
                    Direction {r.section.journey.to}
                    {r.section.journey.passList.length > 2 && ` · ${r.section.journey.passList.length - 2} stops`}
                  </p>
                </>
              ) : (
                <p className="flex items-center gap-1.5">
                  <WalkIcon className="size-3.5 shrink-0" />
                  Walk {Math.max(1, Math.round((r.section.walk?.duration ?? 0) / 60))} min
                </p>
              )}
            </div>
          </Fragment>
        ),
      )}
    </div>
  );
}

/** "Other connections": the next ones onward from where the suggestion starts, to pick instead of it. */
export function OtherConnectionsSheet({
  others,
  chosen,
  lateBy,
  onPick,
  onClose,
}: {
  others: Connection[] | "loading";
  /** The connection currently suggested or picked. */
  chosen: Connection | null | undefined;
  /** Minutes later than the planned arrival. */
  lateBy: (c: Connection) => number;
  onPick: (c: Connection) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Other connections" onClose={onClose}>
      {others === "loading" ? (
        <div role="status" aria-label="Loading other connections" className="space-y-2 pb-4">
          {[0, 1, 2, 3].map((i) => (
            <OtherConnectionSkeleton key={i} />
          ))}
        </div>
      ) : others.length === 0 ? (
        <p className="pb-4 text-[14.5px] font-light text-muted">No other connections found.</p>
      ) : (
        <div className="space-y-2 pb-4">
          {others.map((c) => {
            const k = connectionKey(c);
            const active = chosen && connectionKey(chosen) === k;
            // When the train leaves, not when the walk to it starts (matches the "Take instead" box).
            const ride = c.sections.find((x) => x.journey);
            const pl = ride && platformLabel(ride.departure.prognosis?.platform ?? ride.departure.platform, ride.journey!.category);
            return (
              <button
                key={k}
                onClick={() => onPick(c)}
                className={cn("flex w-full items-center gap-3 rounded-[15px] border px-3.5 py-3 text-left", active ? "border-fg" : "border-fg/25")}
              >
                <span className="w-[42px] shrink-0 text-[15.5px] font-bold tracking-[-0.04em] tabular-nums">{formatTime((ride ?? c.sections[0])?.departure.departure ?? c.from.departure)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-light">
                    {c.products.join(" → ")}
                    {pl && <span className="text-muted"> · {pl}</span>}
                  </span>
                  <span className="block text-[13px] font-light text-muted">
                    Arrive {formatTime(c.to.arrival)}
                    {lateBy(c) > 0 && ` · ${lateBy(c)} min later`}
                    {c.transfers > 0 && ` · ${c.transfers} change${c.transfers > 1 ? "s" : ""}`}
                  </span>
                </span>
                {active && <span className="text-[12px] font-bold text-muted">Selected</span>}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
