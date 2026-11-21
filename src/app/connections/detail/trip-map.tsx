"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ChevronRight, Layers, Navigation } from "lucide-react";
import { Card, Radio, Sheet, cn } from "@/components/ui";
import { ConnectionMap, type LonLat, type MapPart } from "@/components/plan/connection-map";
import { MAP_STYLES, type MapStyleId } from "@/components/plan/journey-map";
import { LineLabel, ModeBadge, modeOf } from "@/components/journey";
import { WalkIcon } from "@/components/icons";
import { formatTime } from "@/lib/format";
import { usePosition } from "@/lib/use-position";
import type { Checkpoint, Connection, Section } from "@/lib/transport";

export type { LonLat };
export type Walk = { minutes: number; metres: number; from: string; to: string; a: LonLat | null; b: LonLat | null; track?: LonLat[] };

/** One swipeable step of the trip: a ride, or a walk (to the first stop or between platforms). */
export type Part =
  | { kind: "ride"; section: Section; start: number; end: number; map: MapPart }
  | { kind: "walk"; walk: Walk; start: number; end: number; map: MapPart };

export const lonLat = (c: Checkpoint): LonLat | null => (c.station.coordinate.x && c.station.coordinate.y ? [c.station.coordinate.y, c.station.coordinate.x] : null);

function walkPart(walk: Walk, start: number, end: number): Part {
  const coords = walk.track ?? [walk.a, walk.b].filter((c): c is LonLat => c !== null);
  return { kind: "walk", walk, start, end, map: { coords, walk: true, stops: [] } };
}

/** Split a connection into the steps shown as chips/cards in the map view. */
export function partsOf(conn: Connection, origin: LonLat | null, fromLabel: string, accessWalk?: number): Part[] {
  const parts: Part[] = [];
  const first = conn.sections.find((s) => s.journey);
  if (accessWalk && first) {
    const end = first.departure.departureTimestamp ?? 0;
    parts.push(
      walkPart(
        {
          minutes: accessWalk,
          metres: conn.accessWalk?.metres ?? accessWalk * 75,
          from: fromLabel,
          to: first.departure.station.name ?? "",
          a: origin,
          b: lonLat(first.departure),
          track: conn.accessWalk?.track,
        },
        end - accessWalk * 60,
        end,
      ),
    );
  }
  let t = conn.from.departureTimestamp ?? 0;
  for (const s of conn.sections) {
    if (s.journey) {
      const pass = s.journey.passList.length > 1 ? s.journey.passList : [s.departure, s.arrival];
      const stops = pass.flatMap((p, i) => {
        const at = lonLat(p);
        return at ? [{ at, name: p.station.name ?? "", end: i === 0 || i === pass.length - 1 }] : [];
      });
      const start = s.departure.departureTimestamp ?? t;
      const end = s.arrival.arrivalTimestamp ?? start;
      // Real path when the API sent one, else straight lines between the stops.
      parts.push({ kind: "ride", section: s, start, end, map: { coords: s.track ?? stops.map((x) => x.at), stops } });
      t = end;
    } else {
      const minutes = Math.round((s.walk?.duration ?? 0) / 60);
      if (!minutes) continue;
      const start = s.departure.departureTimestamp ?? t;
      const end = start + minutes * 60;
      parts.push(
        walkPart(
          { minutes, metres: minutes * 75, from: s.departure.station.name ?? "", to: s.arrival.station.name ?? "", a: lonLat(s.departure), b: lonLat(s.arrival), track: s.track },
          start,
          end,
        ),
      );
      t = end;
    }
  }
  return parts;
}

/** The step that is under way (or next) at `now`; the first one for past trips. */
function currentPart(parts: Part[], now: number) {
  const i = parts.findIndex((p) => p.end > now);
  return i < 0 ? 0 : i;
}

/** Height of an element, kept up to date. */
function useHeight() {
  const [height, setHeight] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height] as const;
}

const nowSec = () => Date.now() / 1000;

/**
 * Map view of a connection: full-bleed map, locate/layers buttons, and a
 * bottom sheet with one chip and one swipeable card per trip step.
 * Rendered inside a `relative` container that fills the space under the header.
 */
