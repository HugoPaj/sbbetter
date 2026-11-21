"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightLeft, CalendarPlus, ChevronDown, ChevronRight, EllipsisVertical, FlaskConical, Share2, Star, Ticket, TriangleAlert } from "lucide-react";
import { Card, ErrorBox, Header, InfoLine, ListRow, OutlineButton, Overlap, PrimaryButton, Radio, RoundButton, Sheet, Spinner, cn, toast } from "@/components/ui";
import { DepartureBoard } from "@/components/plan/departure-board";
import { RouteMap, type RouteLine, type RoutePoint } from "@/components/plan/route-map";
import { LongArrow, MapPinIcon, WalkIcon } from "@/components/icons";
import { Capacity, LineLabel, ModeBadge, Timeline, WalkBadge } from "@/components/journey";
import { journeyFromSearchParams, journeyHref } from "@/lib/journey-query";
import { TONE_TEXT, VerdictCard } from "@/components/verdict-card";
import { connectionKey, fetchConnection } from "@/lib/connection-key";
import { SCENARIOS, assess, type Scenario, type Tone, type Verdict } from "@/lib/disruption";
import { formatDate, formatMinutes, formatTime, parseApiDuration, zurichDateTime } from "@/lib/format";
import { estimateFare } from "@/lib/pricing";
import { USER } from "@/lib/mock-data";
import { actions, useAppState, useSetting } from "@/lib/store";
import type { Checkpoint, Connection, Disruption, Section } from "@/lib/transport";

type LonLat = [number, number];
type Stop = { id: string; name: string };
type Walk = { minutes: number; metres: number; from: string; to: string; a: LonLat | null; b: LonLat | null };

const lonLat = (c: Checkpoint): LonLat | null => (c.station.coordinate.x && c.station.coordinate.y ? [c.station.coordinate.y, c.station.coordinate.x] : null);

/** "coord:lat,lon" → [lon, lat] */
function coordOf(id: string): LonLat | null {
  const m = /^coord:(-?[\d.]+),(-?[\d.]+)$/.exec(id);
  return m ? [Number(m[2]), Number(m[1])] : null;
}

