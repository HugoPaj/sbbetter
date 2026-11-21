"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Briefcase, ChevronRight, House } from "lucide-react";
import { Card, DESK_COL, Header, Overlap, Segmented, Skeleton, cn, toast } from "@/components/ui";
import { BoardIcon, LongArrow, StopIcon, TargetIcon } from "@/components/icons";
import { LocationPicker } from "@/components/plan/location-picker";
import { DepartureBoard } from "@/components/plan/departure-board";
import { TouchTimetable } from "@/components/plan/touch-timetable";
import { CommuteSetup } from "@/components/commute";
import { CommuteMemory } from "@/components/line-memory";
import { FakeQr, TicketSheet } from "@/components/ticket";
import { buildJourney, CURRENT_LOCATION, usePosition, type Endpoint, type Position } from "@/lib/use-position";
import { commuteQuery, journeyHref, toConnectionsRequest } from "@/lib/journey-query";
import { getConnections, nearbyStations, searchLocations, type Connection } from "@/lib/transport";
import { DelayLabel, delayNote } from "@/components/journey";
import { actions, useAppState, useStoreReady, type Commute, type SavedTrip, type Ticket } from "@/lib/store";
import { formatDate, haversine, formatShortDate, formatTime, zurichDateTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";

type View = "timetable" | "touch";

export function PlanView() {
  const router = useRouter();
  const pos = usePosition();
  const [view, setView] = useState<View>("timetable");
  const [from, setFrom] = useState<Endpoint>({ id: CURRENT_LOCATION, name: "Current location" });
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [board, setBoard] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(f: Endpoint, t: Endpoint) {
    setBusy(true);
    setError(null);
    try {
      const q = await buildJourney(f, t, pos);
      router.push(journeyHref("/connections", q));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function openNearestBoard() {
    try {
      const [s] = await nearbyStations(pos.lat, pos.lon);
      if (s) setBoard({ id: s.id!, name: s.name! });
      else toast("No stop found near your position.");
    } catch {
      toast("Could not load nearby stops.");
    }
  }

  return (
    <div className="flex min-h-(--app-h) flex-col">
      <Header title="Plan" extend>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "timetable", label: "Timetable" },
            { value: "touch", label: "Touch timetable" },
          ]}
        />
      </Header>

      {view === "timetable" ? (
        <>
          <Overlap className={DESK_COL}>
            <div className="flex overflow-hidden rounded-[19px] bg-surface shadow-xl shadow-black/50 light:shadow-black/15">
              <div className="relative min-w-0 flex-1">
                <span aria-hidden className="absolute top-[31.5px] bottom-[31.5px] left-[21.5px] w-px bg-fg" />
                <button onClick={() => setPicking("from")} className="flex h-[47.5px] w-full items-center gap-3 pr-2.5 pl-3 text-left transition-colors hover:bg-fg/5">
                  {from.id === CURRENT_LOCATION ? <TargetIcon className="size-5 shrink-0 text-[#2f8cff]" /> : <StopIcon className="size-5 shrink-0" />}
                  <span className="truncate text-[16px] font-light tracking-tight">{from.name}</span>
                </button>
                <div className="ml-11 h-px bg-surface-3" />
                <button onClick={() => setPicking("to")} className="flex h-[47.5px] w-full items-center gap-3 pr-2.5 pl-3 text-left transition-colors hover:bg-fg/5">
                  <StopIcon className="size-5 shrink-0" />
                  <span className="truncate text-[16px] font-light tracking-tight text-muted">{busy ? "Searching…" : "To"}</span>
                </button>
              </div>
              <div className="flex items-center border-l border-surface-3 px-[13.5px]">
                <button aria-label="Departure board nearby" onClick={openNearestBoard} className="flex size-[32px] items-center justify-center rounded-full border border-fg/50 transition-colors hover:bg-fg/10">
                  <BoardIcon className="size-5" />
                </button>
              </div>
            </div>
            {error && <p className="mx-[3.5px] mt-1.75 rounded-xl bg-page/80 px-2.5 py-1.75 text-sm text-sbb-red">{error}</p>}
          </Overlap>

          <Home pos={pos} onSearchTo={(to) => search(from, to)} />
        </>
      ) : (
        <>
          <TouchTimetable onSearch={search} />
          {busy && <p className="mt-1.75 text-center text-muted">Searching…</p>}
          {error && <p className="mt-1.75 text-center text-sbb-red">{error}</p>}
          <div className="h-[calc(92px+var(--home-inset))]" />
        </>
      )}

      {picking && (
        <LocationPicker
          title={picking === "from" ? "From" : "To"}
          mapMode="point"
          onClose={() => setPicking(null)}
          onPick={(e) => {
            setPicking(null);
            if (picking === "from") setFrom(e);
            else search(from, e);
          }}
        />
      )}
      {board && <DepartureBoard stationId={board.id} stationName={board.name} onClose={() => setBoard(null)} />}
    </div>
  );
}

