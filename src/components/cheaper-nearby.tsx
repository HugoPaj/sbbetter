"use client";

import Link from "next/link";
import { CalendarSearch, ChevronRight, PiggyBank } from "lucide-react";
import { CHEAPER_PRIORITIES, type Cheaper, type CheaperPriority } from "@/lib/cheaper";
import { formatMinutes, formatTime, parseApiDuration } from "@/lib/format";
import { passSummary, type Quote } from "@/lib/pricing";
import type { Connection } from "@/lib/transport";
import { connectionKey } from "@/lib/connection-key";
import { Sheet, Skeleton, cn } from "./ui";

/** Why a departure is cheaper: the travelcard that covers it, or the product NOVA priced. */
const reason = (c: Connection, fare: Quote) => (fare.pass ? passSummary(fare.pass, { from: c.from.station.name, to: c.to.station.name }) : fare.secondName);

/**
 * "Leave 9 min later, save CHF 7.40": cheaper departures around the one the
 * traveller asked for. The switch on top says which one to suggest when there
 * are several (also under Advanced search); it is where its effect shows.
 * Without `onPriorityChange` there is nothing to choose between, so no switch.
 * The last row opens the whole day (DayPrices), for when the time is still open.
 * While departures around it are still being looked up or priced, the last row
 * says so: most searches turn up nothing cheaper, so no room is held for a
 * suggestion that may never come (the list below would jump when it didn't).
 */
export function CheaperNearby({
  items,
  hrefOf,
  priority,
  onPriorityChange,
  window,
  dayLabel,
  onOpenDay,
  loading = false,
}: {
  items: Cheaper[];
  hrefOf: (c: Connection) => string;
  priority: CheaperPriority;
  onPriorityChange?: (p: CheaperPriority) => void;
  /** How far around the requested connection was searched, in minutes. */
  window: number;
  dayLabel: string;
  onOpenDay: () => void;
  /** Nearby departures or their prices are still loading. */
  loading?: boolean;
}) {
  return (
    <section aria-label="Cheaper departures" aria-busy={loading} className="mb-1.25 divide-y divide-surface-3 overflow-hidden rounded-[19px] bg-surface">
      {loading && items.length === 0 && (
        <p role="status" className="sr-only">
          Looking for cheaper departures
        </p>
      )}
      {items.length > 0 && (
        <div className="flex items-center justify-between gap-2 py-2 pr-2 pl-[15px]">
          <h2 className="truncate text-[12.5px] font-light tracking-tight text-muted">Cheaper nearby</h2>
          {onPriorityChange ? (
            <div role="radiogroup" aria-label="Suggest" className="flex shrink-0 rounded-full border border-fg/15">
              {CHEAPER_PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  role="radio"
                  aria-checked={p.value === priority}
                  title={p.hint}
                  onClick={() => onPriorityChange(p.value)}
                  className={cn("h-[26px] rounded-full px-2.5 text-[12px] font-light tracking-tight whitespace-nowrap", p.value === priority ? "border border-fg/45 bg-surface-3" : "text-muted")}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="h-[26px] pr-2 text-[12px] leading-[26px] font-light tracking-tight whitespace-nowrap text-muted">
              Only {items.length > 1 ? "options" : "option"} within {formatMinutes(window)}
            </span>
          )}
        </div>
      )}
      {items.map(({ dir, connection: c, fare, saving, shift }) => {
        const why = reason(c, fare);
        return (
          <Link key={dir} href={hrefOf(c)} className="flex items-center gap-3 px-[15px] py-3 transition-colors hover:bg-fg/5">
            <PiggyBank className="size-5 shrink-0 text-ok" strokeWidth={1.5} />
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] leading-snug font-bold">
                Leave {formatMinutes(shift)} {dir}, save CHF {saving.toFixed(2)}
              </span>
              <span className="block truncate text-[13px] leading-snug font-light text-muted">
                {formatTime(c.from.departure)} → {formatTime(c.to.arrival)} · CHF {fare.secondClass.toFixed(2)}
                {why ? ` · ${why}` : ""}
              </span>
            </span>
            <ChevronRight className="size-4.5 shrink-0 text-muted" strokeWidth={1.5} />
          </Link>
        );
      })}
      <button onClick={onOpenDay} className="flex w-full items-center gap-3 px-[15px] py-2.5 text-left transition-colors hover:bg-fg/5">
        <CalendarSearch className="size-5 shrink-0 text-muted" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-light tracking-tight">{dayLabel}</span>
        {loading && items.length === 0 && (
          <span aria-hidden className="skeleton shrink-0 text-[12px] font-light tracking-tight text-muted">
            Comparing nearby…
          </span>
        )}
        <ChevronRight className="size-4.5 shrink-0 text-muted" strokeWidth={1.5} />
      </button>
    </section>
  );
}