/** Lines and stops of a connection for the route map. */
function routeOf(conn: Connection, origin: LonLat | null, originName: string): { lines: RouteLine[]; points: RoutePoint[] } {
  const lines: RouteLine[] = [];
  const points: RoutePoint[] = [];
  const first = conn.sections.find((s) => s.journey);
  const firstPos = first && lonLat(first.departure);
  if (origin && firstPos) {
    lines.push({ coords: [origin, firstPos], walk: true });
    points.push({ lon: origin[0], lat: origin[1], name: originName, major: true });
  }
  for (const s of conn.sections) {
    const a = lonLat(s.departure);
    const b = lonLat(s.arrival);
    if (!s.journey) {
      if (a && b) lines.push({ coords: [a, b], walk: true });
      continue;
    }
    const pass = s.journey.passList.length > 1 ? s.journey.passList : [s.departure, s.arrival];
    const coords = pass.map(lonLat).filter((c): c is LonLat => c !== null);
    lines.push({ coords });
    pass.forEach((p, i) => {
      const c = lonLat(p);
      if (c) points.push({ lon: c[0], lat: c[1], name: p.station.name ?? "", major: i === 0 || i === pass.length - 1 });
    });
  }
  return { lines, points };
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
  const [sheet, setSheet] = useState<"map" | "more" | "sim" | null>(null);
  const [board, setBoard] = useState<Stop | null>(null);
  const [walkSheet, setWalkSheet] = useState<Walk | null>(null);

  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(raw));
    if (!q) return;
    const ctrl = new AbortController();
    fetchConnection(q, key, ctrl.signal)
      .then(setConn)
      .catch((e: Error) => e.name !== "AbortError" && setConn(null));
    return () => ctrl.abort();
  }, [raw, key]);

  // Demo: a simulated disruption for this connection (More → "Simulate a disruption").
  const tripId = key ?? "";
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

  if (!query) return <ErrorBox message="No journey selected." />;

  const verdict = scenario && assessed.id === assessId ? assessed.verdict : null;
  const checking = !!scenario && !!conn && assessed.id !== assessId;
  const saved = trips.some((t) => t.id === tripId);
  const price = conn ? estimateFare(conn, { halfFare: USER.halfFare }).secondClass : null;
  const fromLabel = query.fromName === "Current location" ? "Your chosen location" : query.fromName;
  const walk = conn?.accessWalk?.minutes ?? query.walkMinutes;
  const totalMin = conn ? parseApiDuration(conn.duration) + (walk ?? 0) : 0;
  const isToday = conn && new Date((conn.from.departureTimestamp ?? 0) * 1000).toDateString() === new Date().toDateString();

  const journeySections = conn?.sections.filter((s) => s.journey) ?? [];
  const origin = coordOf(query.from);
  const title = `${fromLabel} → ${query.toName}`;

  const toggleSaved = () => {
    if (!conn) return toast("The connection is still loading.");
    actions.toggleTrip({ id: tripId, query, index: 0, departure: conn.from.departure ?? "", arrival: conn.to.arrival ?? "", summary: conn.products.join(" → ") });
    toast(saved ? "Journey removed from your trips." : "Journey saved. You’ll find it under Trips.");
  };

  /** Swap this journey for the recommended connection (and keep it saved if it was). */
  const acceptAlternative = () => {
    const alt = verdict?.alternative;
    if (!alt) return;
    const id = connectionKey(alt.connection);
    if (saved) {
      actions.removeTrip(tripId);
      if (!trips.some((t) => t.id === id))
        actions.toggleTrip({
          id,
          query: alt.query,
          index: 0,
          departure: alt.connection.from.departure ?? "",
          arrival: alt.connection.to.arrival ?? "",
          summary: alt.connection.products.join(" → "),
        });
    }
    setScenario("");
    toast(saved ? "Trip updated with your new connection." : "Showing your new connection.");
    router.replace(journeyHref("/connections/detail", alt.query, { key: id }));
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

  return (
    <div>
      <Header title="Connection" back extend />
      <Overlap>
        <Card className="px-[15px] pt-3.5 pb-3">
          <p className="text-[16px] leading-snug font-bold">
            <span className="inline-block">
              {fromLabel} <LongArrow className="mx-1.25" />
            </span>{" "}
            <span className="inline-block">{query.toName}</span>
          </p>
          {conn && (
            <>
              <div className="mt-1.5 flex items-center gap-3">
                <span className="flex items-center gap-[8.5px]">
                  <WalkBadge minutes={walk} />
                  <span className="text-[15.5px] font-bold tracking-[-0.04em] tabular-nums">{formatTime(conn.from.departure)}</span>
                </span>
                <Timeline connection={conn} />
                <span className="text-[15.5px] font-bold tracking-[-0.04em] tabular-nums">{formatTime(conn.to.arrival)}</span>
              </div>
              <p className="mt-1 text-[14.5px] font-light tracking-tight text-muted">
                {isToday ? "Today" : formatDate(new Date((conn.from.departureTimestamp ?? 0) * 1000))}, {formatMinutes(totalMin)}
              </p>
            </>
          )}
        </Card>
        <div className="-mt-[13px] flex gap-[8.5px] px-[15px]">
          <RoundButton
            className="ring-[5px] ring-black"
            label={saved ? "Remove from trips" : "Save trip"}
            onClick={toggleSaved}
          >
            <Star className={cn("size-6", saved && "fill-white")} strokeWidth={1.1} />
          </RoundButton>
          <RoundButton label="Map" className="ring-[5px] ring-black" onClick={() => (conn ? setSheet("map") : toast("The connection is still loading."))}>
            <MapPinIcon className="size-6" strokeWidth={1.1} />
          </RoundButton>
          <div className="flex-1" />
          <RoundButton label="More" className="ring-[5px] ring-black" onClick={() => setSheet("more")}>
            <EllipsisVertical className="size-6" strokeWidth={2} />
          </RoundButton>
        </div>
      </Overlap>

      {conn === undefined && <Spinner />}
      {conn === null && <ErrorBox message="Could not load this connection." />}

      {conn && (
        <div className="mt-4 space-y-4.25 px-[8.5px]">
          {checking && <Card className="px-[15px] py-3.5 text-[14.5px] font-light text-muted">Checking your journey…</Card>}
          {verdict && (
            <VerdictCard
              verdict={verdict}
              onAccept={acceptAlternative}
              onOthers={() => verdict.alternative && router.push(journeyHref("/connections", verdict.alternative.query))}
            />
          )}
          {conn.disruptions?.map((d, i) => <DisruptionCard key={i} disruption={d} />)}
          {walk ? (
            <>
              <Card className="flex h-[50px] items-center px-[15px] text-[16px] font-bold">{fromLabel}</Card>
              <WalkRow
                minutes={walk}
                metres={conn.accessWalk?.metres}
                onOpen={(metres) =>
                  setWalkSheet({ minutes: walk, metres, from: fromLabel, to: journeySections[0]?.departure.station.name ?? "", a: origin, b: journeySections[0] ? lonLat(journeySections[0].departure) : null })
                }
              />
            </>
          ) : null}
          {conn.sections.map((s, i) =>
            s.journey ? (
              <SectionCard key={i} section={s} first={s === journeySections[0]} last={s === journeySections.at(-1)} onStop={setBoard} note={verdict?.notes[i]} />
            ) : (
              <WalkRow
                key={i}
                minutes={Math.round((s.walk?.duration ?? 0) / 60)}
                onOpen={(metres) =>
                  setWalkSheet({
                    minutes: Math.round((s.walk?.duration ?? 0) / 60),
                    metres,
                    from: s.departure.station.name ?? "",
                    to: s.arrival.station.name ?? "",
                    a: lonLat(s.departure),
                    b: lonLat(s.arrival),
                  })
                }
              />
            ),
          )}
        </div>
      )}
      <div className="h-[calc(177px+var(--home-inset))]" />

      {conn && price !== null && (
        <div className="fixed bottom-[calc(var(--home-inset)+94px)] left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 px-[8.5px]">
          <PrimaryButton href={journeyHref("/offers", query, { key: key ?? "" })}>
            Tickets from&nbsp;<b className="font-bold">CHF {price.toFixed(2)}</b>
          </PrimaryButton>
        </div>
      )}

      {sheet === "map" && conn && (
        <Sheet title={title} onClose={() => setSheet(null)} full>
          <RouteMap {...routeOf(conn, origin, fromLabel)} className="h-[calc(100dvh-190px)]" />
          <p className="mt-2 px-1 text-[12px] font-light text-muted">Red: public transport · blue dashed: on foot. Lines connect the stops and are not the exact track.</p>
        </Sheet>
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
            <ListRow icon={Ticket} label="Buy ticket" href={journeyHref("/offers", query, { key: key ?? "" })} />
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
              lines={[{ coords: [walkSheet.a, walkSheet.b], walk: true }]}
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

function DisruptionCard({ disruption }: { disruption: Disruption }) {
  const [open, setOpen] = useState(false);
  const more = disruption.description || disruption.reason;
  return (
    <Card className="px-[15px] py-3">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!more} className="flex w-full items-start gap-2.5 text-left">
        <TriangleAlert className="mt-px size-4.5 shrink-0 text-sbb-red" strokeWidth={2} />
        <span className="flex-1 text-[14.5px] leading-snug font-bold">{disruption.summary}</span>
        {more && <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />}
      </button>
      {open && more && <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-white/80">{more}</p>}
    </Card>
  );
}

function WalkRow({ minutes, metres, onOpen }: { minutes: number; metres?: number | null; onOpen: (metres: number) => void }) {
  if (!minutes) return null;
  return (
    <button
      onClick={() => onOpen(metres ?? minutes * 75)}
      className={cn(GRID, "h-[44px] w-full items-center rounded-[19px] border border-white/40 pr-[15px] pl-[15px] text-left text-[16px] font-light tracking-tight")}
    >
      <span className="pr-1.25 text-right">{minutes}&apos;</span>
      <WalkIcon className="mx-auto size-4.25" />
      <span className="flex items-center justify-between pl-3">
        Walk: {metres ?? minutes * 75} m
        <ChevronRight className="size-4.25" strokeWidth={1.5} />
      </span>
    </button>
  );
}

function SectionCard({ section, first, last, onStop, note }: { section: Section; first: boolean; last: boolean; onStop: (s: Stop) => void; note?: { text: string; tone: Tone } }) {
  const j = section.journey!;
  const [open, setOpen] = useState(false);
  const stops = j.passList.slice(1, -1);
  const depPl = section.departure.prognosis?.platform ?? section.departure.platform;
  const arrPl = section.arrival.prognosis?.platform ?? section.arrival.platform;
  const platformLabel = (p: string | null, cat: string) => (p ? (["B", "M", "T"].includes(cat) ? `Stop ${p}` : `Pl. ${p}`) : null);

  return (
    <Card className="px-[15px] pt-[15px] pb-[15.5px]">
      <div className={cn(GRID, "text-[16px] tracking-tight")}>
        <span className="text-[15.5px] leading-5 font-bold tracking-[-0.04em] tabular-nums">{formatTime(section.departure.departure)}</span>
        <span className="relative">
          <span className="absolute top-2.5 bottom-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-white" />
          <span
            className={cn(
              "absolute top-2.5 left-1/2 -translate-1/2 rounded-full",
              first ? "size-2.5 bg-white" : "size-[9.5px] border-2 border-white bg-surface",
            )}
          />
        </span>
        <div className="flex items-start justify-between gap-1.75 pl-3">
          <StopButton checkpoint={section.departure} onStop={onStop} className="leading-5 font-bold" />
          {depPl && <span className="leading-5 font-bold whitespace-nowrap">{platformLabel(depPl, j.category)}</span>}
        </div>

        <span />
        <span className="relative">
          <span className="absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-white" />
        </span>
        <div className="pt-[18.5px] pb-[16.5px] pl-3">
          <div className="flex items-center gap-1.75">
            <ModeBadge category={j.category} />
            <LineLabel journey={j} />
            <Capacity first={j.capacity1st} second={j.capacity2nd} className="ml-auto" />
          </div>
          <p className="mt-1.5 text-[14.5px] leading-snug font-light">Direction {j.to}</p>
          {note && <p className={cn("mt-1 text-[13px] font-bold", TONE_TEXT[note.tone])}>{note.text}</p>}
          {stops.length > 0 && (
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

        <span className="leading-5 font-light tracking-[-0.03em] tabular-nums">{formatTime(section.arrival.arrival)}</span>
        <span className="relative">
          <span className="absolute top-0 left-1/2 h-2.5 w-[1.5px] -translate-x-1/2 bg-white" />
          {last && <span className="absolute top-2.5 left-1/2 size-2.5 -translate-1/2 rounded-full bg-white" />}
        </span>
        <div className="flex items-start justify-between gap-1.75 pl-3">
          <StopButton checkpoint={section.arrival} onStop={onStop} className="leading-5 font-light" />
          {arrPl && <span className="leading-5 font-light whitespace-nowrap">{platformLabel(arrPl, j.category)}</span>}
        </div>
      </div>
    </Card>
  );
}
