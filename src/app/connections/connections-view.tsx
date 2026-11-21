"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Header, ErrorBox, Overlap, Spinner } from "@/components/ui";
import { ConnectionCard } from "@/components/journey";
import { JourneySearchCard } from "@/components/journey-search-card";
import { journeyFromSearchParams, journeyHref, toConnectionsRequest, type JourneyQuery } from "@/lib/journey-query";
import { getConnections, type Connection } from "@/lib/transport";
import { formatLongDate, zurichDateTime } from "@/lib/format";
import { estimateFare } from "@/lib/pricing";
import { USER } from "@/lib/mock-data";
import { connectionKey, queryForConnection } from "@/lib/connection-key";

export function ConnectionsView() {
  const router = useRouter();
  const sp = useSearchParams();
  const query = journeyFromSearchParams(new URLSearchParams(sp.toString()));
  const queryKey = sp.toString();

  // Results are tagged with the query they belong to, so a new query shows a spinner.
  const [result, setResult] = useState<{ key: string; items: Connection[] | null; error: string | null }>({ key: "", items: null, error: null });
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState<"earlier" | "later" | null>(null);
  const [showPrices, setShowPrices] = useState(true);

  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(queryKey));
    if (!q) return;
    const ctrl = new AbortController();
    getConnections({ ...toConnectionsRequest(q), limit: 6 }, ctrl.signal)
      .then((items) => setResult({ key: `${queryKey}#${retry}`, items, error: null }))
      .catch(
        (e: Error) => e.name !== "AbortError" && setResult({ key: `${queryKey}#${retry}`, items: null, error: "Could not load connections." }),
      );
    return () => ctrl.abort();
  }, [queryKey, retry]);

  const current = result.key === `${queryKey}#${retry}`;
  const items = current ? result.items : null;
  const error = current ? result.error : null;
  const setItems = (fn: (cur: Connection[] | null) => Connection[]) => setResult((r) => ({ ...r, items: fn(r.items) }));
  const load = () => setRetry((n) => n + 1);

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
    if (!items?.length || !query) return;
    setLoadingMore(dir);
    try {
      const anchor =
        dir === "later"
          ? new Date(((items.at(-1)!.from.departureTimestamp ?? 0) + 60) * 1000)
          : new Date(((items[0].from.departureTimestamp ?? 0) - 75 * 60) * 1000);
      const next = await getConnections({ ...toConnectionsRequest(query), ...zurichDateTime(anchor), isArrivalTime: false, limit: 5 });
      setItems((cur) => {
        const seen = new Set(cur!.map(connectionKey));
        const fresh = next.filter((c) => !seen.has(connectionKey(c)));
        const merged = dir === "later" ? [...cur!, ...fresh] : [...fresh, ...cur!];
        return merged.sort((a, b) => (a.from.departureTimestamp ?? 0) - (b.from.departureTimestamp ?? 0));
      });
    } finally {
      setLoadingMore(null);
    }
  }

  // Group by calendar day.
  const groups: { day: string; list: Connection[] }[] = [];
  for (const c of items ?? []) {
    const day = formatLongDate(new Date((c.from.departureTimestamp ?? 0) * 1000));
    const g = groups.at(-1);
    if (g?.day === day) g.list.push(c);
    else groups.push({ day, list: [c] });
  }

  return (
    <div>
      <Header title="Connections" back="/plan" extend />
      <Overlap>
        {/* The search card rests on a darker tray that also carries the first date. */}
        <div className="rounded-[19px] bg-[#171717]">
          <JourneySearchCard query={query} onChange={update} showPrices={showPrices} onShowPricesChange={setShowPrices} />
          {groups[0] && (
            <div className="flex h-8.5 items-center justify-between pt-0.5 pr-1.75 pl-[15px]">
              <h2 className="text-[15px] font-light tracking-tight">{groups[0].day}</h2>
              <button
                onClick={() => more("earlier")}
                disabled={loadingMore === "earlier"}
                className="flex h-6.75 items-center gap-[3.5px] rounded-full px-[8.5px] text-[12px] font-light text-muted"
              >
                <ChevronUp className="size-3.5" strokeWidth={1.5} />
                {loadingMore === "earlier" ? "Loading…" : "Earlier"}
              </button>
            </div>
          )}
        </div>
      </Overlap>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!items && !error && <Spinner />}
      {items?.length === 0 && <ErrorBox message="No connections found." />}

      {items && items.length > 0 && (
        <div className="mt-px px-[8.5px]">
          {groups.map((g, gi) => (
            <section key={g.day}>
              {gi > 0 && <h2 className="px-[15px] pt-3.5 pb-[8.5px] text-[15px] font-light tracking-tight">{g.day}</h2>}
              <div className="space-y-1.25">
                {g.list.map((c) => {
                  const q = queryForConnection(query, c);
                  return (
                    <ConnectionCard
                      key={connectionKey(c)}
                      connection={c}
                      walkMinutes={query.walkMinutes}
                      price={showPrices ? estimateFare(c, { halfFare: USER.halfFare }).secondClass : undefined}
                      href={journeyHref("/connections/detail", q, { key: connectionKey(c) })}
                    />
                  );
                })}
              </div>
            </section>
          ))}
          <button
            onClick={() => more("later")}
            disabled={loadingMore === "later"}
            className="mx-auto mt-3.5 flex h-[32px] items-center gap-1.25 rounded-full border border-white/50 bg-surface px-4.25 text-[14.5px] font-light"
          >
            <ChevronDown className="size-4.25" strokeWidth={1.5} />
            {loadingMore === "later" ? "Loading…" : "Later connections"}
          </button>
        </div>
      )}
      <div className="h-[calc(109px+var(--home-inset))]" />
    </div>
  );
}
