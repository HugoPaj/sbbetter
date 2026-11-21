"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IdCard, TriangleAlert } from "lucide-react";
import { forecastConnection } from "@/lib/connection-estimate";
import { connectionKey } from "@/lib/connection-key";
import { disruptionEnd } from "@/lib/disruption-forecast";
import type { Checkpoint, Connection, Journey, Section } from "@/lib/transport";
import { useNow } from "@/lib/use-now";
import { formatMinutes, formatTime, parseApiDuration } from "@/lib/format";
import { passTag, type Fare } from "@/lib/pricing";
import { ModeGlyph, PersonGlyph, WalkIcon, type Mode } from "./icons";
import { cn } from "./ui";
import { PriceTagSkeleton } from "./skeletons";

const TRAIN_CATS = new Set(["IC", "ICE", "ICN", "IR", "IRE", "RE", "R", "S", "SN", "EC", "EN", "TGV", "RJ", "RJX", "PE", "EXT", "ARZ", "NJ", "D"]);

export function modeOf(category: string): Mode {
  const c = category.toUpperCase();
  if (TRAIN_CATS.has(c)) return "train";
  if (c === "B" || c === "BUS" || c === "NFB" || c === "EV") return "bus";
  if (c === "T" || c === "TRAM" || c === "NFT") return "tram";
  if (c === "M") return "metro";
  if (c === "BAT" || c === "FAE" || c === "BAV") return "ship";
  if (["FUN", "GB", "PB", "SL", "CC"].includes(c)) return "cable";
  return "train";
}

/** Blue pictogram square (bus/train/…), loosely modeled on SBB pictograms. */
export function ModeBadge({ category, className }: { category: string; className?: string }) {
  const mode = modeOf(category);
  return (
    <span className={cn("relative inline-flex size-5 shrink-0 items-center justify-center rounded-[1.5px] bg-sbb-blue text-white", className)}>
      <ModeGlyph mode={mode} className="size-[88%]" />
      {mode === "metro" && <span className="absolute top-[3%] left-[10%] text-[4.5px] leading-none font-bold">Metro</span>}
    </span>
  );
}

/** "B 701", "M m1" or a boxed "RE33" for trains. */
export function LineLabel({ journey, className }: { journey: Pick<Journey, "category" | "number">; className?: string }) {
  const mode = modeOf(journey.category);
  if (mode === "train") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-[2.5px] border-[1.5px] border-current px-1.25 text-[15.5px] leading-[18px] font-bold whitespace-nowrap",
          className,
        )}
      >
        {journey.category}
        {journey.number}
      </span>
    );
  }
  return (
    <span className={cn("shrink-0 text-[17px] leading-5 font-bold whitespace-nowrap", className)}>
      {journey.category} {journey.number}
    </span>
  );
}

/** Three figures; `level` of them are highlighted (API: 1 low, 2 medium, 3 high). */
function Occupancy({ level }: { level: number | null }) {
  return (
    <span className="inline-flex items-end gap-px" aria-label={level ? `Occupancy ${level} of 3` : "Occupancy unknown"}>
      {[1, 2, 3].map((i) => (
        <PersonGlyph key={i} className={cn("h-[11px] w-[5px]", (level ?? 0) >= i ? "text-fg" : "text-fg/35")} />
      ))}
    </span>
  );
}

export function Capacity({ first, second, className }: { first: number | null; second: number | null; className?: string }) {
  if (!first && !second) return null;
  return (
    <span className={cn("inline-flex items-baseline gap-1.25 text-[16px] font-light whitespace-nowrap", className)}>
      1. <Occupancy level={first} /> <span className="ml-1.25">2.</span> <Occupancy level={second} />
    </span>
  );
}

function sectionStart(s: Section) {
  return s.departure.departureTimestamp ?? s.departure.arrivalTimestamp ?? 0;
}

/** Horizontal line with dots at departure, transfers and arrival. */
export function Timeline({ connection, className }: { connection: Connection; className?: string }) {
  const start = connection.from.departureTimestamp ?? 0;
  const end = connection.to.arrivalTimestamp ?? start + 1;
  const span = Math.max(1, end - start);
  const transfers = connection.sections
    .filter((s) => s.journey)
    .slice(1)
    .map((s) => (sectionStart(s) - start) / span);

  return (
    <div className={cn("relative h-5 min-w-0 flex-1", className)}>
      <div className="absolute top-1/2 right-[3.5px] left-[3.5px] h-[1.5px] -translate-y-1/2 bg-fg" />
      <span className="absolute top-1/2 left-0 size-2.5 -translate-y-1/2 rounded-full bg-fg" />
      {transfers.map((p, i) => (
        <span
          key={i}
          className="absolute top-1/2 size-[8.5px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg bg-surface"
          style={{ left: `${Math.min(90, Math.max(10, p * 100))}%` }}
        />
      ))}
      <span className="absolute top-1/2 right-0 size-2.5 -translate-y-1/2 rounded-full bg-fg" />
    </div>
  );
}

