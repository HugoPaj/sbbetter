"use client";

import { Fragment, useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import { ArrowRightLeft, CalendarPlus, ChevronDown, ChevronRight, EllipsisVertical, FlaskConical, Share2, Star, Ticket, TriangleAlert } from "lucide-react";
import { Card, ErrorBox, Header, InfoLine, ListRow, OutlineButton, Overlap, PrimaryButton, Radio, RoundButton, Sheet, Skeleton, cn, toast, useIsDesktop } from "@/components/ui";
import { ItinerarySkeleton, OtherConnectionSkeleton } from "@/components/skeletons";
import { DepartureBoard } from "@/components/plan/departure-board";
import { RouteMap } from "@/components/plan/route-map";
import { ItineraryIcon, LongArrow, MapPinIcon, WalkIcon } from "@/components/icons";
import { TripMap, lonLat, type LonLat, type Walk } from "./trip-map";
import { Capacity, DelayForecast, LineLabel, ModeBadge, useForecast } from "@/components/journey";
import { journeyFromSearchParams, journeyHref, toConnectionsRequest } from "@/lib/journey-query";
import { VerdictBanner } from "@/components/verdict-card";
import { connectionKey, loadConnection, queryForConnection, rerouteFromSearchParams, rerouteParams, stitch, uniqueConnections } from "@/lib/connection-key";
import { SCENARIOS, assess, type LegStatus, type Scenario, type Verdict } from "@/lib/disruption";
import { disruptionEnd } from "@/lib/disruption-forecast";
import { usePasses } from "@/lib/travelcards";
import { formatDate, formatTime, zurichDateTime } from "@/lib/format";
import { passNotice, type PassSaving } from "@/lib/pricing";
import { usePrices } from "@/lib/fares";
import { actions, useAppState, useSetting } from "@/lib/store";
import { getConnections, type Checkpoint, type Connection, type Disruption, type Section } from "@/lib/transport";

type Stop = { id: string; name: string };

/** "coord:lat,lon" → [lon, lat] */
function coordOf(id: string): LonLat | null {
  const m = /^coord:(-?[\d.]+),(-?[\d.]+)$/.exec(id);
  return m ? [Number(m[2]), Number(m[1])] : null;
}

function icsOf(conn: Connection, title: string, description: string): string {
  const stamp = (ts: number) => new Date(ts * 1000).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const start = conn.from.departureTimestamp ?? 0;
  const end = conn.to.arrivalTimestamp ?? start;
  const esc = (v: string) => v.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//sbb-travelers//prototype//EN",
    "BEGIN:VEVENT",
    `UID:${start}-${end}@sbb-travelers`,
    `DTSTAMP:${stamp(start)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(conn.from.station.name ?? "")}`,
    `DESCRIPTION:${esc(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** The current time in seconds, in 30 s steps so the timeline advances live (null on the server). */
function useNow(): number | null {
  return useSyncExternalStore(
    (tick) => {
      const id = setInterval(tick, 5000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 30000) * 30,
    () => null,
  );
}

export function DetailView() {
  const sp = useSearchParams();
  const raw = sp.toString();
  const query = journeyFromSearchParams(new URLSearchParams(raw));
  const key = sp.get("key");
  const router = useRouter();
  const [conn, setConn] = useState<Connection | null | undefined>(undefined);
  /** Delay model forecast per ride of `conn`, in minutes (keyed by section index). */
  const forecast = useForecast(conn);
  const passes = usePasses();
  const { trips } = useAppState();
  const [sheet, setSheet] = useState<"more" | "sim" | "time" | null>(null);
  const clock = useNow();
  /** Demo: a pretend "now" to preview the progress along the journey (More → "Simulate journey progress"). */
  const [simNow, setSimNow] = useState<number | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  // Desktop shows the itinerary and the map side by side, so there is no map mode to switch to.
  const desktop = useIsDesktop();
  const [topInset, setTopInset] = useState(0);
  /** Bottom edge of the summary card + buttons, measured from the top of the map. */
  const summaryRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setTopInset(el.offsetHeight + el.offsetTop));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [board, setBoard] = useState<Stop | null>(null);
  const [walkSheet, setWalkSheet] = useState<Walk | null>(null);
  /** A connection chosen under "Other connections", for the verdict it was picked under. */
  const [picked, setPicked] = useState<{ for: string; connection: Connection } | null>(null);
  const [others, setOthers] = useState<Connection[] | null | "loading">(null);
  /** The delay carried into a just-accepted re-route, until the URL catches up. */
  const [pendingLate, setPendingLate] = useState<{ at: number; late: number } | null>(null);

  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(raw));
    if (!q) return;
    const ctrl = new AbortController();
    loadConnection(q, new URLSearchParams(raw), ctrl.signal, { track: true })
      .then(setConn)
      .catch((e: Error) => e.name !== "AbortError" && setConn(null));
    return () => ctrl.abort();
  }, [raw, key]);

  // Demo: a simulated disruption for this connection (More → "Simulate a disruption").
  const reroute = rerouteFromSearchParams(new URLSearchParams(raw));
  const rParams = reroute ? rerouteParams(reroute) : undefined;
  const tripId = (key ?? "") + (reroute ? `~${reroute.key}` : "");
  const [scenario, setScenario] = useSetting<Scenario | "">(`sim:${tripId}`, "");
  const [assessed, setAssessed] = useState<{ id: string; verdict: Verdict | null }>({ id: "", verdict: null });
  const assessId = `${raw}#${scenario}`;

  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(raw));
    if (!conn || !q || !scenario) return;
    const ctrl = new AbortController();
    assess(conn, q, scenario, ctrl.signal)
      .then((verdict) => setAssessed({ id: assessId, verdict }))
      .catch((e: Error) => e.name !== "AbortError" && setAssessed({ id: assessId, verdict: null }));
    return () => ctrl.abort();
  }, [conn, raw, scenario, assessId]);

  const priceOf = usePrices(conn ? [conn] : null, passes);
  if (!query) return <ErrorBox message="No journey selected." />;

  const verdict = scenario && assessed.id === assessId ? assessed.verdict : null;
  const checking = !!scenario && !!conn && assessed.id !== assessId;
  const saved = trips.some((t) => t.id === tripId);
  const fare = conn ? priceOf(conn) : null;
  const price = fare?.secondClass ?? null;
  // What a travelcard changes about the ticket; not while a disruption says to take another route.
  const pass = !verdict?.alternative ? fare?.pass : undefined;
  /** The traveller's own trip needs no ticket: only upgrades and tickets for people travelling along are left to sell. */
  const covered = !!fare?.pass && price === 0;
  const offersHref = journeyHref("/offers", query, { key: key ?? "", ...rParams });
  const fromLabel = query.fromName === "Current location" ? "Your chosen location" : query.fromName;
  const walk = conn?.accessWalk?.minutes ?? query.walkMinutes;

  const journeySections = conn?.sections.filter((s) => s.journey) ?? [];
  const origin = coordOf(query.from);
  const title = `${fromLabel} → ${query.toName}`;

  const toggleSaved = () => {
    if (!conn) return toast("The connection is still loading.");
    actions.toggleTrip({ id: tripId, query, index: 0, departure: conn.from.departure ?? "", arrival: conn.to.arrival ?? "", summary: conn.products.join(" → "), params: rParams });
    toast(saved ? "Journey removed from your trips." : "Journey saved. You’ll find it under Trips.");
  };

  /**
   * Swap this journey for the recommended connection (and keep it saved if it was).
   * A missed change only replaces the legs from the change station on: the planned
   * legs before it stay, so the screen still shows the whole trip.
   */
  const acceptAlternative = (chosen: Connection) => {
    const alt = verdict?.alternative;
    if (!alt || !conn) return;
    const altKey = connectionKey(chosen);
    // The suggestion's own query re-fetches it; another pick needs a query anchored at its departure.
    const altQuery = chosen === alt.connection ? alt.query : queryForConnection(alt.query, chosen);
    const next = alt.rejoin
      ? {
          query,
          id: `${key ?? ""}~${altKey}`,
          params: rerouteParams({ from: altQuery.from, date: altQuery.date, time: altQuery.time, key: altKey, at: alt.rejoin.at, late: alt.rejoin.late }),
          departure: conn.from.departure ?? "",
        }
      : { query: altQuery, id: altKey, params: undefined, departure: chosen.from.departure ?? "" };
    if (saved) {
      actions.removeTrip(tripId);
      if (!trips.some((t) => t.id === next.id))
        actions.toggleTrip({
          id: next.id,
          query: next.query,
          index: 0,
          departure: next.departure,
          arrival: chosen.to.arrival ?? "",
          summary: [...(alt.rejoin ? conn.sections.slice(0, alt.rejoin.at + 1).filter((x) => x.journey).map((x) => `${x.journey!.category} ${x.journey!.number}`.trim()) : []), ...chosen.products].join(" → "),
          params: next.params,
        });
    }
    // Swap the plan in place first, so the missed legs morph into the new ones (shared stops
    // stay put, the rest fades), then sync the URL, which re-fetches the same trip.
    const swap = () => {
      setConn(alt.rejoin ? stitch(conn, chosen, alt.rejoin.at) : chosen);
      setPendingLate(alt.rejoin ? { at: alt.rejoin.at, late: alt.rejoin.late } : null);
      setPicked(null);
      setScenario("");
    };
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(() => flushSync(swap));
    else swap();
    toast(saved ? "Trip updated with your new connection." : "Showing your new connection.");
    router.replace(journeyHref("/connections/detail", next.query, { key: alt.rejoin ? (key ?? "") : altKey, ...next.params }), { scroll: false });
  };

  const legsText = (c: Connection) =>
    c.sections
      .filter((s) => s.journey)
      .map((s) => `${formatTime(s.departure.departure)} ${s.departure.station.name} – ${s.journey!.category} ${s.journey!.number} – ${formatTime(s.arrival.arrival)} ${s.arrival.station.name}`)
      .join("\n");

  async function share() {
    setSheet(null);
    const url = window.location.href;
    const text = conn ? `${title}\n${formatDate(new Date((conn.from.departureTimestamp ?? 0) * 1000))}, ${formatTime(conn.from.departure)} – ${formatTime(conn.to.arrival)}\n${legsText(conn)}` : title;
    try {
      if (navigator.share) await navigator.share({ title, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast("Connection copied to the clipboard.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Sharing is not available in this browser.");
    }
  }

  function addToCalendar() {
    if (!conn) return;
    setSheet(null);
    const url = URL.createObjectURL(new Blob([icsOf(conn, title, legsText(conn))], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "connection.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Calendar entry downloaded.");
  }

  /** Search the way back, leaving one hour after arrival. */
  function returnJourney() {
    if (!query) return;
    const from = origin && journeySections[0]?.departure.station.id ? { id: journeySections[0].departure.station.id, name: journeySections[0].departure.station.name ?? "" } : { id: query.from, name: query.fromName };
    const when = zurichDateTime(new Date(((conn?.to.arrivalTimestamp ?? 0) + 3600) * 1000));
    router.push(journeyHref("/connections", { ...query, from: query.to, fromName: query.toName, to: from.id, toName: from.name, ...when, isArrivalTime: false, walkMinutes: undefined }));
  }

  /** Timeline legs for sections [from, to) of a connection, with the walk from a coordinate origin first. */
  const legsOf = (c: Connection, opts: { to?: number; status?: (i: number) => LegStatus | undefined; note?: (i: number) => Note | undefined } = {}): Leg[] => {
    const rides = c.sections.filter((s) => s.journey);
    const w = c === conn ? walk : c.accessWalk?.minutes;
    const boardTs = rides[0]?.departure.departureTimestamp ?? c.from.departureTimestamp;
    const legs: Leg[] = [];
    if (w)
      legs.push({
        kind: "walk",
        minutes: w,
        metres: c.accessWalk?.metres,
        t0: boardTs ? boardTs - w * 60 : undefined,
        start: { name: fromLabel, time: boardTs ? formatTime(new Date((boardTs - w * 60) * 1000).toISOString()) : "" },
        onOpen: (metres) => setWalkSheet({ minutes: w, metres, from: fromLabel, to: rides[0]?.departure.station.name ?? "", a: origin, b: rides[0] ? lonLat(rides[0].departure) : null, track: c.accessWalk?.track }),
      });
    c.sections.slice(0, opts.to).forEach((s, i) => {
      const minutes = Math.round((s.walk?.duration ?? 0) / 60);
      legs.push(
        s.journey
          ? { kind: "ride", section: s, status: opts.status?.(i), depNote: opts.note?.(i), forecast: c === conn ? forecast?.[i] : undefined }
          : {
              kind: "walk",
              minutes,
              t0: s.departure.departureTimestamp ?? undefined,
              from: s.departure,
              to: s.arrival,
              onOpen: (metres) => setWalkSheet({ minutes, metres, from: s.departure.station.name ?? "", to: s.arrival.station.name ?? "", a: lonLat(s.departure), b: lonLat(s.arrival), track: s.track }),
            },
      );
    });
    return legs;
  };

  const carried = reroute ?? pendingLate;
  const statusAt = (i: number): LegStatus | undefined => (verdict ? verdict.notes[i] : carried?.late && i === carried.at ? { kind: "late", minutes: carried.late } : undefined);
  const lateTs = (i: number) => {
    const st = statusAt(i);
    return (conn?.sections[i]?.arrival.arrivalTimestamp ?? 0) + (st?.kind === "late" ? st.minutes * 60 : 0);
  };

  // A delay the change survives: say so at the change, with the time left.
  const changeNote = (i: number): Note | undefined => {
    if (!conn || !verdict || verdict.alternative) return;
    const lateIdx = Object.entries(verdict.notes).find(([, st]) => st.kind === "late")?.[0];
    if (lateIdx === undefined || i <= +lateIdx || conn.sections.findIndex((x, k) => k > +lateIdx && x.journey) !== i) return;
    const walkMin = conn.sections.slice(+lateIdx + 1, i).reduce((m, x) => m + Math.round((x.walk?.duration ?? 0) / 60), 0);
    const slack = Math.round(((conn.sections[i].departure.departureTimestamp ?? 0) - lateTs(+lateIdx)) / 60) - walkMin;
    return { text: `Change still works · ${slack} min`, tone: "ok" };
  };

  // The alternative continues the timeline from the last stop that still works (the change
  // station for a missed connection, the start for a cancelled first train).
  const alt = verdict?.alternative;
  const brokenAt = Number(Object.entries(verdict?.notes ?? {}).find(([, st]) => st.kind !== "late")?.[0] ?? -1);
  const chosen = (picked?.for === assessId && picked.connection) || alt?.connection;
  const lateBy = (c: Connection) => Math.max(0, Math.round(((c.to.arrivalTimestamp ?? 0) - (conn?.to.arrivalTimestamp ?? 0)) / 60));

  /** The next few connections onward from where the suggestion starts, at or after it. */
  async function showOthers() {
    if (!alt) return;
    setOthers("loading");
    try {
      const list = await getConnections({ ...toConnectionsRequest(alt.query), limit: 6 });
      const from = alt.connection.from.departureTimestamp ?? 0;
      setOthers(uniqueConnections(list.filter((c) => (c.from.departureTimestamp ?? 0) >= from)));
    } catch {
      setOthers(null);
      toast("Could not load other connections.");
    }
  }

  const box: Box | undefined =
    conn && alt && chosen && brokenAt >= 0
      ? { connection: chosen, lateMinutes: lateBy(chosen), onAccept: () => acceptAlternative(chosen), onOthers: showOthers }
      : undefined;
  const mainLegs = !conn
    ? []
    : legsOf(conn, { status: statusAt, note: changeNote }).map((l) =>
        box && l.kind === "ride" && l.section === conn.sections[brokenAt] ? { ...l, instead: <Instead box={box} /> } : l,
      );

  const mapMode = !desktop && view === "map" && !!conn;
  const toggleView = () => {
    if (!conn) return toast("The connection is still loading.");
    window.scrollTo(0, 0);
    document.getElementById("app-scroll")?.scrollTo(0, 0);
    setView((v) => (v === "map" ? "list" : "map"));
  };
  const ring = mapMode ? "" : "ring-[5px] ring-page";

  return (
    <div className={mapMode ? "flex h-(--app-h) flex-col overflow-hidden" : undefined}>
      <Header title="Connection" back extend />
      {/* Desktop: the itinerary is a column on the left; the map fills the rest (see <aside> below). */}
      <div className="contents lg:block lg:w-[520px] lg:px-4">
      <div className={mapMode ? "relative min-h-0 flex-1" : undefined}>
      {mapMode && <TripMap connection={conn} origin={origin} fromLabel={fromLabel} accessWalk={walk} topInset={Math.max(0, topInset - 24)} onWalk={setWalkSheet} />}
      <Overlap>
        <div ref={summaryRef}>
        <Card className="px-[15px] pt-3.5 pb-4">
          <p className="text-[16px] leading-snug font-bold">
            <span className="inline-block">
              {fromLabel} <LongArrow className="mx-1.25" />
            </span>{" "}
            <span className="inline-block">{query.toName}</span>
          </p>
        </Card>
        <div className="-mt-[13px] flex gap-[8.5px] px-[15px]">
          <RoundButton
            className={ring}
            label={saved ? "Remove from trips" : "Save trip"}
            onClick={toggleSaved}
          >
            <Star className={cn("size-6", saved && "fill-fg")} strokeWidth={1.1} />
          </RoundButton>
          <RoundButton label={mapMode ? "Show as list" : "Show on map"} className={cn(ring, "lg:hidden")} onClick={toggleView}>
            {mapMode ? <ItineraryIcon className="size-6" strokeWidth={1.1} /> : <MapPinIcon className="size-6" strokeWidth={1.1} />}
          </RoundButton>
          <div className="flex-1" />
          <RoundButton label="More" className={ring} onClick={() => setSheet("more")}>
            <EllipsisVertical className="size-6" strokeWidth={2} />
          </RoundButton>
        </div>
        </div>
      </Overlap>
      </div>

      {conn === undefined && <ItinerarySkeleton />}
      {conn === null && <ErrorBox message="Could not load this connection." />}

      {conn && !mapMode && (
        <div className="mt-4 space-y-4.25 px-[8.5px]">
          <Itinerary
            header={
              checking || verdict || conn.disruptions?.length || pass ? (
                <>
                  {checking && <p className="text-[14.5px] font-light text-muted">Checking your journey…</p>}
                  {verdict && <VerdictBanner verdict={verdict} />}
                  {!!conn.disruptions?.length && <DisruptionNotices disruptions={conn.disruptions} />}
                  {pass && <PassNotice pass={pass} trip={{ from: conn.from.station.name, to: conn.to.station.name }} />}
                </>
              ) : null
            }
            legs={mainLegs}
            now={simNow ?? clock}
            onStop={setBoard}
          />
        </div>
      )}
      {!mapMode && <div className="h-[calc(177px+var(--home-inset))]" />}
      </div>

      {desktop && conn && (
        <aside aria-label="Map" className="fixed top-16 right-0 bottom-0 left-[768px] overflow-hidden border-l border-fg/10 bg-[#111] light:bg-[#e9e9e9]">
          {/* Keyed by the connection: a re-route draws a new line. */}
          <TripMap key={connectionKey(conn)} connection={conn} origin={origin} fromLabel={fromLabel} accessWalk={walk} topInset={0} onWalk={setWalkSheet} />
        </aside>
      )}

      {conn && !mapMode && !verdict?.alternative && (
        <div className="fixed bottom-[calc(var(--home-inset)+94px)] left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 px-[8.5px] lg:left-[248px] lg:w-[520px] lg:max-w-none lg:translate-x-0 lg:px-[24.5px]">
          {price === null ? (
            <div role="status" aria-label="Loading price" className="flex h-[44px] w-full items-center justify-center rounded-full bg-surface-2 shadow-lg shadow-black/40">
              <Skeleton className="h-[14px] w-[150px] bg-fg/15" />
            </div>
          ) : covered ? (
            <OutlineButton href={offersHref} className="shadow-lg shadow-black/40">
              Class upgrade or co-travellers
            </OutlineButton>
          ) : (
            <PrimaryButton href={offersHref}>
              Tickets from&nbsp;<b className="font-bold">CHF {price.toFixed(2)}</b>
            </PrimaryButton>
          )}
        </div>
      )}

      {sheet === "more" && (
        <Sheet title="More" onClose={() => setSheet(null)}>
          <Card className="overflow-hidden">
            <ListRow icon={Share2} label="Share connection" onClick={share} />
            <ListRow icon={CalendarPlus} label="Add to calendar" onClick={() => (conn ? addToCalendar() : toast("The connection is still loading."))} />
            <ListRow
              icon={Star}
              label={saved ? "Remove from trips" : "Save trip"}
              onClick={() => {
                setSheet(null);
                toggleSaved();
              }}
            />
            <ListRow icon={ArrowRightLeft} label="Return journey" onClick={returnJourney} />
            <ListRow icon={Ticket} label={covered ? "Class upgrade or co-travellers" : "Buy ticket"} href={offersHref} />
            <ListRow icon={FlaskConical} label="Simulate a disruption (demo)" onClick={() => setSheet("sim")} />
            <ListRow icon={FlaskConical} label="Simulate journey progress (demo)" onClick={() => setSheet("time")} />
          </Card>
        </Sheet>
      )}
      {others !== null && (
        <Sheet title="Other connections" onClose={() => setOthers(null)}>
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
                    onClick={() => {
                      setPicked({ for: assessId, connection: c });
                      setOthers(null);
                    }}
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
      )}
      {sheet === "sim" && (
        <Sheet title="Simulate a disruption" onClose={() => setSheet(null)}>
          {SCENARIOS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                setScenario(o.value);
                setSheet(null);
              }}
              className="flex w-full items-center gap-3.5 py-2.5 text-left"
            >
              <Radio checked={scenario === o.value} />
              <span>
                <span className="block text-[16px] font-light tracking-tight">{o.label}</span>
                <span className="block text-[13px] font-light text-muted">{o.hint}</span>
              </span>
            </button>
          ))}
        </Sheet>
      )}
      {sheet === "time" && (
        <Sheet title="Simulate journey progress" onClose={() => setSheet(null)}>
          {[{ label: "Real time", at: null }, ...moments(buildItems(mainLegs))].map((o, i) => (
            <button
              key={i}
              onClick={() => {
                setSimNow(o.at);
                setSheet(null);
              }}
              className="flex w-full items-center gap-3.5 py-2.5 text-left"
            >
              <Radio checked={simNow === o.at} />
              <span>
                <span className="block text-[16px] font-light tracking-tight">{o.label}</span>
                <span className="block text-[13px] font-light text-muted">{o.at === null ? "Follows the clock." : formatTime(new Date(o.at * 1000).toISOString())}</span>
              </span>
            </button>
          ))}
        </Sheet>
      )}
      {walkSheet && (
        <Sheet title="Walk" onClose={() => setWalkSheet(null)}>
          {walkSheet.a && walkSheet.b && (
            <RouteMap
              lines={[{ coords: walkSheet.track ?? [walkSheet.a, walkSheet.b], walk: true }]}
              points={[
                { lon: walkSheet.a[0], lat: walkSheet.a[1], name: walkSheet.from, major: true },
                { lon: walkSheet.b[0], lat: walkSheet.b[1], name: walkSheet.to, major: true },
              ]}
              className="mb-4 h-[260px]"
            />
          )}
          <Card className="space-y-2 p-4">
            <InfoLine label="From" value={walkSheet.from} />
            <InfoLine label="To" value={walkSheet.to} />
            <InfoLine label="Distance" value={`${walkSheet.metres} m`} />
            <InfoLine label="Duration" value={`${walkSheet.minutes} min`} />
          </Card>
          {walkSheet.a && walkSheet.b && (
            <div className="mt-4">
              <OutlineButton
                href={`https://www.google.com/maps/dir/?api=1&origin=${walkSheet.a[1]},${walkSheet.a[0]}&destination=${walkSheet.b[1]},${walkSheet.b[0]}&travelmode=walking`}
              >
                Open walking directions
              </OutlineButton>
            </div>
          )}
        </Sheet>
      )}
      {board && <DepartureBoard stationId={board.id} stationName={board.name} onClose={() => setBoard(null)} />}
    </div>
  );
}

