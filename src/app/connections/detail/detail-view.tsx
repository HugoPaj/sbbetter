"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightLeft, CalendarPlus, ChevronDown, ChevronRight, EllipsisVertical, FlaskConical, Share2, Star, Ticket, TriangleAlert } from "lucide-react";
import { Card, ErrorBox, Header, InfoLine, ListRow, OutlineButton, Overlap, PrimaryButton, Radio, RoundButton, Sheet, Spinner, cn, toast } from "@/components/ui";
import { DepartureBoard } from "@/components/plan/departure-board";
import { RouteMap } from "@/components/plan/route-map";
import { ItineraryIcon, LongArrow, MapPinIcon, WalkIcon } from "@/components/icons";
import { TripMap, lonLat, type LonLat, type Walk } from "./trip-map";
import { Capacity, LineLabel, ModeBadge } from "@/components/journey";
import { journeyFromSearchParams, journeyHref } from "@/lib/journey-query";
import { VerdictBanner } from "@/components/verdict-card";
import { connectionKey, loadConnection, rerouteFromSearchParams, rerouteParams } from "@/lib/connection-key";
import { SCENARIOS, assess, type LegStatus, type Scenario, type Verdict } from "@/lib/disruption";
import { formatDate, formatTime, zurichDateTime } from "@/lib/format";
import { priceConnection } from "@/lib/pricing";
import { useNovaFares } from "@/lib/fares";
import { USER } from "@/lib/mock-data";
import { actions, useAppState, useSetting } from "@/lib/store";
import type { Checkpoint, Connection, Disruption, Section } from "@/lib/transport";

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