export function firstJourney(c: Connection): Journey | null {
  return c.sections.find((s) => s.journey)?.journey ?? null;
}

export function WalkBadge({ minutes }: { minutes?: number }) {
  if (!minutes) return null;
  return (
    <span className="inline-flex items-center text-fg">
      <WalkIcon className="-mr-px -ml-[2.5px] size-4.25" />
      <span className="text-[12px] font-light">{minutes}&apos;</span>
    </span>
  );
}

export function ConnectionCard({
  connection,
  href,
  fare,
  walkMinutes,
}: {
  connection: Connection;
  href: string;
  /** 2nd class price with the traveller's travelcards; null while loading, undefined to hide prices. */
  fare?: Fare | null;
  walkMinutes?: number;
}) {
  const price = fare?.secondClass;
  const pricing = fare === null;
  const pass = fare?.pass;
  const j = firstJourney(connection);
  const walk = connection.accessWalk?.minutes ?? walkMinutes;
  const disruption = connection.disruptions?.[0];
  const end = disruption ? disruptionEnd(disruption) : null;
  const forecast = useForecast(connection);
  const now = useNow();
  // Delays belong to the trains: boarding the first ride, getting off the last.
  const firstRide = connection.sections.findIndex((x) => x.journey);
  const lastRide = connection.sections.findLastIndex((x) => x.journey);
  const board = connection.sections[firstRide]?.departure;
  const alight = connection.sections[lastRide]?.arrival;
  const depNote = board && delayNote(board, "departure", { past: passed(board, "departure", now) });
  const arrNote = alight && delayNote(alight, "arrival", { forecast: forecast?.[lastRide], past: passed(alight, "arrival", now) });
  return (
    <Link href={href} className="relative block overflow-hidden rounded-[19px] bg-surface px-[15px] pt-[15px] pb-[15px] transition-colors hover:bg-[#2b2b2b] light:hover:bg-[#f5f5f5]">
      {pricing && <PriceTagSkeleton />}
      <div className={cn("flex h-5 items-center gap-[5px]", pricing && "pr-[112px]")}>
        {j ? (
          <>
            <ModeBadge category={j.category} />
            <LineLabel journey={j} />
            <span className="mr-2 ml-[5.5px] truncate text-[16px] font-light tracking-tight">Direction {j.to}</span>
          </>
        ) : (
          <span className="text-[16px] font-light">Walk</span>
        )}
        {/* In the row, pulled up into the card's corner. It never shrinks: only the direction gives
            way. A travelcard shows as a green card + amount; the connection page names the card. */}
        {price !== undefined && (
          <span
            title={pass ? passTag(pass) : undefined}
            className="relative z-0 -mt-[15px] -mr-[15px] ml-auto flex h-[21px] shrink-0 items-baseline gap-[3.5px] self-start pr-[12px] pl-3.5 text-[12px] leading-[21px] font-bold whitespace-nowrap before:absolute before:inset-0 before:-right-1.75 before:-z-10 before:origin-top before:skew-x-[14deg] before:rounded-bl-[7.5px] before:border-b before:border-l before:border-fg/40"
          >
            {pass && <IdCard aria-hidden className="size-[13px] self-center text-ok" strokeWidth={2} />}
            <span>{!pass && "from "}CHF</span>
            <span className={cn("text-[15.5px]", pass && "text-ok")}>{price.toFixed(2)}</span>
            {pass && <span className="sr-only">{passTag(pass)}</span>}
          </span>
        )}
      </div>
      <div className="mt-[8.5px] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-[8.5px]">
          <WalkBadge minutes={walk} />
          <span className="relative text-[15.5px] font-bold tracking-[-0.04em] tabular-nums">
            {formatTime(connection.from.departure)}
            <DelayLabel note={depNote ?? null} className="absolute top-full right-0 mt-1 leading-none" />
          </span>
        </span>
        <Timeline connection={connection} />
        {/* Each delay hangs under its time, in the otherwise empty corners of the row below, so a
            forecast arriving after the card never pushes the time or squeezes the timeline. */}
        <span className="relative text-[15.5px] font-bold tracking-[-0.04em] tabular-nums">
          {formatTime(connection.to.arrival)}
          <DelayLabel note={arrNote ?? null} className="absolute top-full right-0 mt-1 leading-none" />
        </span>
        <div className="col-start-2 flex items-baseline justify-between gap-1.75">
          <Capacity first={connection.capacity1st} second={connection.capacity2nd} />
          <span className="ml-auto text-[16px] font-light whitespace-nowrap">{formatMinutes(parseApiDuration(connection.duration) + (walk ?? 0))}</span>
        </div>
      </div>
      {disruption && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] leading-tight text-sbb-red">
          <TriangleAlert className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{disruption.summary}</span>
          {end && <span className="shrink-0">· likely over {formatTime(new Date(end.likely).toISOString())}</span>}
        </p>
      )}
    </Link>
  );
}