/** Station name that opens the stop's departure board. */
function StopButton({ checkpoint, onStop, className }: { checkpoint: Checkpoint; onStop: (s: Stop) => void; className?: string }) {
  const { id, name } = checkpoint.station;
  if (!id || !name) return <span className={className}>{name}</span>;
  return (
    <button onClick={() => onStop({ id, name })} className={cn("text-left", className)}>
      {name}
    </button>
  );
}

const GRID = "grid grid-cols-[49.5px_20px_minmax(0,1fr)]";

/** What the traveller's travelcard means for this trip's ticket, at the head of the timeline. */
function PassNotice({ pass, trip }: { pass: PassSaving; trip: { from: string | null; to: string | null } }) {
  const { headline, detail } = passNotice(pass, trip);
  return (
    <div className="flex items-start gap-2.5">
      <Ticket className="mt-px size-4.5 shrink-0 text-ok" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] leading-snug font-bold">{headline}</p>
        <p className="mt-0.5 text-[13px] leading-snug font-light text-fg/80">{detail}</p>
      </div>
    </div>
  );
}

/** A live service message, shown at the head of the timeline. */
/**
 * Live service messages at the head of the timeline: one alert row, however many there are.
 * Several collapse into "2 service alerts on your route", expanding to each summary.
 */
