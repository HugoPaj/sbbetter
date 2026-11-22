"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Header, ErrorBox, Overlap, toast } from "@/components/ui";
import { ConnectionListSkeleton } from "@/components/skeletons";
import { ConnectionCard } from "@/components/journey";
import { CheaperNearby, DayPrices } from "@/components/cheaper-nearby";
import { JourneySearchCard } from "@/components/journey-search-card";
import { journeyFromSearchParams, journeyHref, toConnectionsRequest, type JourneyQuery } from "@/lib/journey-query";
import { getConnections, type Connection } from "@/lib/transport";
import { formatLongDate, formatShortDate, zurichDateTime } from "@/lib/format";
import { usePrices, useQuotes } from "@/lib/fares";
import { CHEAPER_SETTING, cheaperNearby, cheaperThatDay, fetchDay, fetchNearby, plannedAhead, searchWindow, type CheaperPriority } from "@/lib/cheaper";
import { useSetting } from "@/lib/store";
import { usePasses } from "@/lib/travelcards";
import { connectionKey, queryForConnection, rememberConnections, uniqueConnections } from "@/lib/connection-key";

type Result = {
  key: string;
  items: Connection[] | null;
  error: string | null;
  /** The connection the search was for: the first departure, or the last arrival of an arrive-by search. */
  asked: Connection | null;
  nearby: Connection[];
  /** Still looking up the departures around `asked`. */
  scanning: boolean;
  /** When the results arrived (epoch seconds): nothing earlier can still be caught. */
  since: number;
};