/** Below this a forecast is noise: times are shown to the minute, and SBB counts a train under 3 min late as on time. */
const FORECAST_MIN = 2;

/**
 * The one delay worth showing beside a time. `live`: what live data says the train will do;
 * `actual`: what it did, once the moment has passed; `est`: the delay model's forecast.
 */
export type DelayNote = { kind: "live" | "actual" | "est"; minutes: number; at?: string };

const minuteOf = (iso: string) => Math.floor(Date.parse(iso) / 60000);

/**
 * Picks the single delay to show for an arrival or departure, never an estimate next to a real one:
 * live data wins whenever there is any; once the moment has passed only live data counts (it is
 * what happened, on time included); the forecast fills in only for what is still to come, and
 * only when it is big enough to matter.
 */
export function delayNote(cp: Checkpoint, side: "arrival" | "departure", opts: { forecast?: number; past: boolean }): DelayNote | null {
  const planned = cp[side];
  const live = cp.prognosis?.[side];
  if (planned && live) {
    const minutes = minuteOf(live) - minuteOf(planned);
    return minutes > 0 ? { kind: opts.past ? "actual" : "live", minutes, at: formatTime(live) } : null;
  }
  if (opts.past || !opts.forecast || opts.forecast < FORECAST_MIN) return null;
  return { kind: "est", minutes: opts.forecast };
}

/** Has this arrival or departure happened by `now` (epoch seconds), live time first? */
export function passed(cp: Checkpoint, side: "arrival" | "departure", now: number | null): boolean {
  const at = cp.prognosis?.[side] ?? cp[side];
  return now !== null && !!at && now * 1000 >= Date.parse(at);
}

/** A DelayNote beside its time: real delays in red; a forecast says "Est." and turns red from 3 min. */
export function DelayLabel({ note, className }: { note: DelayNote | null; className?: string }) {
  if (!note) return null;
  const { kind, minutes: m, at } = note;
  const min = `${m} minute${m === 1 ? "" : "s"}`;
  const label = kind === "est" ? `likely up to ${min} late` : kind === "live" ? `expected ${min} late${at ? `, at ${at}` : ""}` : `${min} late${at ? `, at ${at}` : ""}`;
  return (
    <span
      className={cn(
        "text-[12px] font-bold tracking-normal whitespace-nowrap",
        kind !== "est" || m >= 3 ? "text-sbb-red" : "text-muted",
        // Only the forecast arrives later; live data is there with the connection.
        kind === "est" && "animate-fade-in",
        className,
      )}
      aria-label={label}
      title={kind === "est" ? `Forecast: likely up to ${m} min late` : at && `${kind === "live" ? "Expected" : "Actual time"} ${at}`}
    >
      {kind === "est" ? "Est. " : ""}+{m}
    </span>
  );
}

/** Delay forecasts for a connection's rides (see forecastConnection), once the model has loaded. */
export function useForecast(connection: Connection | null | undefined): Record<number, number> | null {
  const [state, setState] = useState<{ for: string; data: Record<number, number> } | null>(null);
  // By trip, not by object: a refreshed copy of the same trip keeps showing the forecast it had
  // until the new one is in, rather than blinking out and back.
  const key = connection ? connectionKey(connection) : null;
  useEffect(() => {
    if (!connection || !key) return;
    let live = true;
    forecastConnection(connection)
      .then((data) => live && setState({ for: key, data }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connection, key]);
  return state && state.for === key ? state.data : null;
}
