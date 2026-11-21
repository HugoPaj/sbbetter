"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Briefcase, ChevronRight, House, RotateCcw } from "lucide-react";
import { Card, DESK_COL, Header, Overlap, Segmented, cn, toast } from "@/components/ui";
import { BoardIcon, LongArrow, StopIcon, TargetIcon } from "@/components/icons";
import { LocationPicker } from "@/components/plan/location-picker";
import { DepartureBoard } from "@/components/plan/departure-board";
import { TouchTimetable } from "@/components/plan/touch-timetable";
import { CommuteSetup } from "@/components/commute";
import { buildJourney, CURRENT_LOCATION, usePosition, type Endpoint } from "@/lib/use-position";
import { commuteQuery, journeyHref } from "@/lib/journey-query";
import { nearbyStations } from "@/lib/transport";
import { actions, useAppState, type Commute, type SavedTrip, type Ticket } from "@/lib/store";
import { formatChf, formatDate, formatShortDate, formatTime, zurichDateTime } from "@/lib/format";
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

          <Home onSearchTo={(to) => search(from, to)} onSearch={search} />
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

/** Everything below the search: commute, upcoming saved trips, recent purchases and destinations. */
function Home({ onSearchTo, onSearch }: { onSearchTo: (to: Endpoint) => void; onSearch: (from: Endpoint, to: Endpoint) => void }) {
  const { commute, trips, tickets, recentStops } = useAppState();
  const now = useNow();
  const [setup, setSetup] = useState(false);

  const upcoming = now === null ? [] : trips.filter((t) => new Date(t.arrival).getTime() >= now * 1000).sort((a, b) => a.departure.localeCompare(b.departure)).slice(0, 3);
  const purchases = recentPurchases(tickets, 4);
  const destinations = recentStops.slice(0, 6);

  return (
    <div className={cn("px-[8.5px]", DESK_COL)}>
      <Section title="Commuting" action={commute ? { label: "Edit", onClick: () => setSetup(true) } : undefined}>
        {commute ? <CommuteCard commute={commute} /> : <CommutePrompt onClick={() => setSetup(true)} />}
      </Section>

      {upcoming.length > 0 && (
        <Section title="Upcoming trips" action={{ label: "All trips", href: "/trips" }}>
          <Card className="overflow-hidden">
            {upcoming.map((t) => (
              <UpcomingRow key={t.id} trip={t} />
            ))}
          </Card>
        </Section>
      )}

      {purchases.length > 0 && (
        <Section title="Recently purchased" action={{ label: "Tickets", href: "/tickets" }}>
          <Card className="overflow-hidden">
            {purchases.map((t) => (
              <Row key={t.id} onClick={() => onSearch({ id: t.from, name: t.from }, { id: t.to, name: t.to })}>
                <div className="min-w-0 flex-1">
                  <Route from={t.from} to={t.to} />
                  <p className="mt-0.5 truncate text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">
                    {formatDate(new Date(t.validFrom))} · {t.product} · {formatChf(t.price)}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[13px] font-light tracking-tight text-fg/80">
                  <RotateCcw className="size-3.5" strokeWidth={1.5} /> Again
                </span>
              </Row>
            ))}
          </Card>
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
      <span className="inline-block">
        {from} <LongArrow className="mx-1.25" />
      </span>{" "}
      <span className="inline-block">{to}</span>
    </p>
  );
}

/** Commuter route with one-tap outward / return; the direction due next comes first. */
function CommuteCard({ commute: c }: { commute: Commute }) {
  const router = useRouter();
  const nowTime = useNow() === null ? "00:00" : zurichDateTime().time;
  // After the outward time has passed (and before the return time), the way home is the one you want.
  const backFirst = nowTime > c.outTime && nowTime <= c.backTime;
  const legs = [
    { back: false, icon: Briefcase, label: "To work", time: c.outTime, from: c.fromName, to: c.toName },
    { back: true, icon: House, label: "Home", time: c.backTime, from: c.toName, to: c.fromName },
  ];
  if (backFirst) legs.reverse();
  return (
    <Card className="overflow-hidden">
      {legs.map((l, i) => (
        <Row key={l.label} onClick={() => router.push(journeyHref("/connections", commuteQuery(c, l.back)))}>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", i === 0 ? "bg-sbb-red text-white" : "border border-fg/40")}>
            <l.icon className="size-4.5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">
              {l.label} · usually {l.time}
            </p>
            <Route from={l.from} to={l.to} />
          </div>
          <ChevronRight className="size-4.25 shrink-0 text-fg/70" strokeWidth={1.5} />
        </Row>
      ))}
    </Card>
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

function UpcomingRow({ trip: t }: { trip: SavedTrip }) {
  return (
    <Link href={journeyHref("/connections/detail", t.query, { key: t.id, ...t.params })} className={ROW}>
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
      <ChevronRight className="size-4.25 shrink-0 text-fg/70" strokeWidth={1.5} />
    </Link>
  );
}

/** Newest tickets with a route, one per from→to pair. */
function recentPurchases(tickets: Ticket[], max: number): Ticket[] {
  const seen = new Set<string>();
  const out: Ticket[] = [];
  for (const t of [...tickets].sort((a, b) => b.validFrom.localeCompare(a.validFrom))) {
    if (!t.from || !t.to) continue;
    const k = `${t.from}→${t.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length === max) break;
  }
  return out;
}
