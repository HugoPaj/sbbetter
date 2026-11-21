"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { Connection, Journey, Section } from "@/lib/transport";
import { formatMinutes, formatTime, parseApiDuration } from "@/lib/format";
import { passTag, type Fare } from "@/lib/pricing";
import { ModeGlyph, PersonGlyph, WalkIcon, type Mode } from "./icons";
import { cn } from "./ui";

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
  const pass = fare?.pass;
  const j = firstJourney(connection);
  const walk = connection.accessWalk?.minutes ?? walkMinutes;
  const disruption = connection.disruptions?.[0];
  const dep = connection.from.prognosis?.departure ?? connection.from.departure;
  const delayed = (connection.from.delay ?? 0) > 0;
  return (
    <Link href={href} className="relative block overflow-hidden rounded-[19px] bg-surface px-[15px] pt-[15px] pb-[15px] transition-colors hover:bg-[#2b2b2b] light:hover:bg-[#f5f5f5]">
      {price !== undefined && (
        <span className="absolute top-0 right-0 z-0 flex h-[21px] items-baseline gap-[3.5px] pr-[12px] pl-3.5 text-[12px] leading-[21px] font-bold whitespace-nowrap before:absolute before:inset-0 before:-right-1.75 before:-z-10 before:origin-top before:skew-x-[14deg] before:rounded-bl-[7.5px] before:border-b before:border-l before:border-fg/40">
          {!pass && "from "}CHF <span className="text-[15.5px]">{price.toFixed(2)}</span>
          {/* What a travelcard leaves to pay; the connection page says for which stretch. */}
          {pass && <span className="font-light text-ok">{passTag(pass)}</span>}
        </span>
      )}
      <div className={cn("flex h-5 items-center gap-[5px]", price !== undefined && (pass ? "pr-[168px]" : "pr-[112px]"))}>
        {j ? (
          <>
            <ModeBadge category={j.category} />
            <LineLabel journey={j} />
            <span className="ml-[5.5px] truncate text-[16px] font-light tracking-tight">Direction {j.to}</span>
          </>
        ) : (
          <span className="text-[16px] font-light">Walk</span>
        )}
      </div>
      <div className="mt-[8.5px] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-[8.5px]">
          <WalkBadge minutes={walk} />
          <span className="text-[15.5px] font-bold tracking-[-0.04em] tabular-nums">{formatTime(connection.from.departure)}</span>
        </span>
        <Timeline connection={connection} />
        <span className="text-[15.5px] font-bold tracking-[-0.04em] tabular-nums">{formatTime(connection.to.arrival)}</span>
        {delayed && (
          <p className="col-span-2 col-start-2 -mt-1.25 text-[12px] text-sbb-red">
            +{connection.from.delay}&apos; expected {formatTime(dep)}
          </p>
        )}
        <div className="col-start-2 flex items-baseline justify-between gap-1.75">
          <Capacity first={connection.capacity1st} second={connection.capacity2nd} />
          <span className="ml-auto text-[16px] font-light whitespace-nowrap">{formatMinutes(parseApiDuration(connection.duration) + (walk ?? 0))}</span>
        </div>
      </div>
      {disruption && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] leading-tight text-sbb-red">
          <TriangleAlert className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{disruption.summary}</span>
        </p>
      )}
    </Link>
  );
}