export function TripMap({
  connection,
  origin,
  fromLabel,
  accessWalk,
  topInset,
  onWalk,
}: {
  connection: Connection;
  /** Coordinate origin of the search (for the walk to the first stop). */
  origin: LonLat | null;
  fromLabel: string;
  accessWalk?: number;
  /** Bottom edge of the floating summary card, from the top of the map (px). */
  topInset: number;
  onWalk: (w: Walk) => void;
}) {
  const [lon, lat] = origin ?? [null, null];
  const parts = useMemo(() => partsOf(connection, lon !== null && lat !== null ? [lon, lat] : null, fromLabel, accessWalk), [connection, lon, lat, fromLabel, accessWalk]);
  const pos = usePosition();
  const [active, setActive] = useState(() => currentPart(parts, nowSec()));
  const [now, setNow] = useState(nowSec);
  const [collapsed, setCollapsed] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const [styleId, setStyleId] = useState<MapStyleId>("dark");
  const [layers, setLayers] = useState(false);
  const [sheetRef, sheetHeight] = useHeight();
  const scroller = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  /** Card index a programmatic scroll is heading to (ignore the scroll events on the way). */
  const target = useRef<number | null>(null);
  const drag = useRef<number | null>(null);

  const mapParts = useMemo(() => parts.map((p) => p.map), [parts]);
  const self = useMemo(() => ({ lat: pos.lat, lon: pos.lon }), [pos.lat, pos.lon]);

  useEffect(() => {
    const id = setInterval(() => setNow(nowSec()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Show the active card when the sheet (re)opens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = active * el.clientWidth;
    // Only on open/expand: swipes and chip taps move the scroller themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  useEffect(() => {
    chips.current[active]?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [active]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    const i = Math.min(parts.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
    if (target.current !== null) {
      if (i === target.current) target.current = null;
      return;
    }
    if (i !== active) setActive(i);
  };

  const select = (i: number) => {
    setActive(i);
    const el = scroller.current;
    if (!el || collapsed) return;
    target.current = Math.round(el.scrollLeft / el.clientWidth) === i ? null : i;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  // Drag the handle down to collapse the sheet, up to expand it; a tap toggles.
  const onHandleDown = (e: PointerEvent) => {
    drag.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleUp = (e: PointerEvent) => {
    if (drag.current === null) return;
    const dy = e.clientY - drag.current;
    drag.current = null;
    if (Math.abs(dy) < 8) setCollapsed((c) => !c);
    else setCollapsed(dy > 0);
  };

  return (
    <>
      <ConnectionMap parts={mapParts} active={active} self={self} recenterKey={recenter} styleId={styleId} padding={{ top: topInset, bottom: sheetHeight }} />

      <div className="absolute right-[8.5px] z-10 flex flex-col gap-[8.5px]" style={{ top: topInset + 12 }}>
        <MapButton label="Show my location" onClick={() => setRecenter((n) => n + 1)}>
          <Navigation className="size-5" strokeWidth={1.25} />
        </MapButton>
        <MapButton label="Map layers" onClick={() => setLayers(true)}>
          <Layers className="size-5" strokeWidth={1.25} />
        </MapButton>
      </div>

      <section
        ref={sheetRef}
        aria-label="Trip sections"
        className="fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 rounded-t-[22px] bg-[#1c1c1c] pb-[calc(77px+var(--home-inset)+36px)] shadow-[0_-6px_24px_rgba(0,0,0,0.5)]"
      >
        <button
          aria-label={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          onPointerDown={onHandleDown}
          onPointerUp={onHandleUp}
          onPointerCancel={() => (drag.current = null)}
          className="flex w-full touch-none justify-center pt-[11px] pb-[11px]"
        >
          <span className="h-[3.5px] w-8 rounded-full bg-white/40" />
        </button>

        <div role="tablist" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-[17px]">
          {parts.map((p, i) => (
            <button
              key={i}
              ref={(el) => {
                chips.current[i] = el;
              }}
              role="tab"
              aria-selected={i === active}
              onClick={() => select(i)}
              className={cn(
                "relative flex h-[32px] shrink-0 items-center gap-2 rounded-l-[6px] rounded-r-full pr-4 pl-3",
                p.kind === "ride" ? "bg-sbb-blue" : "bg-surface-3",
              )}
            >
              {p.kind === "ride" ? (
                <>
                  <ModeBadge category={p.section.journey!.category} className="size-[25px]" />
                  <LineLabel journey={p.section.journey!} className={modeOf(p.section.journey!.category) === "train" ? undefined : "text-[18px]"} />
                </>
              ) : (
                <>
                  <WalkIcon className="size-[19px]" />
                  <span className="text-[16px] font-bold">{p.walk.minutes}&apos;</span>
                </>
              )}
              {i === active && <span aria-hidden className="absolute -bottom-[11px] left-1/2 h-[3px] w-3 -translate-x-1/2 rounded-full bg-white" />}
            </button>
          ))}
        </div>

        {!collapsed && (
          <div ref={scroller} onScroll={onScroll} className="no-scrollbar flex snap-x snap-mandatory items-start overflow-x-auto">
            {parts.map((p, i) => (
              <div key={i} className="w-full shrink-0 snap-center snap-always px-4" aria-hidden={i !== active}>
                {p.kind === "ride" ? <RideCard section={p.section} now={now} /> : <WalkCard walk={p.walk} onOpen={() => onWalk(p.walk)} />}
              </div>
            ))}
          </div>
        )}
      </section>

      {layers && (
        <Sheet title="Map layers" onClose={() => setLayers(false)}>
          <Card className="overflow-hidden">
            {(Object.keys(MAP_STYLES) as MapStyleId[]).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={styleId === id}
                onClick={() => setStyleId(id)}
                className="flex min-h-[46px] w-full items-center gap-3 border-b border-surface-3 px-4 text-left text-[16px] font-light tracking-tight last:border-b-0"
              >
                <Radio checked={styleId === id} /> {MAP_STYLES[id].label}
              </button>
            ))}
          </Card>
        </Sheet>
      )}
    </>
  );
}

function MapButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} onClick={onClick} className="flex size-[44px] items-center justify-center rounded-full border border-white/50 bg-[#141414]">
      {children}
    </button>
  );
}

const CARD = "overflow-hidden rounded-[17px] border border-white/35";
const TOP = "bg-[#1c1c1c] px-4 pt-[13px] pb-[11px] text-[16.5px] leading-[28px] font-light tracking-tight";
const BOTTOM = "flex items-end justify-between gap-4 border-t border-white/35 bg-black px-4 pt-[13px] pb-[13px]";

function Figure({ label, value, extra, right }: { label: string; value: string; extra?: ReactNode; right?: boolean }) {
  return (
    <div className={cn("min-w-0", right && "text-right")}>
      <p className="text-[14.5px] leading-5 font-light tracking-tight text-white/85">{label}</p>
      <p className="mt-0.5 text-[26px] leading-8 font-bold tracking-[-0.03em] tabular-nums">
        {value}
        {extra}
      </p>
    </div>
  );
}

/** Ride step. It shows the departure, or the arrival while you are on board. */
function RideCard({ section, now }: { section: Section; now: number }) {
  const j = section.journey!;
  const departed = now >= (section.departure.departureTimestamp ?? Infinity) && now < (section.arrival.arrivalTimestamp ?? 0);
  const stop = departed ? section.arrival : section.departure;
  const platform = stop.prognosis?.platform ?? stop.platform;
  const isStop = ["bus", "tram", "metro"].includes(modeOf(j.category));
  const delay = stop.delay ?? 0;
  return (
    <article className={CARD}>
      <p className={TOP}>
        {departed ? "Arrival at " : "Departure from "}
        <b className="font-bold">{stop.station.name}</b>
        {" with "}
        <span className="inline-flex items-center gap-1.5 pr-2 align-[-4px]">
          <ModeBadge category={j.category} className="size-[22px]" />
          <LineLabel journey={j} />
        </span>{" "}
        Direction {j.to}
      </p>
      <div className={BOTTOM}>
        <Figure
          label={departed ? "Arrival" : "Departure"}
          value={formatTime(departed ? stop.arrival : stop.departure)}
          extra={delay > 0 && <span className="ml-2 align-middle text-[15px] font-normal text-sbb-red">+{delay}&apos;</span>}
        />
        {platform && <Figure label={isStop ? "Stop" : "Platform"} value={platform} right />}
      </div>
    </article>
  );
}

function WalkCard({ walk, onOpen }: { walk: Walk; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className={cn(CARD, "block w-full text-left")}>
      <p className={cn(TOP, "flex items-start justify-between gap-2")}>
        <span>
          Walk to <b className="font-bold">{walk.to}</b>
        </span>
        <ChevronRight className="mt-1.5 size-4.25 shrink-0" strokeWidth={1.5} />
      </p>
      <div className={BOTTOM}>
        <Figure label="Walk" value={`${walk.minutes} min`} />
        <Figure label="Distance" value={`${walk.metres} m`} right />
      </div>
    </button>
  );
}