export function DetailView() {
  const sp = useSearchParams();
  const raw = sp.toString();
  const query = journeyFromSearchParams(new URLSearchParams(raw));
  const key = sp.get("key");
  const router = useRouter();
  const [conn, setConn] = useState<Connection | null | undefined>(undefined);
  const { trips } = useAppState();
  const [sheet, setSheet] = useState<"more" | "sim" | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
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

  const fareOf = useNovaFares(conn ? [conn] : null, USER.halfFare);
  if (!query) return <ErrorBox message="No journey selected." />;

  const verdict = scenario && assessed.id === assessId ? assessed.verdict : null;
  const checking = !!scenario && !!conn && assessed.id !== assessId;
  const saved = trips.some((t) => t.id === tripId);
  const price = conn ? (priceConnection(conn, fareOf(conn), { halfFare: USER.halfFare })?.secondClass ?? null) : null;
  const fromLabel = query.fromName === "Current location" ? "Your chosen location" : query.fromName;
  const walk = conn?.accessWalk?.minutes ?? query.walkMinutes;

  const journeySections = conn?.sections.filter((s) => s.journey) ?? [];
  const firstDep = journeySections[0]?.departure.departureTimestamp ?? conn?.from.departureTimestamp;
  const walkStart = walk && firstDep ? formatTime(new Date((firstDep - walk * 60) * 1000).toISOString()) : "";
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
  const acceptAlternative = () => {
    const alt = verdict?.alternative;
    if (!alt || !conn) return;
    const altKey = connectionKey(alt.connection);
    const next = alt.rejoin
      ? {
          query,
          id: `${key ?? ""}~${altKey}`,
          params: rerouteParams({ from: alt.query.from, date: alt.query.date, time: alt.query.time, key: altKey, at: alt.rejoin.at, late: alt.rejoin.late }),
          departure: conn.from.departure ?? "",
        }
      : { query: alt.query, id: altKey, params: undefined, departure: alt.connection.from.departure ?? "" };
    if (saved) {
      actions.removeTrip(tripId);
      if (!trips.some((t) => t.id === next.id))
        actions.toggleTrip({
          id: next.id,
          query: next.query,
          index: 0,
          departure: next.departure,
          arrival: alt.connection.to.arrival ?? "",
          summary: [...(alt.rejoin ? conn.sections.slice(0, alt.rejoin.at + 1).filter((x) => x.journey).map((x) => `${x.journey!.category} ${x.journey!.number}`.trim()) : []), ...alt.connection.products].join(" → "),
          params: next.params,
        });
    }
    setScenario("");
    toast(saved ? "Trip updated with your new connection." : "Showing your new connection.");
    router.replace(journeyHref("/connections/detail", next.query, { key: alt.rejoin ? (key ?? "") : altKey, ...next.params }));
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

  // The alternative replaces the first leg that no longer works (cancelled or missed).
  const alt = verdict?.alternative;
  const insteadAt = Number(Object.entries(verdict?.notes ?? {}).find(([, st]) => st.kind !== "late")?.[0] ?? -1);
  const instead = alt && (
    <Instead
      connection={alt.connection}
      lateMinutes={alt.lateMinutes}
      href={journeyHref("/connections/detail", alt.query, { key: connectionKey(alt.connection) })}
      onAccept={acceptAlternative}
      onOthers={() => router.push(journeyHref("/connections", alt.query))}
    />
  );

  const mapMode = view === "map" && !!conn;
  const toggleView = () => {
    if (!conn) return toast("The connection is still loading.");
    window.scrollTo(0, 0);
    setView((v) => (v === "map" ? "list" : "map"));
  };
  const ring = mapMode ? "" : "ring-[5px] ring-black";

  return (
    <div className={mapMode ? "flex h-dvh flex-col overflow-hidden" : undefined}>
      <Header title="Connection" back extend />
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
            <Star className={cn("size-6", saved && "fill-white")} strokeWidth={1.1} />
          </RoundButton>
          <RoundButton label={mapMode ? "Show as list" : "Show on map"} className={ring} onClick={toggleView}>
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

      {conn === undefined && <Spinner />}
      {conn === null && <ErrorBox message="Could not load this connection." />}

      {conn && !mapMode && (
        <div className="mt-4 space-y-4.25 px-[8.5px]">
          <Itinerary
            header={
              checking || verdict || conn.disruptions?.length ? (
                <>
                  {checking && <p className="text-[14.5px] font-light text-muted">Checking your journey…</p>}
                  {verdict && <VerdictBanner verdict={verdict} />}
                  {conn.disruptions?.map((d, i) => <DisruptionNotice key={i} disruption={d} />)}
                </>
              ) : null
            }
            legs={[
              ...(walk
                ? [
                    {
                      kind: "walk" as const,
                      minutes: walk,
                      metres: conn.accessWalk?.metres,
                      start: { name: fromLabel, time: walkStart },
                      onOpen: (metres: number) =>
                        setWalkSheet({ minutes: walk, metres, from: fromLabel, to: journeySections[0]?.departure.station.name ?? "", a: origin, b: journeySections[0] ? lonLat(journeySections[0].departure) : null, track: conn.accessWalk?.track }),
                    },
                  ]
                : []),
              ...conn.sections.map((s, i): Leg =>
                s.journey
                  ? { kind: "ride", section: s, status: verdict ? verdict.notes[i] : reroute?.late && i === reroute.at ? { kind: "late", minutes: reroute.late } : undefined, instead: insteadAt === i ? instead : undefined }
                  : {
                      kind: "walk",
                      minutes: Math.round((s.walk?.duration ?? 0) / 60),
                      from: s.departure,
                      to: s.arrival,
                      onOpen: (metres: number) =>
                        setWalkSheet({
                          minutes: Math.round((s.walk?.duration ?? 0) / 60),
                          metres,
                          from: s.departure.station.name ?? "",
                          to: s.arrival.station.name ?? "",
                          a: lonLat(s.departure),
                          b: lonLat(s.arrival),
                          track: s.track,
                        }),
                    },
              ),
            ]}
            onStop={setBoard}
          />
        </div>
      )}
      {!mapMode && <div className="h-[calc(177px+var(--home-inset))]" />}

      {conn && !mapMode && price !== null && !verdict?.alternative && (
        <div className="fixed bottom-[calc(var(--home-inset)+94px)] left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 px-[8.5px]">
          <PrimaryButton href={journeyHref("/offers", query, { key: key ?? "", ...rParams })}>
            Tickets from&nbsp;<b className="font-bold">CHF {price.toFixed(2)}</b>
          </PrimaryButton>
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
            <ListRow icon={Ticket} label="Buy ticket" href={journeyHref("/offers", query, { key: key ?? "", ...rParams })} />
            <ListRow icon={FlaskConical} label="Simulate a disruption (demo)" onClick={() => setSheet("sim")} />
          </Card>
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

/** A live service message, shown at the head of the timeline. */
function DisruptionNotice({ disruption }: { disruption: Disruption }) {
  const [open, setOpen] = useState(false);
  const more = disruption.description || disruption.reason;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!more} className="flex w-full items-start gap-2.5 text-left">
        <TriangleAlert className="mt-px size-4.5 shrink-0 text-sbb-red" strokeWidth={2} />
        <span className="flex-1 text-[14.5px] leading-snug font-bold">{disruption.summary}</span>
        {more && <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />}
      </button>
      {open && more && <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-white/80">{more}</p>}
    </div>
  );
}

type Leg =
  | { kind: "ride"; section: Section; status?: LegStatus; instead?: ReactNode }
  | {
      kind: "walk";
      minutes: number;
      metres?: number | null;
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
  /** Arrival by a ride (shown above the departure when changing trains). */
  arr?: string;
  /** Expected arrival when the ride runs late. */
  arrLate?: string;
  dep?: string;
  /** The ride leaving from here won't be taken (cancelled or missed). */
  depGone?: boolean;
  arrPl?: string | null;
  depPl?: string | null;
  /** Arrival on foot: only shown when nothing departs from here. */
  at?: string;
  /** Short disruption label shown next to the stop name ("+11 min", "Missed"). */
  pill?: string;
};

type Item = { type: "node"; node: Node } | { type: "leg"; leg: Leg };

const platformLabel = (p: string | null | undefined, cat: string) => (p ? (["B", "M", "T"].includes(cat) ? `Stop ${p}` : `Pl. ${p}`) : null);
const keyOf = (c: Checkpoint) => c.station.id ?? c.station.name ?? "";
const gone = (leg?: Leg) => leg?.kind === "ride" && (leg.status?.kind === "cancelled" || leg.status?.kind === "missed");

/** Lay legs out as alternating nodes and segments, merging a leg's end into the next leg's start. */
function buildItems(legs: Leg[]): Item[] {
  const items: Item[] = [];
  let last: Node | null = null;
  const place = (n: Node) => {
    if (last && (last.key === n.key || last.name === n.name)) {
      last.dep ??= n.dep;
      last.depPl ??= n.depPl;
      last.depGone ||= n.depGone;
      last.pill ??= n.pill;
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
      place({ key: keyOf(s.departure), name: s.departure.station.name ?? "", checkpoint: s.departure, dep: formatTime(s.departure.departure), depGone: gone(leg), pill: status?.kind === "cancelled" ? "Cancelled" : status?.kind === "missed" ? "Missed" : undefined, depPl: platformLabel(s.departure.prognosis?.platform ?? s.departure.platform, cat) });
      items.push({ type: "leg", leg });
      last = null;
      const late = status?.kind === "late" && s.arrival.arrivalTimestamp ? formatTime(new Date((s.arrival.arrivalTimestamp + status.minutes * 60) * 1000).toISOString()) : undefined;
      place({ key: keyOf(s.arrival), name: s.arrival.station.name ?? "", checkpoint: s.arrival, arr: formatTime(s.arrival.arrival), arrLate: late, pill: status?.kind === "late" ? `+${status.minutes} min` : undefined, arrPl: platformLabel(s.arrival.prognosis?.platform ?? s.arrival.platform, cat) });
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
const lineStyle = (leg: Leg) =>
  leg.kind === "walk"
    ? "w-0 border-l-[3px] border-dotted border-white/55"
    : gone(leg)
      ? "w-0 border-l-[3px] border-dashed border-white/30"
      : leg.status?.kind === "late"
        ? "w-[3px] bg-sbb-red"
        : "w-[3px] bg-white";

/**
 * The whole journey as one continuous timeline: stops are dots, rides are solid
 * lines, walks are dotted lines. Disruptions are drawn on the legs they hit, and
 * a suggested alternative sits where the broken leg would have been.
 */
function Itinerary({ legs, header, onStop }: { legs: Leg[]; header?: ReactNode; onStop: (s: Stop) => void }) {
  const items = buildItems(legs);
  const nodes = items.filter((i) => i.type === "node");
  const legAt = (i: number) => (items[i]?.type === "leg" ? (items[i] as { leg: Leg }).leg : null);
  return (
    <Card className="overflow-hidden">
      {header && <div className="space-y-3 border-b border-line px-[15px] py-3.5">{header}</div>}
      <div className={cn(GRID, "px-[15px] py-[15px] text-[16px] tracking-tight")}>
        {items.map((item, i) => {
          if (item.type === "leg") return <Segment key={i} leg={item.leg} onStop={onStop} />;
          const n = item.node;
          const prev = legAt(i - 1);
          const next = legAt(i + 1);
          const end = item === nodes[0] || item === nodes.at(-1);
          const change = !!n.arr && !!n.dep;
          const strike = "text-muted line-through decoration-1";
          return (
            <Fragment key={i}>
              <span className="leading-5 tabular-nums">
                {n.arr && <span className={cn("block tracking-[-0.03em]", n.arrLate ? strike : change ? "font-light" : "font-bold")}>{n.arr}</span>}
                {n.arrLate && <span className="block font-bold tracking-[-0.04em] text-sbb-red">{n.arrLate}</span>}
                {n.dep && <span className={cn("block font-bold tracking-[-0.04em]", n.depGone && strike)}>{n.dep}</span>}
                {!n.arr && !n.dep && n.at && <span className="block font-bold tracking-[-0.04em]">{n.at}</span>}
              </span>
              <span className="relative">
                {prev && <span className={cn(LINE, "top-0 h-2.5", lineStyle(prev))} />}
                {next && <span className={cn(LINE, "top-2.5 bottom-0", lineStyle(next))} />}
                <span
                  className={cn(
                    "absolute top-2.5 left-1/2 -translate-1/2 rounded-full",
                    end ? "size-3.5 border-[3px] bg-surface" : "size-3 border-[2.5px] bg-surface",
                    n.arrLate ? "border-sbb-red" : "border-white",
                  )}
                />
              </span>
              <div className="flex items-start justify-between gap-1.75 pl-3 leading-5">
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.75 gap-y-1">
                  {n.checkpoint ? <StopButton checkpoint={n.checkpoint} onStop={onStop} className="font-bold" /> : <span className="font-bold">{n.name}</span>}
                  {n.pill && <span className="rounded-full bg-sbb-red px-1.75 text-[12px] leading-[18px] font-bold whitespace-nowrap text-white">{n.pill}</span>}
                </span>
                {(n.arrPl || n.depPl) && (
                  <span className="text-right whitespace-nowrap">
                    {n.arrPl && <span className={cn("block", change ? "font-light" : "font-bold")}>{n.arrPl}</span>}
                    {n.depPl && n.depPl !== n.arrPl && <span className={cn("block font-bold", n.depGone && "text-muted line-through decoration-1")}>{n.depPl}</span>}
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </Card>
  );
}

function Segment({ leg, onStop }: { leg: Leg; onStop: (s: Stop) => void }) {
  const [open, setOpen] = useState(false);
  const rail = (
    <span className="relative">
      <span className={cn(LINE, "inset-y-0", lineStyle(leg))} />
    </span>
  );

  if (leg.kind === "walk") {
    const m = leg.metres ?? leg.minutes * 75;
    return (
      <>
        <span />
        {rail}
        <button onClick={() => leg.onOpen(m)} className="my-3 ml-3 flex items-center gap-2 rounded-full border border-white/30 py-2 pr-3 pl-3.5 text-left text-[14.5px] leading-5 font-light">
          <WalkIcon className="size-4.25 shrink-0" />
          Walk {Math.max(1, leg.minutes)} min · {m} m
          <ChevronRight className="ml-auto size-4.25 shrink-0" strokeWidth={1.5} />
        </button>
      </>
    );
  }

  const j = leg.section.journey!;
  const stops = j.passList.slice(1, -1);
  return (
    <>
      <span />
      {rail}
      <div className={cn("pl-3", gone(leg) ? "pt-3 pb-3" : "pt-4 pb-4")}>
        <div className={cn(gone(leg) && "opacity-45")}>
          <div className="flex items-center gap-1.75">
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
                <li key={i} className="flex gap-2.5 text-[13px] font-light text-white/80">
                  <span className="w-9.25 shrink-0 tabular-nums">{formatTime(p.departure ?? p.arrival)}</span>
                  <StopButton checkpoint={p} onStop={onStop} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {leg.instead}
      </div>
    </>
  );
}

/** The recommended replacement, shown in place of the leg that no longer works. */
function Instead({ connection, lateMinutes, href, onAccept, onOthers }: { connection: Connection; lateMinutes: number; href: string; onAccept: () => void; onOthers: () => void }) {
  const rides = connection.sections.filter((s) => s.journey);
  return (
    <div className="mt-3.5 rounded-[15px] border border-white/25 bg-black/35 px-3 pt-3 pb-3.5">
      <p className="text-[12px] font-bold tracking-wide text-muted uppercase">Take instead</p>
      <ul className="mt-2 space-y-2.5">
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
              <p className="mt-0.5 pl-[49px] text-[13px] leading-snug font-light text-white/80">
                {s.departure.station.name} → {s.arrival.station.name}, {formatTime(s.arrival.arrival)}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[14.5px] leading-snug font-light">
        Arrive <b className="font-bold">{formatTime(connection.to.arrival)}</b>
        {lateMinutes > 0 && <span className="text-sbb-red"> · {lateMinutes} min later</span>}
      </p>
      <PrimaryButton onClick={onAccept} className="mt-3">
        Use this connection
      </PrimaryButton>
      <div className="mt-2.5 flex justify-center gap-5 text-[14px] font-light">
        <a href={href} className="underline underline-offset-2">
          Details
        </a>
        <button onClick={onOthers} className="underline underline-offset-2">
          Other connections
        </button>
      </div>
    </div>
  );
}
