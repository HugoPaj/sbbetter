"use client";

import { Card, Skeleton, cn } from "./ui";

/**
 * Placeholders shaped like the content they stand in for, so the page keeps
 * its layout while connections and prices load. Each is hidden from screen
 * readers; the wrapper carries a single "Loading" status instead.
 */

function Loading({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}

/** A price tag in the top-right corner of a connection card, while its price loads. */
export function PriceTagSkeleton() {
  return (
    <span className="absolute top-0 right-0 z-0 flex h-[21px] items-center pr-[12px] pl-3.5 before:absolute before:inset-0 before:-right-1.75 before:-z-10 before:origin-top before:skew-x-[14deg] before:rounded-bl-[7.5px] before:border-b before:border-l before:border-fg/20">
      <Skeleton className="h-[11px] w-[74px]" />
    </span>
  );
}

/** One connection card (see ConnectionCard). */
export function ConnectionCardSkeleton({ price = true }: { price?: boolean }) {
  return (
    <div aria-hidden className="relative overflow-hidden rounded-[19px] bg-surface p-[15px]">
      {price && <PriceTagSkeleton />}
      <div className={cn("flex h-5 items-center gap-[5px]", price && "pr-[112px]")}>
        <Skeleton className="size-5 rounded-[1.5px]" />
        <Skeleton className="h-[15px] w-[46px]" />
        <Skeleton className="ml-[5.5px] h-[13px] w-[110px]" />
      </div>
      <div className="mt-[8.5px] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
        <Skeleton className="h-[15px] w-[40px]" />
        <div className="relative h-5">
          <span className="absolute top-1/2 right-0 left-0 h-[1.5px] -translate-y-1/2 animate-pulse bg-fg/10 motion-reduce:animate-none" />
        </div>
        <Skeleton className="h-[15px] w-[40px]" />
        <div className="col-start-2 flex items-center justify-between">
          <Skeleton className="h-[12px] w-[96px]" />
          <Skeleton className="h-[13px] w-[48px]" />
        </div>
      </div>
    </div>
  );
}

export function ConnectionListSkeleton({ count = 4, price = true }: { count?: number; price?: boolean }) {
  return (
    <Loading label="Loading connections" className="mt-px space-y-1.25 px-[8.5px] lg:px-0">
      {Array.from({ length: count }, (_, i) => (
        <ConnectionCardSkeleton key={i} price={price} />
      ))}
    </Loading>
  );
}

/** A "Leave 9 min later, save CHF 7.40" suggestion (see CheaperNearby). */
export function CheaperRowSkeleton() {
  return (
    <div role="status" aria-label="Looking for cheaper departures" className="flex items-center gap-3 px-[15px] py-3">
      <Skeleton className="size-5 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-[14px] w-[62%]" />
        <Skeleton className="h-[12px] w-[44%]" />
      </span>
    </div>
  );
}

/** A departure on the whole-day price list (see DayPrices). */
export function DayPriceRowSkeleton() {
  return (
    <li aria-hidden className="flex items-center gap-3 px-[15px] py-2.5">
      <span className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-[14px] w-[104px]" />
        <Skeleton className="h-[12px] w-[60%]" />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <Skeleton className="h-[14px] w-[72px]" />
        <Skeleton className="h-[11px] w-[54px]" />
      </span>
    </li>
  );
}

/** A connection's itinerary card (see Itinerary on the detail page). */
export function ItinerarySkeleton() {
  const stop = (w: string) => (
    <>
      <Skeleton className="h-[15px] w-[40px]" />
      <span className="flex justify-center pt-[3px]">
        <span className="size-3.5 animate-pulse rounded-full border-[3px] border-fg/15 motion-reduce:animate-none" />
      </span>
      <div className="flex items-start justify-between gap-2 pl-3">
        <Skeleton className={cn("h-[15px]", w)} />
        <Skeleton className="h-[13px] w-[38px]" />
      </div>
    </>
  );
  const leg = (
    <>
      <span />
      <span className="flex justify-center">
        <span className="w-[3px] animate-pulse bg-fg/10 motion-reduce:animate-none" />
      </span>
      <div className="space-y-2 py-4 pl-3">
        <div className="flex items-center gap-1.75">
          <Skeleton className="size-5 rounded-[1.5px]" />
          <Skeleton className="h-[15px] w-[46px]" />
          <Skeleton className="ml-auto h-[12px] w-[70px]" />
        </div>
        <Skeleton className="h-[13px] w-[52%]" />
      </div>
    </>
  );
  return (
    <Loading label="Loading connection" className="mt-4 px-[8.5px]">
      <Card className="overflow-hidden">
        <div aria-hidden className="grid grid-cols-[49.5px_20px_minmax(0,1fr)] px-[15px] py-[15px]">
          {stop("w-[58%]")}
          {leg}
          {stop("w-[46%]")}
          {leg}
          {stop("w-[52%]")}
        </div>
      </Card>
    </Loading>
  );
}

/** A row in the "Other connections" sheet. */
export function OtherConnectionSkeleton() {
  return (
    <div aria-hidden className="flex w-full items-center gap-3 rounded-[15px] border border-fg/15 px-3.5 py-3">
      <Skeleton className="h-[15px] w-[42px] shrink-0" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-[14px] w-[58%]" />
        <Skeleton className="h-[12px] w-[40%]" />
      </span>
    </div>
  );
}

/** The ticket offers while the connection and its price load (see OffersView). */
export function OffersSkeleton() {
  return (
    <Loading label="Loading prices" className="mt-4.25 px-[8.5px]">
      <Card className="overflow-hidden">
        <div className="flex gap-2.5 px-[15px] pt-[14.5px] pb-3.5">
          <Skeleton className="size-[19px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2.5">
              <Skeleton className="h-[16px] w-[120px]" />
              <Skeleton className="h-[15px] w-[70px]" />
            </div>
            <Skeleton className="h-[13px] w-[70%]" />
            <Skeleton className="h-[13px] w-[40%]" />
          </div>
        </div>
        <div className="ml-[44px] flex h-[53px] items-center gap-3 border-t border-surface-3 pr-[15px]">
          <Skeleton className="size-5 shrink-0 rounded-[4.5px]" />
          <Skeleton className="h-[15px] flex-1" />
          <Skeleton className="h-[15px] w-[80px]" />
        </div>
      </Card>
      <Skeleton className="mt-[14.5px] mb-2.5 ml-[8.5px] h-[12px] w-[110px]" />
      <div aria-hidden className="space-y-[8.5px]">
        {[0, 1].map((i) => (
          <div key={i} className="flex min-h-[51px] items-center gap-2.5 rounded-[19px] bg-surface px-[15px] py-2.5">
            <Skeleton className="size-[19px] shrink-0 rounded-full" />
            <Skeleton className="h-[15px] flex-1" />
            <Skeleton className="h-[15px] w-[70px]" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Rows of a departure board or a station search, while they load. */
export function ListRowsSkeleton({ count = 6, label, className, badge = true }: { count?: number; label: string; className?: string; badge?: boolean }) {
  // Varied widths, so the rows don't read as a striped pattern.
  const widths = ["w-[58%]", "w-[42%]", "w-[66%]", "w-[50%]", "w-[38%]", "w-[60%]"];
  return (
    <Loading label={label} className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="flex min-h-[44px] items-center gap-[8.5px] px-[15px] py-[8.5px]">
          {badge && <Skeleton className="h-[15px] w-[42px] shrink-0" />}
          <Skeleton className="size-5 shrink-0 rounded-[1.5px]" />
          <Skeleton className={cn("h-[14px]", widths[i % widths.length])} />
        </div>
      ))}
    </Loading>
  );
}
