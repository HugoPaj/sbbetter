"use client";

import { useCallback, useEffect, useState } from "react";
import { useNow } from "@/lib/use-now";
import { useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import { EllipsisVertical, Star, Ticket as TicketIcon } from "lucide-react";
import { TicketSheet } from "@/components/ticket";
import { Card, ErrorBox, Header, OutlineButton, Overlap, PrimaryButton, RoundButton, Skeleton, cn, toast, useIsDesktop } from "@/components/ui";
import { ItinerarySkeleton } from "@/components/skeletons";
import { DepartureBoard } from "@/components/plan/departure-board";
import { ItineraryIcon, LongArrow, MapPinIcon } from "@/components/icons";
import { TripMap, lonLat, type Walk } from "./trip-map";
import { useForecast } from "@/components/journey";
import { journeyFromSearchParams, journeyHref, toConnectionsRequest } from "@/lib/journey-query";
import { VerdictBanner } from "@/components/verdict-card";
import { ClosureDetails, ClosureOutlook, ClosurePlanB, LegMemory, useRouteMemory } from "@/components/line-memory";
import { closureOf } from "@/lib/line-memory";
import { REPLAY_TRIP, showReplayPicker, useReplay, watchTrip } from "@/components/replay";
import { withReplay } from "@/lib/replay";
import { replayVerdict } from "@/lib/replay-verdict";
import { cachedConnection, connectionKey, loadConnection, queryForConnection, rememberConnections, rerouteFromSearchParams, rerouteParams, stitch, uniqueConnections } from "@/lib/connection-key";
import { assess, type LegStatus, type Scenario, type Verdict } from "@/lib/disruption";
import { usePasses } from "@/lib/travelcards";
import { formatTime, zurichDateTime } from "@/lib/format";
import { boardingStop } from "@/lib/trip-label";
import { usePrices } from "@/lib/fares";
import { coverageOf } from "@/lib/passes";
import { actions, useAppState, useSetting } from "@/lib/store";
import { getConnections, type Connection } from "@/lib/transport";
import { AlertsCards, AlertsLine, DisruptionNotices, PassNotice } from "./alerts";
import { Itinerary } from "./itinerary";
import { Instead, OtherConnectionsSheet, type Box } from "./reroute";
import { coordOf, downloadCalendarEntry, shareConnection } from "./share";
import { MoreSheet, SimulateDisruptionSheet, SimulateProgressSheet, WalkSheet } from "./sheets";
import { buildItems, keyOf, moments, type Leg, type Note, type Stop } from "./timeline";

/**
 * One connection: its timeline with live progress, alerts and line memory, the
 * map, and the demo disruptions with their re-routing. The pieces live next to
 * this file: timeline.ts (the model), itinerary.tsx (drawing it), alerts.tsx,
 * reroute.tsx, sheets.tsx and share.ts.
 */

export function DetailView() {
  const sp = useSearchParams();
  const raw = sp.toString();
  const query = journeyFromSearchParams(new URLSearchParams(raw));
  const key = sp.get("key");
  const router = useRouter();
  // Shown straight away when the list already had it (see cachedConnection), then refreshed
  // with live data and the path for the map; undefined only while there is nothing to show.
  const cached = cachedConnection(new URLSearchParams(raw));
  const [loaded, setLoaded] = useState<{ raw: string; conn: Connection | null } | null>(null);
  const liveConn = loaded?.raw === raw ? loaded.conn : (cached ?? undefined);
  /** Demo: a real disruption replayed on today's trains (see components/replay.tsx), as a service alert on this trip. */
  const replay = useReplay();
  const conn = withReplay(liveConn, replay);
  /** Delay model forecast per ride of `conn`, in minutes (keyed by section index). */
  const forecast = useForecast(liveConn);
  /** What happened the last times the stretches of this route were disrupted. */
  const routeMemory = useRouteMemory(conn);
  const passes = usePasses();
  const { trips, tickets, settings } = useAppState();
  const [sheet, setSheet] = useState<"more" | "sim" | "time" | null>(null);
  const [showTicket, setShowTicket] = useState(false);
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
    const sp = new URLSearchParams(raw);
    loadConnection(q, sp, ctrl.signal, { track: true })
      .then((c) => setLoaded({ raw, conn: c ?? cachedConnection(sp) }))
      .catch((e: Error) => e.name !== "AbortError" && setLoaded({ raw, conn: cachedConnection(sp) }));
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

  // Demo: a replayed real disruption that hits this trip gives the same kind of verdict, with the way round to take.
  const [replayAssessed, setReplayAssessed] = useState<{ raw: string; id: string; verdict: Verdict | null } | null>(null);
  const replayHit = !scenario && !!replay && !!conn?.disruptions?.some((d) => d.replay);
  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(raw));
    if (!replayHit || !conn || !q || !replay) return;
    const ctrl = new AbortController();
    replayVerdict(conn, q, replay, ctrl.signal)
      .then((verdict) => setReplayAssessed({ raw, id: replay.id, verdict }))
      .catch((e: Error) => e.name !== "AbortError" && setReplayAssessed({ raw, id: replay.id, verdict: null }));
    return () => ctrl.abort();
  }, [replayHit, conn, raw, replay]);

  // The replay follows the trip on screen: it is the one its notifications are about.
  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(raw));
    if (replay && liveConn && q) watchTrip({ conn: liveConn, query: q, href: `/connections/detail?${raw}` });
  }, [replay, liveConn, raw]);

  const priceOf = usePrices(conn ? [conn] : null, passes);
  if (!query) return <ErrorBox message="No journey selected." />;

  // While the next step of a replay is assessed, the last verdict for this trip stays up (no flicker).
  const replayed = replayHit && replayAssessed?.raw === raw ? replayAssessed.verdict : null;
  const verdict = scenario ? (assessed.id === assessId ? assessed.verdict : null) : replayed;
  const checking = (!!scenario && !!conn && assessed.id !== assessId) || (replayHit && replayAssessed?.raw !== raw);
  const saved = trips.some((t) => t.id === tripId);
  /** A still-valid ticket bought for this very journey (Offers links it): open it instead of buying again. */
  const ticket = tickets.find((k) => k.trip && (k.trip.id === tripId || k.trip.id === key) && (clock === null || Date.parse(k.validTo) >= clock * 1000));
  const fare = conn ? priceOf(conn) : null;
  const price = fare?.secondClass ?? null;
  /**
   * The traveller's own trip needs no ticket: only upgrades and tickets for people travelling along are left to sell.
   * Known from the travelcards alone, before any price has loaded.
   */
  const coverage = conn ? coverageOf(conn, passes) : null;
  const covered = fare ? !!fare.pass && price === 0 : !!coverage?.pass && coverage.parts.length === 0;
  // What a travelcard changes about the ticket; not while a disruption says to take another route.
  // A trip the card covers entirely is known before its price: the notice is there from the start
  // and only the saving fills in. Partly covered trips wait for prices, which may rule the card out.
  const pass = verdict?.alternative ? undefined : (fare?.pass ?? (!fare && covered && coverage?.pass ? { name: coverage.pass, several: coverage.several, tickets: [], through: null } : undefined));
  const offersHref = journeyHref("/offers", query, { key: key ?? "", ...rParams });
  const fromLabel = query.fromName === "Current location" ? "Your chosen location" : query.fromName;
  const walk = conn?.accessWalk?.minutes ?? query.walkMinutes;

  const journeySections = conn?.sections.filter((s) => s.journey) ?? [];
  const origin = coordOf(query.from);
  const title = `${fromLabel} → ${query.toName}`;

  const toggleSaved = () => {
    if (!conn) return toast("The connection is still loading.");
    actions.toggleTrip({ id: tripId, query, index: 0, departure: conn.from.departure ?? "", arrival: conn.to.arrival ?? "", summary: conn.products.join(" → "), fromStop: boardingStop(conn), params: rParams });
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
          params: rerouteParams({ from: altQuery.from, date: altQuery.date, time: altQuery.time, key: altKey, at: alt.rejoin.at, late: alt.rejoin.late, via: altQuery.via }),
          departure: conn.from.departure ?? "",
        }
      : { query: altQuery, id: altKey, params: undefined, departure: chosen.from.departure ?? "" };
    // The trip a replay follows (on the Plan page) becomes the new one.
    if (settings[REPLAY_TRIP] === tripId) actions.setSetting(REPLAY_TRIP, next.id);
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
          fromStop: boardingStop(conn),
          params: next.params,
        });
    }
    // Swap the plan in place first, so the missed legs morph into the new ones (shared stops
    // stay put, the rest fades), then sync the URL, which re-fetches the same trip.
    const swap = () => {
      // Remembered, so the URL change below keeps showing it while it is re-fetched.
      rememberConnections([chosen]);
      setLoaded({ raw, conn: alt.rejoin ? stitch(conn, chosen, alt.rejoin.at) : chosen });
      setPendingLate(alt.rejoin ? { at: alt.rejoin.at, late: alt.rejoin.late } : null);
      setPicked(null);
      setScenario("");
    };
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(() => flushSync(swap));
    else swap();
    toast(saved ? "Trip updated with your new connection." : "Showing your new connection.");
    router.replace(journeyHref("/connections/detail", next.query, { key: alt.rejoin ? (key ?? "") : altKey, ...next.params }), { scroll: false });
  };

  function share() {
    setSheet(null);
    void shareConnection(conn, title);
  }

  function addToCalendar() {
    if (!conn) return;
    setSheet(null);
    downloadCalendarEntry(conn, title);
  }

  /** Search the way back, leaving one hour after arrival. */
  function returnJourney() {
    if (!query) return;
    if (!conn?.to.arrivalTimestamp) return toast("The connection is still loading.");
    const from = origin && journeySections[0]?.departure.station.id ? { id: journeySections[0].departure.station.id, name: journeySections[0].departure.station.name ?? "" } : { id: query.from, name: query.fromName };
    const when = zurichDateTime(new Date((conn.to.arrivalTimestamp + 3600) * 1000));
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
      // Straight from one train to the next at the same station: show the change as its own step.
      const prev = legs.at(-1);
      if (s.journey && prev?.kind === "ride" && keyOf(prev.section.arrival) === keyOf(s.departure)) {
        const t0 = prev.section.arrival.arrivalTimestamp ?? undefined;
        const t1 = s.departure.departureTimestamp;
        if (t0 && t1 && t1 > t0) legs.push({ kind: "change", minutes: Math.round((t1 - t0) / 60), t0, at: s.departure });
      }
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
  // Line memory. A line closed right now (from the live service messages) is told inside the alert;
  // on a normal day each train carries the way round staff advised for its line.
  const liveClosure = conn && routeMemory && clock !== null ? closureOf(conn.disruptions, routeMemory.memory, clock * 1000, routeMemory.hits.map((h) => h.stretch)) : null;
  const quiet = !!routeMemory && !verdict && !checking && !liveClosure;
  const mainLegs = !conn
    ? []
    : legsOf(conn, { status: statusAt, note: changeNote }).map((l): Leg => {
        if (l.kind !== "ride") return l;
        return {
          ...l,
          instead: box && l.section === conn.sections[brokenAt] ? <Instead box={box} /> : undefined,
          memory: quiet ? <LegMemory route={routeMemory} section={conn.sections.indexOf(l.section)} conn={conn} query={query} /> : undefined,
        };
      });

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
      <Header title="Connection" back={journeyHref("/connections", query)} extend />
      {/* Desktop: the itinerary is a column on the left; the map fills the rest (see <aside> below). */}
      <div className="contents lg:block lg:w-[520px] lg:px-4">
      {/* List view: `contents`, so the summary below can stick across the whole page, not just this box. */}
      <div className={mapMode ? "relative min-h-0 flex-1" : "contents lg:block"}>
      {mapMode && <TripMap connection={conn} origin={origin} fromLabel={fromLabel} accessWalk={walk} topInset={Math.max(0, topInset - 24)} onWalk={setWalkSheet} />}
      {/* List view: the trip and its buttons stay in view; the itinerary scrolls under them. */}
      <Overlap sticky={!mapMode} className="lg:static">
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

      {conn === undefined && <ItinerarySkeleton from={fromLabel} to={query.toName} />}
      {conn === null && <ErrorBox message="Could not load this connection." />}

      {conn && !mapMode && (
        <div className="mt-4 space-y-4.25 px-[8.5px]">
          <Itinerary
            header={
              checking || verdict || conn.disruptions?.length || pass ? (
                <>
                  {checking && <p className="text-[14.5px] font-light text-muted">Checking your journey…</p>}
                  {verdict && (
                    // One card: the action is the headline, the alerts behind it a quiet line under it.
                    <VerdictBanner
                      verdict={verdict}
                      sub={!!conn.disruptions?.length && <AlertsLine disruptions={conn.disruptions} />}
                      // With alerts behind it, the banner stays two lines and the full story opens in a sheet.
                      sheet={
                        conn.disruptions?.length
                          ? {
                              title: "Disruption",
                              body: (
                                <>
                                  <AlertsCards disruptions={conn.disruptions} />
                                  {verdict.closure && routeMemory && <ClosureOutlook route={routeMemory} conn={conn} query={query} closure={verdict.closure} />}
                                </>
                              ),
                            }
                          : undefined
                      }
                      more={verdict.closure && routeMemory && <ClosureDetails route={routeMemory} conn={conn} query={query} closure={verdict.closure} offeredVia={verdict.alternative?.query.viaName} />}
                    />
                  )}
                  {!verdict && !!conn.disruptions?.length && (
                    <DisruptionNotices
                      disruptions={conn.disruptions}
                      // A verdict (simulated or replayed) already offers the way round in the timeline.
                      planB={!verdict && liveClosure && routeMemory && <ClosurePlanB route={routeMemory} conn={conn} query={query} closure={liveClosure} />}
                      details={!verdict && liveClosure && routeMemory && <ClosureDetails route={routeMemory} conn={conn} query={query} closure={liveClosure} />}
                    />
                  )}
                  {pass && <PassNotice pass={pass} pricing={!fare} trip={{ from: conn.from.station.name, to: conn.to.station.name }} />}
                </>
              ) : null
            }
            legs={mainLegs}
            now={simNow ?? clock}
            onStop={setBoard}
          />
        </div>
      )}
      {!mapMode && <div className="h-[calc(160px+var(--home-inset))]" />}
      </div>

      {desktop && conn && (
        <aside aria-label="Map" className="fixed top-16 right-0 bottom-0 left-[768px] overflow-hidden border-l border-fg/10 bg-[#111] light:bg-[#e9e9e9]">
          {/* Keyed by the connection: a re-route draws a new line. */}
          <TripMap key={connectionKey(conn)} connection={conn} origin={origin} fromLabel={fromLabel} accessWalk={walk} topInset={0} onWalk={setWalkSheet} />
        </aside>
      )}

      {conn && !mapMode && !verdict?.alternative && (
        <div className="fixed bottom-[calc(var(--home-inset)+77px)] left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 px-[8.5px] lg:left-[248px] lg:w-[520px] lg:max-w-none lg:translate-x-0 lg:px-[24.5px]">
          {/* The way to the tickets is there from the start; only the amount waits for the price lookup. */}
          {ticket ? (
            <PrimaryButton onClick={() => setShowTicket(true)}>
              <TicketIcon className="mr-2 size-4.5" strokeWidth={1.5} />
              Open ticket
            </PrimaryButton>
          ) : covered ? (
            <OutlineButton href={offersHref} className="shadow-lg shadow-black/40">
              Class upgrade or co-travellers
            </OutlineButton>
          ) : (
            <PrimaryButton href={offersHref}>
              {fare?.source === "estimate" ? "Tickets about" : "Tickets from"}&nbsp;
              <b className="flex items-center gap-[5px] font-bold" aria-busy={price === null}>
                {fare?.source === "estimate" && <abbr title="Estimated price" className="no-underline">≈</abbr>}CHF {price === null ? <Skeleton className="h-[13px] w-[38px] bg-white/45" /> : price.toFixed(2)}
              </b>
            </PrimaryButton>
          )}
        </div>
      )}

      {showTicket && ticket && <TicketSheet ticket={ticket} valid onClose={() => setShowTicket(false)} />}

      {sheet === "more" && (
        <MoreSheet
          saved={saved}
          covered={covered}
          offersHref={offersHref}
          onShare={share}
          onCalendar={() => (conn ? addToCalendar() : toast("The connection is still loading."))}
          onToggleSaved={() => {
            setSheet(null);
            toggleSaved();
          }}
          onReturn={returnJourney}
          onSimulate={() => setSheet("sim")}
          onProgress={() => setSheet("time")}
          onClose={() => setSheet(null)}
        />
      )}
      {others !== null && (
        <OtherConnectionsSheet
          others={others}
          chosen={chosen}
          lateBy={lateBy}
          onPick={(c) => {
            setPicked({ for: assessId, connection: c });
            setOthers(null);
          }}
          onClose={() => setOthers(null)}
        />
      )}
      {sheet === "sim" && (
        <SimulateDisruptionSheet
          scenario={scenario}
          onReplay={() => {
            setSheet(null);
            showReplayPicker();
          }}
          onPick={(value) => {
            setScenario(value);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "time" && (
        <SimulateProgressSheet
          moments={moments(buildItems(mainLegs))}
          at={simNow}
          onPick={(at) => {
            setSimNow(at);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {walkSheet && <WalkSheet walk={walkSheet} onClose={() => setWalkSheet(null)} />}
      {board && <DepartureBoard stationId={board.id} stationName={board.name} onClose={() => setBoard(null)} />}
    </div>
  );
}