function DisruptionNotices({ disruptions }: { disruptions: Disruption[] }) {
  const [open, setOpen] = useState(false);
  const single = disruptions.length === 1;
  const more = (d: Disruption) => d.description || d.reason;
  const expandable = !single || !!more(disruptions[0]);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!expandable} className="flex w-full items-start gap-2.5 text-left">
        <TriangleAlert className="mt-px size-4.5 shrink-0 text-sbb-red" strokeWidth={2} />
        <span className="flex-1 text-[14.5px] leading-snug font-bold">{single ? disruptions[0].summary : `${disruptions.length} service alerts on your route`}</span>
        {expandable && <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />}
      </button>
      <LikelyOver disruptions={disruptions} />
      {open &&
        (single ? (
          <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-fg/80">{more(disruptions[0])}</p>
        ) : (
          <ul className="mt-2 space-y-2 pl-7">
            {disruptions.map((d, i) => (
              <li key={i} className="text-[13px] leading-snug">
                <p className="font-bold">{d.summary}</p>
                {more(d) && <p className="mt-0.5 font-light text-fg/80">{more(d)}</p>}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/** When the (first unplanned) disruption is likely over, from past disruptions with the same cause. */
function LikelyOver({ disruptions }: { disruptions: Disruption[] }) {
  const end = disruptions.map((d) => disruptionEnd(d)).find(Boolean);
  if (!end) return null;
  const at = (ms: number) => formatTime(new Date(ms).toISOString());
  return (
    <p className="mt-1 pl-7 text-[14.5px] leading-snug font-light">
      Likely over around {at(end.likely)}
      {end.sbb && end.sbb < end.likely && <span className="text-fg/60"> (SBB says {at(end.sbb)})</span>}
    </p>
  );
}

type Note = { text: string; tone: "muted" | "ok" };

type Leg =
  | {
      kind: "ride";
      section: Section;
      status?: LegStatus;
      /** Shown under the boarding stop. */ depNote?: Note;
      /** Replacement shown in place of this leg. */ instead?: ReactNode;
      /** Delay model forecast for the arrival, minutes (see DelayForecast). */ forecast?: number;
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
    };

/** A place on the timeline: where one leg ends and the next begins. */
type Node = {
  key: string;
  name: string;
  checkpoint?: Checkpoint;
  /** Arrival by a ride (the planned time when `arrLate` is set). */
  arr?: string;
  /** Expected arrival when it differs from the plan. */
  arrLate?: string;
  /** Show `arrLate` in red (a delay), not as a calm new time (a new plan). */
  delayed?: boolean;
  /** Delay model forecast for the arrival, minutes; only without a known delay. */
  forecast?: number;
  dep?: string;
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

type Item = { type: "node"; node: Node } | { type: "leg"; leg: Leg };

/** The suggested replacement for a leg that no longer works. */
type Box = {
  connection: Connection;
  lateMinutes: number;
  onAccept: () => void;
  onOthers: () => void;
};

/** Metro platform numbers aren't signposted for riders, so they're left out; bus/tram bays are. */
const platformLabel = (p: string | null | undefined, cat: string) => (!p || cat === "M" ? null : ["B", "T"].includes(cat) ? `Stop ${p}` : `Pl. ${p}`);
const keyOf = (c: Checkpoint) => c.station.id ?? c.station.name ?? "";

/**
 * Lay legs out as alternating nodes and segments, merging a leg's end into the
 * next leg's start. `after` continues from another list's last stop.
 */
function buildItems(legs: Leg[], after?: Node): Item[] {
  const items: Item[] = [];
  let last: Node | null = after ? { ...after, sentinel: true } : null;
  const place = (n: Node) => {
    if (last && (last.key === n.key || last.name === n.name) && !(last.sentinel && n.dep)) {
      last.dep ??= n.dep;
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
      const pill = status?.kind === "cancelled" ? "Cancelled" : status?.kind === "missed" ? "Missed" : undefined;
      place({ key: keyOf(s.departure), name: s.departure.station.name ?? "", checkpoint: s.departure, dep: formatTime(s.departure.departure), depGone: !!pill, pill, note: leg.depNote, depPl: platformLabel(s.departure.prognosis?.platform ?? s.departure.platform, cat) });
      items.push({ type: "leg", leg });
      last = null;
      const late = status?.kind === "late" && s.arrival.arrivalTimestamp ? formatTime(new Date((s.arrival.arrivalTimestamp + status.minutes * 60) * 1000).toISOString()) : undefined;
      place({ key: keyOf(s.arrival), name: s.arrival.station.name ?? "", checkpoint: s.arrival, arr: formatTime(s.arrival.arrival), arrLate: late, delayed: !!late, forecast: late ? undefined : leg.forecast, pill: late && `+${(status as { minutes: number }).minutes} min late`, arrPl: platformLabel(s.arrival.prognosis?.platform ?? s.arrival.platform, cat) });
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

const LINE = "absolute left-1/2 -translate-x-1/2";
/** Two rail styles only: solid for riding, dotted for walking. Travelled is bright, ahead is dimmed. */
const lineStyle = (leg: Leg) => (leg.kind === "walk" ? "w-0 border-l-[3px] border-dotted border-fg" : "w-[3px] bg-fg");
const legOf = (item?: Item) => (item?.type === "leg" ? item.leg : null);
const gone = (leg: Leg) => leg.kind === "ride" && (leg.status?.kind === "cancelled" || leg.status?.kind === "missed");
/** The "you are here" look, shared by the marker on a rail and the stop being waited at. */
const HERE = "ring-4 ring-fg/25";

type Span = { t0: number; t1: number; /** Never travelled: a leg that no longer works, or one after it. */ off: boolean };

/** When each leg runs, in seconds with delays applied. Aligned with `items`; null for nodes. */
function schedule(items: Item[]): (Span | null)[] {
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
    } else {
      t0 = Math.max(leg.t0 ?? end, end);
      t1 = t0 + leg.minutes * 60;
    }
    end = t1;
    return { t0, t1, off };
  });
}

/** Demo: points along the journey to preview the progress at. */
function moments(items: Item[]): { label: string; at: number }[] {
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
    out.push({ label: leg.kind === "ride" ? `On the ${leg.section.journey!.category} ${leg.section.journey!.number ?? ""}`.trim() : `Walking to ${nameAt(i + 1)}`, at: Math.round((s.t0 + s.t1) / 2) });
    const next = spans[i + 2];
    if (!next) out.push({ label: "Arrived", at: s.t1 });
    else if (next.off || next.t0 > s.t1) out.push({ label: `At ${nameAt(i + 1)}`, at: next.off ? s.t1 : Math.round((s.t1 + next.t0) / 2) });
  }
  return out;
}

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
/** A stable, unique view-transition name for each timeline row, so a re-route can morph between plans. */
function transitionNames(items: Item[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const base =
      it.type === "node"
        ? `n-${it.node.key}`
        : it.leg.kind === "ride"
          ? `r-${it.leg.section.journey!.category}${it.leg.section.journey!.number}-${keyOf(it.leg.section.departure)}`
          : `w-${it.leg.start ? "origin" : it.leg.from ? keyOf(it.leg.from) : ""}-${it.leg.to ? keyOf(it.leg.to) : ""}`;
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, "_");
    const n = (seen.get(clean) ?? 0) + 1;
    seen.set(clean, n);
    return `tl-${clean}-${n}`;
  });
}

function Itinerary({ legs, now, header, onStop }: { legs: Leg[]; /** Seconds; null until known. */ now: number | null; header?: ReactNode; onStop: (s: Stop) => void }) {
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
          // Boarding a missed/cancelled ride, or anywhere after it: no longer part of the trip.
          const off = brokenAt >= 0 && i >= brokenAt - 1;
          return (
            <Fragment key={i}>
              <span className={cn("col-start-1 leading-5 tabular-nums", off && "text-muted")} style={{ ...row, ...vt(i, "time") }}>
                {n.arr && <span className={cn("block tracking-[-0.03em]", n.arrLate ? "font-light text-muted line-through decoration-1" : change ? "font-light" : "font-bold")}>{n.arr}</span>}
                {n.arrLate && <span className={cn("block font-bold tracking-[-0.04em]", n.delayed && "text-sbb-red")}>{n.arrLate}</span>}
                <DelayForecast minutes={n.forecast} className="block leading-4" />
                {n.dep && <span className={cn("block font-bold tracking-[-0.04em]", n.depGone && "text-muted")}>{n.dep}</span>}
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
      {leg.instead}
    </div>
  );
}

/** The recommended replacement, shown in place of the leg that no longer works. */
function Instead({ box }: { box: Box }) {
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