/** Everything below the search: commute, upcoming trips and valid tickets, recent destinations. */
function Home({ pos, onSearchTo }: { pos: Position; onSearchTo: (to: Endpoint) => void }) {
  const { commute, trips, tickets, recentStops } = useAppState();
  const ready = useStoreReady();
  const now = useNow();
  const [setup, setSetup] = useState(false);
  // Waited for here, not inside CommuteCard: one skeleton stays mounted through both waits instead of being swapped for another (which re-runs its fade-in, a flash).
  const at = useWhereAmI(commute, pos);

  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const upcoming = now === null ? [] : upcomingItems(trips, tickets, now * 1000, 4);
  // The commute card already offers home and work.
  const commutePlace = (s: { id: string; name: string }) => !!commute && [commute.from, commute.to, commute.fromName, commute.toName].some((v) => v === s.id || v === s.name);
  const destinations = recentStops.filter((s) => !commutePlace(s)).slice(0, 6);

  return (
    <div className={cn("px-[8.5px]", DESK_COL)}>
      <Section title="Commuting" action={commute ? { label: "Edit", onClick: () => setSetup(true) } : undefined}>
        {/* Until hydration the saved commute is unknown: a placeholder, not the "set up" prompt. */}
        {!ready || (commute && at === undefined) ? <CommuteSkeleton /> : commute ? <CommuteCard commute={commute} at={at ?? null} /> : <CommutePrompt onClick={() => setSetup(true)} />}
      </Section>

      {/* Saved trips and tickets aren't known before hydration (nor is the time): placeholders until they are. */}
      {(!ready || now === null) && (
        <Section title="Upcoming">
          <UpcomingSkeleton />
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Upcoming" action={{ label: "Tickets", href: "/tickets" }}>
          <Card className="overflow-hidden">
            {upcoming.map((u) =>
              u.trip ? (
                <UpcomingRow key={u.trip.id} trip={u.trip} ticket={u.ticket} onTicket={setOpenTicket} />
              ) : (
                u.ticket && <TicketRow key={u.ticket.id} ticket={u.ticket} onOpen={() => setOpenTicket(u.ticket!)} />
              ),
            )}
          </Card>
        </Section>
      )}

      {!ready && (
        <Section title="Recent destinations">
          <DestinationsSkeleton />
        </Section>
      )}

      {destinations.length > 0 && (
        <Section title="Recent destinations" action={{ label: "Clear", onClick: () => actions.set({ recentStops: [] }) }}>
          <div className="flex flex-wrap gap-2 px-0.5">
            {destinations.map((s) => (
              <button
                key={s.id}
                onClick={() => onSearchTo(s)}
                className="flex h-[36px] max-w-full items-center gap-1.5 rounded-full border border-fg/25 bg-surface px-3.5 text-[14.5px] font-light tracking-tight transition-colors hover:bg-surface-2"
              >
                <StopIcon className="size-4 shrink-0" />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      <div className="h-[calc(92px+var(--home-inset))]" />
      {openTicket && <TicketSheet ticket={openTicket} valid onClose={() => setOpenTicket(null)} />}
      {setup && <CommuteSetup initial={commute} onClose={() => setSetup(false)} />}
    </div>
  );
}

type SectionAction = { label: string; href?: string; onClick?: () => void };

function Section({ title, action, children }: { title: string; action?: SectionAction; children: React.ReactNode }) {
  const actionCls = "text-[13.5px] font-light tracking-tight text-fg/70 underline-offset-2 hover:text-fg hover:underline";
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between px-[15px] pb-1.75">
        <h2 className="text-[13.5px] font-light tracking-tight">{title}</h2>
        {action &&
          (action.href ? (
            <Link href={action.href} className={actionCls}>
              {action.label}
            </Link>
          ) : (
            <button onClick={action.onClick} className={actionCls}>
              {action.label}
            </button>
          ))}
      </div>
      {children}
    </section>
  );
}

const ROW = "flex w-full items-center gap-3 border-b border-line py-[10px] pr-3.5 pl-[15px] text-left transition-colors last:border-b-0 hover:bg-fg/5";

function Row({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={ROW}>
      {children}
    </button>
  );
}

function Route({ from, to }: { from: string; to: string }) {
  return (
    <p className="text-[15.5px] leading-snug font-bold">
      {/* Neither end wraps: a long one is cut with "…", so the arrow stays beside the start. */}
      <span className="inline-flex max-w-full items-center align-top">
        <span className="truncate">{from}</span>
        <LongArrow className="mx-1.25 shrink-0" />
      </span>{" "}
      <span className="inline-block max-w-full truncate align-top">{to}</span>
    </p>
  );
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The way to work stays on top until this long after its usual time (and the way home until after its). */
const STAY_FIRST = 30;

/**
 * Within this distance (metres) of the home or work stop, only the trip away from there is shown.
 * Generous: these are stops, and you live or work a walk away from them.
 */
const AT_PLACE = 1000;

type LatLon = { lat: number; lon: number };
const placeCache = new Map<string, Promise<LatLon | null>>();

/** Where a saved place is: parsed from a "coord:lat,lon" id, otherwise looked up by name once per session. */
function placeOf(id: string, name: string): Promise<LatLon | null> {
  const m = /^coord:(-?[\d.]+),(-?[\d.]+)$/.exec(id);
  if (m) return Promise.resolve({ lat: Number(m[1]), lon: Number(m[2]) });
  let p = placeCache.get(id);
  if (!p) {
    p = searchLocations(name)
      .then((found) => {
        const hit = found.find((l) => l.id === id) ?? found[0];
        const { x, y } = hit?.coordinate ?? {};
        return x != null && y != null ? { lat: x, lon: y } : null;
      })
      .catch(() => {
        placeCache.delete(id);
        return null;
      });
    placeCache.set(id, p);
  }
  return p;
}

/** "home" or "work" when the traveller's real position is near one of them, null when neither, undefined while still finding out. */
function useWhereAmI(c: Commute | null, pos: Position): "home" | "work" | null | undefined {
  const key = c ? `${c.from}|${c.to}` : "";
  const [places, setPlaces] = useState<{ key: string; home: LatLon | null; work: LatLon | null } | null>(null);
  useEffect(() => {
    if (!c) return;
    let live = true;
    Promise.all([placeOf(c.from, c.fromName), placeOf(c.to, c.toName)]).then(([home, work]) => live && setPlaces({ key, home, work }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the ids; names only matter with them.
  }, [key]);
  if (!c || !pos.settled) return undefined;
  if (!pos.real) return null;
  if (places?.key !== key) return undefined;
  // Give the fix the benefit of its doubt (capped, so a city-wide guess doesn't count as "home").
  const dist = (p: LatLon | null) => (p ? haversine(pos.lat, pos.lon, p.lat, p.lon) - Math.min(pos.accuracy, 1500) : Infinity);
  const home = dist(places.home);
  const work = dist(places.work);
  if (Math.min(home, work) > AT_PLACE) return null;
  return home <= work ? "home" : "work";
}

/**
 * Commuter route with one-tap outward / return. Near home only the way to work is shown and near
 * work only the way home; anywhere else both, the direction due next first.
 */
function CommuteCard({ commute: c, at }: { commute: Commute; at: "home" | "work" | null }) {
  const router = useRouter();
  const now = useNow();
  const nowMin = now === null ? 0 : minutesOf(zurichDateTime().time);
  const out = minutesOf(c.outTime);
  const back = minutesOf(c.backTime);
  // Half an hour after the usual time to work (and until half an hour after the one home), the way home is the one you want.
  const backFirst = nowMin > out + STAY_FIRST && nowMin <= back + STAY_FIRST;
  // A hidden row's departures aren't fetched.
  const nextOut = useNextDeparture(c, false, now, at !== "work");
  const nextBack = useNextDeparture(c, true, now, at !== "home");
  const legs = [
    { back: false, icon: Briefcase, label: "To work", from: "Home", to: c.toName, next: nextOut },
    { back: true, icon: House, label: "Home", from: c.toName, to: "Home", next: nextBack },
  ];
  if (backFirst) legs.reverse();
  const shown = at ? legs.filter((l) => l.back === (at === "work")) : legs;
  return (
    <Card className="overflow-hidden">
      {shown.map((l, i) => (
        <Row key={l.label} onClick={() => router.push(journeyHref("/connections", commuteQuery(c, l.back)))}>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", i === 0 ? "bg-sbb-red text-white" : "border border-fg/40")}>
            <l.icon className="size-4.5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <Route from={l.from} to={l.to} />
          </div>
          {l.next === undefined ? <NextDepartureSkeleton /> : l.next ? <NextDeparture next={l.next} /> : <ChevronRight className="size-4.25 shrink-0 text-fg/70" strokeWidth={1.5} />}
        </Row>
      ))}
      {/* The way round staff advised when this route was closed before, for the direction shown first (nothing without such advice). */}
      <CommuteMemory commute={c} back={shown[0]?.back ?? false} />
    </Card>
  );
}

type Next ={ leaveIn: number; walk: number; time: string; platform: string | null; connection: Connection };

/**
 * The next departure for one direction of the commute that can still be caught, refreshed every
 * minute. From a home address the countdown is to leaving the door (walk included).
 * Undefined while the first lookup runs; null when there is none (or it failed).
 */
function useNextDeparture(c: Commute, back: boolean, now: number | null, enabled: boolean): Next | null | undefined {
  const key = `${c.from}|${c.to}|${back}`;
  const [found, setFound] = useState<{ key: string; items: Connection[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let ctrl: AbortController | null = null;
    const load = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const at = zurichDateTime();
      const q = { ...commuteQuery(c, back), date: at.date, time: at.time };
      getConnections({ ...toConnectionsRequest(q), limit: 3 }, ctrl.signal)
        .then((items) => setFound({ key, items }))
        .catch((e) => {
          // No live time then: the row falls back to its chevron (a later refresh may still fill it).
          if ((e as Error).name !== "AbortError") setFound((f) => (f?.key === key ? f : { key, items: [] }));
        });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      clearInterval(id);
      ctrl?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the commute fields used.
  }, [key, enabled]);
  if (!enabled) return null;
  if (now === null || found?.key !== key) return undefined;
  for (const conn of found.items) {
    const at = conn.from.prognosis?.departure ?? conn.from.departure;
    if (!at) continue;
    const walk = conn.accessWalk?.minutes ?? 0;
    const leaveIn = Math.floor((Date.parse(at) / 1000 - walk * 60 - now) / 60);
    if (leaveIn < 0) continue;
    return { leaveIn, walk, time: formatTime(conn.from.departure ?? at), platform: conn.from.prognosis?.platform ?? conn.from.platform, connection: conn };
  }
  return null;
}

function NextDeparture({ next: n }: { next: Next }) {
  const delay = delayNote(n.connection.from, "departure", { past: false });
  const h = Math.floor(n.leaveIn / 60);
  const when = n.leaveIn === 0 ? "now" : h ? `${h} h ${String(n.leaveIn % 60).padStart(2, "0")}` : `${n.leaveIn} min`;
  return (
    <div
      className="shrink-0 animate-fade-in text-right"
      aria-label={`${n.walk ? "Leave" : "Departs"} ${n.leaveIn === 0 ? "now" : `in ${when}`}, at ${n.time}${n.platform ? `, platform ${n.platform}` : ""}`}
    >
      {n.walk > 0 && <p className="text-[11.5px] leading-tight font-light text-fg/70">leave in</p>}
      <p className="text-[16px] leading-tight font-bold whitespace-nowrap">{when}</p>
      <p className="text-[11.5px] leading-tight font-light whitespace-nowrap text-fg/70">
        {n.time}
        {delay && <DelayLabel note={delay} className="ml-1 text-[11.5px]" />}
        {n.platform && ` · Pl. ${n.platform}`}
      </p>
    </div>
  );
}

/** Stands in for the commute card or the set-up prompt until the saved state is read (see useStoreReady). */
function CommuteSkeleton() {
  return (
    <div role="status" aria-label="Loading commute" className="flex items-center gap-3.5 rounded-[19px] bg-surface py-3.5 pr-3.5 pl-[15px]">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-[15px] w-[150px]" />
        <Skeleton className="h-[12px] w-[220px] max-w-full" />
      </div>
    </div>
  );
}

/** Two rows shaped like UpcomingRow. */
function UpcomingSkeleton() {
  return (
    <div role="status" aria-label="Loading upcoming trips" className="overflow-hidden rounded-[19px] bg-surface">
      {[
        ["w-[190px]", "w-[150px]"],
        ["w-[160px]", "w-[120px]"],
      ].map(([route, line]) => (
        <div key={route} className="flex items-center gap-3 border-b border-line py-[10px] pr-3.5 pl-[15px] last:border-b-0">
          <div aria-hidden className="flex w-[52px] shrink-0 flex-col items-center gap-1">
            <Skeleton className="h-[16px] w-[42px]" />
            <Skeleton className="h-[11px] w-[34px]" />
          </div>
          <div aria-hidden className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-[15px] max-w-full", route)} />
            <Skeleton className={cn("h-[12px] max-w-full", line)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A few chips shaped like the recent-destination buttons. */
function DestinationsSkeleton() {
  return (
    <div role="status" aria-label="Loading recent destinations" className="flex flex-wrap gap-2 px-0.5">
      {["w-[110px]", "w-[90px]", "w-[130px]"].map((w) => (
        <Skeleton key={w} className={cn("h-[36px] rounded-full", w)} />
      ))}
    </div>
  );
}

/** The countdown slot (see NextDeparture) while the first departures load. */
function NextDepartureSkeleton() {
  return (
    <div aria-hidden className="flex shrink-0 flex-col items-end gap-1">
      <Skeleton className="h-[16px] w-[46px]" />
      <Skeleton className="h-[11px] w-[64px]" />
    </div>
  );
}

function CommutePrompt({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3.5 rounded-[19px] bg-surface py-3.5 pr-3.5 pl-[15px] text-left transition-colors hover:bg-fg/5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-fg/40">
        <ArrowLeftRight className="size-4.5" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15.5px] leading-snug font-bold">Set up your commute</p>
        <p className="mt-0.5 text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">Home and work in one tap, plus alerts about service changes.</p>
      </div>
      <ChevronRight className="size-4.25 shrink-0 text-fg/70" strokeWidth={1.5} />
    </button>
  );
}

/** A saved trip; when a valid ticket covers it, the ticket's code sits beside it, one tap from full screen. */
function UpcomingRow({ trip: t, ticket, onTicket }: { trip: SavedTrip; ticket?: Ticket; onTicket: (t: Ticket) => void }) {
  return (
    <div className="flex items-center border-b border-line last:border-b-0">
      <Link href={journeyHref("/connections/detail", t.query, { key: t.id, ...t.params })} className={cn(ROW, "min-w-0 flex-1 border-b-0")}>
        <div className="w-[52px] shrink-0 text-center">
          <p className="text-[16px] leading-tight font-bold">{formatTime(t.departure)}</p>
          <p className="text-[11.5px] leading-tight font-light text-fg/70">{formatShortDate(new Date(t.departure))}</p>
        </div>
        <div className="min-w-0 flex-1">
          <Route from={t.query.fromName} to={t.query.toName} />
          <p className="mt-0.5 truncate text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">
            Arr. {formatTime(t.arrival)} · {t.summary}
          </p>
        </div>
        {!ticket && <ChevronRight className="size-4.25 shrink-0 text-fg/70" strokeWidth={1.5} />}
      </Link>
      {ticket && (
        <button aria-label={`Show ticket: ${ticket.product}`} onClick={() => onTicket(ticket)} className="shrink-0 py-2 pr-3.5 pl-1">
          <FakeQr seed={ticket.id} className="size-11 rounded" />
        </button>
      )}
    </div>
  );
}

/** A valid ticket with no saved trip: tap for its code. */
function TicketRow({ ticket: t, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const until = new Date(t.validTo);
  const sameDay = formatDate(until) === formatDate(new Date());
  return (
    <button onClick={onOpen} className={ROW}>
      <div className="min-w-0 flex-1">
        {t.to ? <Route from={t.from} to={t.to} /> : <p className="truncate text-[15.5px] leading-snug font-bold">{t.from || t.product}</p>}
        <p className="mt-0.5 truncate text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">
          {t.product} · valid until {sameDay ? "" : `${formatShortDate(until)}, `}
          {formatTime(t.validTo)}
        </p>
      </div>
      <FakeQr seed={t.id} className="size-11 shrink-0 rounded" />
    </button>
  );
}

type Upcoming = { at: string; trip?: SavedTrip; ticket?: Ticket };

/**
 * Saved trips not yet over and tickets still valid, soonest first. A ticket for the same route
 * that is valid when a trip leaves goes with that trip rather than on a row of its own.
 */
function upcomingItems(trips: SavedTrip[], tickets: Ticket[], nowMs: number, max: number): Upcoming[] {
  const valid = tickets.filter((t) => Date.parse(t.validTo) >= nowMs);
  const used = new Set<string>();
  const items: Upcoming[] = trips
    .filter((t) => Date.parse(t.arrival) >= nowMs)
    .map((trip) => {
      const dep = Date.parse(trip.departure);
      const ticket = valid.find(
        (k) => !used.has(k.id) && k.from === trip.query.fromName && k.to === trip.query.toName && Date.parse(k.validFrom) <= dep && dep <= Date.parse(k.validTo),
      );
      if (ticket) used.add(ticket.id);
      return { at: trip.departure, trip, ticket };
    });
  for (const k of valid) if (!used.has(k.id)) items.push({ at: k.validFrom, ticket: k });
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, max);
}