export function ConnectionsView() {
  const router = useRouter();
  const passes = usePasses();
  const sp = useSearchParams();
  const query = journeyFromSearchParams(new URLSearchParams(sp.toString()));
  const queryKey = sp.toString();

  // Results are tagged with the query they belong to, so a new query shows placeholders.
  // `asked` is the connection the search was for; `nearby` are departures around it
  // that aren't listed, fetched only to suggest a cheaper time to leave.
  const [result, setResult] = useState<Result>({ key: "", items: null, error: null, asked: null, nearby: [], scanning: false, since: 0 });
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState<"earlier" | "later" | null>(null);
  const [showPrices, setShowPrices] = useState(true);
  const [prefer, setPrefer] = useSetting<CheaperPriority>(CHEAPER_SETTING, "price");
  // Every departure of the day, scanned only when the traveller asks for the cheapest times.
  const [day, setDay] = useState<{ key: string; open: boolean; items: Connection[]; scanning: boolean } | null>(null);
  const dayScan = useRef<AbortController | null>(null);
  const moreCtrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(queryKey));
    if (!q) return;
    const ctrl = new AbortController();
    const key = `${queryKey}#${retry}`;
    getConnections({ ...toConnectionsRequest(q), limit: 6 }, ctrl.signal)
      .then(async (found) => {
        const items = uniqueConnections(found);
        rememberConnections(items);
        const asked = (q.isArrivalTime ? items.at(-1) : items[0]) ?? null;
        const since = Date.now() / 1000;
        setResult({ key, items, error: null, asked, nearby: [], scanning: !!asked, since });
        if (!asked) return;
        await fetchNearby(q, asked, items, since, (found) => {
          rememberConnections(found);
          setResult((r) => (r.key === key ? { ...r, nearby: [...r.nearby, ...found] } : r));
        }, ctrl.signal);
        setResult((r) => (r.key === key ? { ...r, scanning: false } : r));
      })
      .catch((e: Error) => e.name !== "AbortError" && setResult((r) => (r.key === key ? r : { key, items: null, error: "Could not load connections.", asked: null, nearby: [], scanning: false, since: 0 })));
    return () => {
      ctrl.abort();
      dayScan.current?.abort();
      moreCtrl.current?.abort();
      moreCtrl.current = null;
      setLoadingMore(null);
    };
  }, [queryKey, retry]);

  const current = result.key === `${queryKey}#${retry}`;
  const items = current ? result.items : null;
  const error = current ? result.error : null;
  const load = () => setRetry((n) => n + 1);
  // Only while its sheet is open: a closed sheet shouldn't keep spending the price API's quota.
  const dayItems = day?.key === result.key && day.open ? day.items : [];
  const priceOf = usePrices(items, passes);
  // Departures that are only compared with the requested one get a lighter price lookup (the price API is rate limited).
  const candidates = items ? [...items, ...result.nearby, ...dayItems] : [];
  const quoteOf = useQuotes(showPrices ? candidates : null, passes);

  if (!query) {
    return (
      <>
        <Header title="Connections" back="/plan" />
        <ErrorBox message="No journey selected." />
      </>
    );
  }

  const update = (q: JourneyQuery) => router.replace(journeyHref("/connections", q));

  async function more(dir: "earlier" | "later") {
    if (!items?.length || !query || loadingMore) return;
    // Results belong to this search: a new search (or a retry) aborts the request and drops its answer.
    const key = result.key;
    moreCtrl.current?.abort();
    const ctrl = new AbortController();
    moreCtrl.current = ctrl;
    setLoadingMore(dir);
    try {
      const anchor =
        dir === "later"
          ? new Date(((items.at(-1)!.from.departureTimestamp ?? 0) + 60) * 1000)
          : new Date(((items[0].from.departureTimestamp ?? 0) - 75 * 60) * 1000);
      const next = await getConnections({ ...toConnectionsRequest(query), ...zurichDateTime(anchor), isArrivalTime: false, limit: 5 }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      rememberConnections(next);
      const seen = new Set(items.map(connectionKey));
      const fresh = uniqueConnections(next).filter((c) => !seen.has(connectionKey(c)));
      if (!fresh.length) {
        toast(dir === "earlier" ? "No earlier connections." : "No later connections.");
        return;
      }
      setResult((r) => {
        if (r.key !== key || !r.items) return r;
        const have = new Set(r.items.map(connectionKey));
        const add = fresh.filter((c) => !have.has(connectionKey(c)));
        const merged = dir === "later" ? [...r.items, ...add] : [...add, ...r.items];
        return { ...r, items: merged.sort((a, b) => (a.from.departureTimestamp ?? 0) - (b.from.departureTimestamp ?? 0)) };
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast(`Could not load ${dir} connections.`);
    } finally {
      if (moreCtrl.current === ctrl) {
        moreCtrl.current = null;
        setLoadingMore(null);
      }
    }
  }

  // Suggestions under both priorities: the switch is only offered when they differ,
  // i.e. when there is more than one cheaper departure to choose between.
  const suggest = (p: CheaperPriority) =>
    showPrices && items && result.asked ? cheaperNearby(result.asked, [...items, ...result.nearby], quoteOf, { earliest: result.since, later: !query.isArrivalTime, prefer: p }) : [];
  const cheaper = suggest(prefer);
  const other = suggest(prefer === "price" ? "time" : "price");
  const hasChoice = cheaper.length !== other.length || cheaper.some((s, i) => connectionKey(s.connection) !== connectionKey(other[i].connection));
  const asked = showPrices && current ? result.asked : null;
  const ahead = !!asked && plannedAhead(asked, result.since);
  // Nothing cheaper yet, but departures around the asked one are still being looked up or priced.
  const cheaperLoading = !!asked && (result.scanning || [...(items ?? []), ...result.nearby].some((c) => quoteOf(c) === null));

  function openDay() {
    if (!asked) return;
    const key = result.key;
    if (day?.key === key) return setDay({ ...day, open: true });
    dayScan.current?.abort();
    const ctrl = (dayScan.current = new AbortController());
    setDay({ key, open: true, items: [], scanning: true });
    fetchDay(query!, asked, result.since, (found) => {
      rememberConnections(found);
      setDay((d) => (d?.key === key ? { ...d, items: [...d.items, ...found] } : d));
    }, ctrl.signal).finally(() =>
      setDay((d) => (d?.key === key ? { ...d, scanning: false } : d)),
    );
  }
  const dayOpen = asked && day?.open && day.key === result.key ? day : null;
  const detailHref = (c: Connection) => journeyHref("/connections/detail", queryForConnection(query, c), { key: connectionKey(c) });

  // Group by calendar day.
  const groups: { day: string; list: Connection[] }[] = [];
  for (const c of items ?? []) {
    const day = formatLongDate(new Date((c.from.departureTimestamp ?? 0) * 1000));
    const g = groups.at(-1);
    if (g?.day === day) g.list.push(c);
    else groups.push({ day, list: [c] });
  }

  // While the results load, the day searched for already stands where the first date will
  // (they are the same but for an arrive-by search just after midnight), so nothing moves.
  const firstDate = groups[0]?.day ?? (!items && !error && query.date ? formatLongDate(new Date(`${query.date}T12:00:00Z`)) : null);

  /** First date + "Earlier": under the search card on phones, above the results on desktop. */
  const firstDay = (className: string) =>
    firstDate && (
      <div className={className}>
        <h2 className="text-[15px] font-light tracking-tight">{firstDate}</h2>
        {groups[0] && (
          <button
            onClick={() => more("earlier")}
            disabled={loadingMore === "earlier"}
            className="flex h-6.75 items-center gap-[3.5px] rounded-full px-[8.5px] text-[12px] font-light text-muted hover:text-fg"
          >
            <ChevronUp className="size-3.5" strokeWidth={1.5} />
            {loadingMore === "earlier" ? "Loading…" : "Earlier"}
          </button>
        )}
      </div>
    );

  return (
    <div>
      <Header title="Connections" back="/plan" extend />
      {/* Desktop: the search stays put on the left while the results scroll on the right. */}
      <div className="lg:mx-auto lg:grid lg:max-w-[1160px] lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:px-8">
      {/* Phone: sticks exactly where it rests (header + 3.5px: it overlaps the 27.5px skirt by 24px), so the
          results scroll under it instead of the card sliding under the header and getting cut off. */}
      <Overlap className="sticky top-[calc(max(calc(var(--safe-top)+var(--top-gap)),6px)+46.5px)] lg:top-[88px] lg:px-0">
        {/* A copy of the header's red skirt pinned to the card: at rest it lies exactly on the real one, then it stays. */}
        <div aria-hidden className="absolute inset-x-0 -top-[3.5px] h-[27.5px] bg-gradient-to-b from-sbb-red to-[#db0000] lg:hidden" />
        {/* Page colour behind the rest of the card, so results scrolling under it never show around its rounded corners. */}
        <div aria-hidden className="absolute inset-x-0 top-6 bottom-0 bg-page lg:hidden" />
        {/* The search card rests on a darker tray that also carries the first date. */}
        <div className="relative rounded-[19px] bg-[#171717] light:bg-[#e4e4e4]">
          <JourneySearchCard query={query} onChange={update} showPrices={showPrices} onShowPricesChange={setShowPrices} />
          {firstDay("flex h-8.5 items-center justify-between pt-0.5 pr-1.75 pl-[15px] lg:hidden")}
        </div>
      </Overlap>

      <div className="lg:mt-6 lg:min-w-0">
      {firstDay("hidden h-8.5 items-center justify-between pr-1.75 pb-1.5 pl-[15px] lg:flex")}
      {error && <ErrorBox message={error} onRetry={load} />}
      {!items && !error && <ConnectionListSkeleton price={showPrices} />}
      {items?.length === 0 && <ErrorBox message="No connections found." />}

      {items && items.length > 0 && (
        <div className="mt-1.25 px-[8.5px] lg:mt-px lg:px-0">
          {asked && (
            <CheaperNearby
              items={cheaper}
              hrefOf={detailHref}
              priority={prefer}
              onPriorityChange={hasChoice ? setPrefer : undefined}
              window={searchWindow(asked, "price", result.since)}
              dayLabel={ahead ? `Cheapest times on ${formatShortDate(new Date((asked.from.departureTimestamp ?? 0) * 1000))}` : "Cheapest times today"}
              onOpenDay={openDay}
              loading={cheaperLoading}
            />
          )}
          {groups.map((g, gi) => (
            <section key={g.day}>
              {gi > 0 && <h2 className="px-[15px] pt-3.5 pb-[8.5px] text-[15px] font-light tracking-tight">{g.day}</h2>}
              <div className="space-y-1.25">
                {g.list.map((c) => (
                  <ConnectionCard key={connectionKey(c)} connection={c} walkMinutes={query.walkMinutes} fare={showPrices ? priceOf(c) : undefined} href={detailHref(c)} />
                ))}
              </div>
            </section>
          ))}
          <button
            onClick={() => more("later")}
            disabled={loadingMore === "later"}
            className="mx-auto mt-3.5 flex h-[32px] items-center gap-1.25 rounded-full border border-fg/50 bg-surface px-4.25 text-[14.5px] font-light transition-colors hover:bg-surface-2"
          >
            <ChevronDown className="size-4.25" strokeWidth={1.5} />
            {loadingMore === "later" ? "Loading…" : "Later connections"}
          </button>
        </div>
      )}
      </div>
      </div>
      <div className="h-[calc(112px+var(--home-inset))]" />
      {dayOpen && asked && (
        <DayPrices
          title={ahead ? formatLongDate(new Date((asked.from.departureTimestamp ?? 0) * 1000)) : "Today"}
          asked={asked}
          askedFare={quoteOf(asked)}
          {...cheaperThatDay(asked, candidates, quoteOf, result.since)}
          scanning={dayOpen.scanning}
          hrefOf={detailHref}
          onClose={() => setDay({ ...dayOpen, open: false })}
        />
      )}
    </div>
  );
}
