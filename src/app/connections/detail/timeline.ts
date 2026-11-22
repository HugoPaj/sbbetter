import type { ReactNode } from "react";
import type { LegStatus } from "@/lib/disruption";
import { formatTime } from "@/lib/format";
import type { Checkpoint, Section } from "@/lib/transport";

/**
 * The journey as a timeline, without the drawing: legs (rides, walks, changes)
 * laid out between the stops they connect, when each one runs, and points
 * along the way to preview the live progress at. Drawn by itinerary.tsx.
 */

/** A stop whose departure board can be opened. */
export type Stop = { id: string; name: string };

export type Note = { text: string; tone: "muted" | "ok" };

export type Leg =
  | {
      kind: "ride";
      section: Section;
      status?: LegStatus;
      /** Shown under the boarding stop. */ depNote?: Note;
      /** Replacement shown in place of this leg. */ instead?: ReactNode;
      /** Line memory for this train: the way round if its line closes. */ memory?: ReactNode;
      /** Delay model forecast for the arrival, minutes (see delayNote). */ forecast?: number;
    }
  | {
      kind: "walk";
      minutes: number;
      metres?: number | null;
      /** Planned start, in seconds. */
      t0?: number;
      /** Where the walk starts when it is not a station (the user's own location). */
      start?: { name: string; time: string };
      from?: Checkpoint;
      to?: Checkpoint;
      onOpen: (metres: number) => void;
    }
  | {
      /** Time between two trains at the same station. */
      kind: "change";
      minutes: number;
      /** Planned arrival of the train before, in seconds. */
      t0: number;
      at: Checkpoint;
    };

/** A place on the timeline: where one leg ends and the next begins. */
export type Node = {
  key: string;
  name: string;
  checkpoint?: Checkpoint;
  /** Arrival by a ride (the planned time when `arrLate` is set). */
  arr?: string;
  /** Expected arrival when it differs from the plan. */
  arrLate?: string;
  /** Show `arrLate` in red (a delay), not as a calm new time (a new plan). */
  delayed?: boolean;
  /** Where a ride arrives, for its live or forecast delay (see delayNote); not when a simulated delay says otherwise. */
  arrCp?: Checkpoint;
  /** Delay model forecast for the arrival, minutes. */
  forecast?: number;
  dep?: string;
  /** Where a ride leaves from, for its live delay. */
  depCp?: Checkpoint;
  /** The ride leaving from here won't be taken (cancelled or missed). */
  depGone?: boolean;
  arrPl?: string | null;
  depPl?: string | null;
  /** Arrival on foot: only shown when nothing departs from here. */
  at?: string;
  /** Short disruption label next to the stop name ("+11 min late"). */
  pill?: string;
  note?: Note;
  /** Stands in for the previous list's last stop; never rendered. */
  sentinel?: boolean;
};

export type Item = { type: "node"; node: Node } | { type: "leg"; leg: Leg };

/** Metro platform numbers aren't signposted for riders, so they're left out; bus/tram bays are. */
export const platformLabel = (p: string | null | undefined, cat: string) => (!p || cat === "M" ? null : ["B", "T"].includes(cat) ? `Stop ${p}` : `Pl. ${p}`);
export const keyOf = (c: Checkpoint) => c.station.id ?? c.station.name ?? "";

/**
 * Lay legs out as alternating nodes and segments, merging a leg's end into the
 * next leg's start. `after` continues from another list's last stop.
 */
export function buildItems(legs: Leg[], after?: Node): Item[] {
  const items: Item[] = [];
  let last: Node | null = after ? { ...after, sentinel: true } : null;
  const place = (n: Node) => {
    if (last && (last.key === n.key || last.name === n.name) && !(last.sentinel && n.dep)) {
      last.dep ??= n.dep;
      last.depCp ??= n.depCp;
      last.depPl ??= n.depPl;
      last.depGone ||= n.depGone;
      last.pill ??= n.pill;
      last.note ??= n.note;
      last.checkpoint ??= n.checkpoint;
    } else {
      last = n;
      items.push({ type: "node", node: n });
    }
  };

  for (const leg of legs) {
    if (leg.kind === "ride") {
      const { section: s, status } = leg;
      const cat = s.journey!.category;
      const pill = status?.kind === "cancelled" ? "Cancelled" : status?.kind === "missed" ? "Missed" : status?.kind === "closed" ? "Line closed" : undefined;
      place({ key: keyOf(s.departure), name: s.departure.station.name ?? "", checkpoint: s.departure, dep: formatTime(s.departure.departure), depCp: pill ? undefined : s.departure, depGone: !!pill, pill, note: leg.depNote, depPl: platformLabel(s.departure.prognosis?.platform ?? s.departure.platform, cat) });
      items.push({ type: "leg", leg });
      last = null;
      const late = status?.kind === "late" && s.arrival.arrivalTimestamp ? formatTime(new Date((s.arrival.arrivalTimestamp + status.minutes * 60) * 1000).toISOString()) : undefined;
      place({ key: keyOf(s.arrival), name: s.arrival.station.name ?? "", checkpoint: s.arrival, arr: formatTime(s.arrival.arrival), arrLate: late, delayed: !!late, arrCp: late ? undefined : s.arrival, forecast: leg.forecast, pill: late && `+${(status as { minutes: number }).minutes} min late`, arrPl: platformLabel(s.arrival.prognosis?.platform ?? s.arrival.platform, cat) });
    } else if (leg.kind === "change") {
      items.push({ type: "leg", leg });
      last = null;
      place({ key: keyOf(leg.at), name: leg.at.station.name ?? "", checkpoint: leg.at });
    } else {
      if (!leg.minutes && (!leg.from || !leg.to || keyOf(leg.from) === keyOf(leg.to))) continue;
      if (leg.start) place({ key: "origin", name: leg.start.name, dep: leg.start.time });
      else if (leg.from) place({ key: keyOf(leg.from), name: leg.from.station.name ?? "", checkpoint: leg.from });
      items.push({ type: "leg", leg });
      last = null;
      if (leg.to) place({ key: keyOf(leg.to), name: leg.to.station.name ?? "", checkpoint: leg.to, at: formatTime(leg.to.arrival) });
    }
  }
  return items;
}