/**
 * The whole day at a glance: every departure that costs less than the one the
 * traveller asked for, in order of departure. Fills in while the day is being
 * scanned and priced: the status line says what is still going on. How many
 * departures will turn out cheaper is unknown, so no placeholder rows.
 */
export function DayPrices({
  title,
  asked,
  askedFare,
  items,
  pending,
  lowest,
  scanning,
  hrefOf,
  onClose,
}: {
  title: string;
  asked: Connection;
  askedFare: Quote | null;
  items: Cheaper[];
  /** Departures whose price is still loading. */
  pending: number;
  lowest: number | null;
  scanning: boolean;
  hrefOf: (c: Connection) => string;
  onClose: () => void;
}) {
  const busy = scanning || pending > 0;
  // Already free (a travelcard covers it all): nothing can cost less, so say why instead of comparing.
  if (askedFare?.secondClass === 0) {
    const day = title === "Today" ? "today" : "that day";
    return (
      <Sheet title={`Cheapest times · ${title}`} onClose={onClose}>
        <p className="px-1 text-[14px] leading-snug font-light text-fg/85">
          Your {formatTime(asked.from.departure)} departure is {askedFare.pass ? `covered by your ${askedFare.pass.name}` : "free"}, so there&rsquo;s nothing to pay. No other time {day} can be cheaper.
        </p>
      </Sheet>
    );
  }
  return (
    <Sheet title={`Cheapest times · ${title}`} onClose={onClose}>
      <p className="px-1 text-[14px] leading-snug font-light text-fg/85">
        Your {formatTime(asked.from.departure)} departure costs {askedFare ? (
          <b className="font-bold">CHF {askedFare.secondClass.toFixed(2)}</b>
        ) : (
          <Skeleton className="inline-block h-[12px] w-[64px] align-middle" />
        )} in 2nd class.
        {!busy && (items.length ? ` ${items.length} ${items.length > 1 ? "departures cost" : "departure costs"} less.` : " No other departure that day costs less.")}
      </p>
      {busy && (
        <div role="status" className="mt-3 flex items-center gap-2.5 px-1 text-[13px] font-light text-muted">
          <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-fg/20 border-t-fg" />
          {scanning ? "Looking up the rest of the day…" : `Pricing ${pending} more ${pending > 1 ? "departures" : "departure"}…`}
        </div>
      )}
      {items.length > 0 && (
        <ul aria-busy={busy} className="mt-3 divide-y divide-surface-3 overflow-hidden rounded-[19px] bg-surface">
          {items.map(({ connection: c, fare, saving }) => {
            const why = reason(c, fare);
            const changes = c.transfers ? `${c.transfers} ${c.transfers > 1 ? "changes" : "change"}` : "direct";
            return (
              <li key={connectionKey(c)}>
                <Link href={hrefOf(c)} className="flex items-center gap-3 px-[15px] py-2.5 transition-colors hover:bg-fg/5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] leading-snug font-bold tabular-nums">
                      {formatTime(c.from.departure)} → {formatTime(c.to.arrival)}
                    </span>
                    <span className="block truncate text-[13px] leading-snug font-light text-muted">
                      {formatMinutes(parseApiDuration(c.duration))} · {changes}
                      {why ? ` · ${why}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("block text-[14.5px] leading-snug font-bold tabular-nums", fare.secondClass === lowest && "text-ok")}>CHF {fare.secondClass.toFixed(2)}</span>
                    <span className="block text-[12px] leading-snug font-light text-muted">save {saving.toFixed(2)}</span>
                  </span>
                  <ChevronRight className="size-4.5 shrink-0 text-muted" strokeWidth={1.5} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 px-1 text-[11px] leading-snug text-muted">Prices are live quotes: Supersaver tickets can sell out or change. The lowest price is shown in green.</p>
    </Sheet>
  );
}