export const legOf = (item?: Item) => (item?.type === "leg" ? item.leg : null);
export const gone = (leg: Leg) => leg.kind === "ride" && !!leg.status && leg.status.kind !== "late";

export type Span = { t0: number; t1: number; /** Never travelled: a leg that no longer works, or one after it. */ off: boolean };

/** When each leg runs, in seconds with delays applied. Aligned with `items`; null for nodes. */
export function schedule(items: Item[]): (Span | null)[] {
  let end = 0;
  let off = false;
  return items.map((item) => {
    if (item.type !== "leg") return null;
    const leg = item.leg;
    off ||= gone(leg);
    let t0: number, t1: number;
    if (leg.kind === "ride") {
      const { departure, arrival } = leg.section;
      t0 = Math.max(departure.departureTimestamp ?? end, end);
      t1 = Math.max((arrival.arrivalTimestamp ?? t0) + (leg.status?.kind === "late" ? leg.status.minutes * 60 : 0), t0);
    } else if (leg.kind === "change") {
      // A late arrival eats into the change; the next train still leaves on time.
      t0 = Math.max(leg.t0, end);
      t1 = Math.max(leg.t0 + leg.minutes * 60, t0);
    } else {
      t0 = Math.max(leg.t0 ?? end, end);
      t1 = t0 + leg.minutes * 60;
    }
    end = t1;
    return { t0, t1, off };
  });
}

/** Demo: points along the journey to preview the progress at. */
export function moments(items: Item[]): { label: string; at: number }[] {
  const spans = schedule(items);
  const nameAt = (i: number) => (items[i]?.type === "node" ? items[i].node.name : "");
  const out: { label: string; at: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const leg = legOf(items[i]);
    const s = spans[i];
    if (!leg || !s) continue;
    if (!out.length) out.push({ label: "Before departure", at: s.t0 - 60 });
    if (s.off) {
      if (out.length === 1) out.push({ label: `At ${nameAt(i - 1)}`, at: s.t0 });
      break;
    }
    out.push({ label: leg.kind === "ride" ? `On the ${leg.section.journey!.category} ${leg.section.journey!.number ?? ""}`.trim() : leg.kind === "change" ? `Changing at ${nameAt(i + 1)}` : `Walking to ${nameAt(i + 1)}`, at: Math.round((s.t0 + s.t1) / 2) });
    const next = spans[i + 2];
    if (!next) out.push({ label: "Arrived", at: s.t1 });
    else if (next.off || next.t0 > s.t1) out.push({ label: `At ${nameAt(i + 1)}`, at: next.off ? s.t1 : Math.round((s.t1 + next.t0) / 2) });
  }
  return out;
}

/** A stable, unique view-transition name for each timeline row, so a re-route can morph between plans. */
export function transitionNames(items: Item[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const base =
      it.type === "node"
        ? `n-${it.node.key}`
        : it.leg.kind === "ride"
          ? `r-${it.leg.section.journey!.category}${it.leg.section.journey!.number}-${keyOf(it.leg.section.departure)}`
          : it.leg.kind === "change"
            ? `c-${keyOf(it.leg.at)}`
            : `w-${it.leg.start ? "origin" : it.leg.from ? keyOf(it.leg.from) : ""}-${it.leg.to ? keyOf(it.leg.to) : ""}`;
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, "_");
    const n = (seen.get(clean) ?? 0) + 1;
    seen.set(clean, n);
    return `tl-${clean}-${n}`;
  });
}
