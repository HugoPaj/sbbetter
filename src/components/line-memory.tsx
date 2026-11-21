"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bus, Check, ChevronDown, ChevronRight, Clock, Repeat, Split, Ticket, type LucideIcon } from "lucide-react";
import { Card, Sheet, Skeleton, cn } from "./ui";
import { connectionKey, queryForConnection, rememberConnections } from "@/lib/connection-key";
import { formatMinutes, formatTime } from "@/lib/format";
import { commuteQuery, journeyHref, toConnectionsRequest, type JourneyQuery } from "@/lib/journey-query";
import {
  advisedDetour,
  causeLabel,
  findPlanB,
  inTen,
  loadLineMemory,
  overWithin,
  scriptFor,
  stretchName,
  stretchesOn,
  timesWord as times,
  type Closure,
  type Hit,
  type LineMemory,
  type PlanB,
  type Step,
  type Stretch,
} from "@/lib/line-memory";
import type { Commute } from "@/lib/store";
import { getConnections, type Connection } from "@/lib/transport";
import { useNow } from "@/lib/use-now";

/**
 * Line memory in the UI: what happened the last times this route was disrupted
 * (see lib/line-memory.ts). It never gets a row of its own. On a normal day it is
 * one muted line under the train it concerns ("If this line closes: Plan B via …");
 * during a disruption it sits inside the alert: the way round as a real connection,
 * and what usually happens next. The history is one tap away, in a sheet.
 */

export type RouteMemory = { memory: LineMemory; /** Remembered stretches on the route, most disrupted first. */ hits: Hit[] };

/** Every station the connection calls at: going "via" one of them is no way round. */
const stationsOf = (conn: Connection) => conn.sections.flatMap((s) => s.journey?.passList.map((p) => p.station.id) ?? []);

export function useLineMemory(): LineMemory | null {
  const [memory, setMemory] = useState<LineMemory | null>(null);
  useEffect(() => {
    let live = true;
    loadLineMemory()
      .then((m) => live && setMemory(m))
      .catch(() => {}); // No memory then: the screens simply stay as they were.
    return () => {
      live = false;
    };
  }, []);
  return memory;
}

/** Line memory for a connection, once loaded. */
export function useRouteMemory(conn: Connection | null | undefined): RouteMemory | null {
  const memory = useLineMemory();
  return useMemo(() => (memory && conn ? { memory, hits: stretchesOn(conn, memory) } : null), [memory, conn]);
}

const monthYear = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(iso));
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const clock = (ms: number) => formatTime(new Date(ms).toISOString());

/** Ways round already searched this session, so the line, the alert and the sheet share one search. */
const plans = new Map<string, Promise<PlanB | null>>();

/**
 * The way round for a stretch as a live connection: undefined while searching, null when there is none.
 * `prefer` is the stop id of the detour already named to the traveller.
 */
function usePlanB(query: JourneyQuery, conn: Connection, stretch: Stretch | null, enabled: boolean, prefer?: string): PlanB | null | undefined {
  const key = enabled && stretch?.detours.length ? `${stretch.key}|${connectionKey(conn)}|${prefer ?? ""}` : null;
  const [found, setFound] = useState<{ key: string; plan: PlanB | null } | null>(null);
  useEffect(() => {
    if (!key || !stretch) return;
    let live = true;
    let search = plans.get(key);
    if (!search) {
      search = findPlanB(queryForConnection(query, conn), conn.to.arrivalTimestamp ?? 0, stretch, undefined, prefer).catch(() => {
        plans.delete(key);
        return null;
      });
      plans.set(key, search);
    }
    search.then((plan) => live && setFound({ key, plan }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the stretch, the connection and the preference.
  }, [key]);
  if (!key) return null;
  return found?.key === key ? found.plan : undefined;
}

const SUB = "text-[13px] leading-snug font-light text-fg/80";

/**
 * Normal day: one muted line under a train in the timeline, naming the way round staff advised
 * the last times its line was closed. Nothing for a train without such advice.
 */
export function LegMemory({ route, section, conn, query }: { route: RouteMemory; /** Index into `conn.sections`. */ section: number; conn: Connection; query: JourneyQuery }) {
  const [open, setOpen] = useState(false);
  const stretches = route.hits.filter((h) => h.section === section).map((h) => h.stretch);
  const advised = advisedDetour(stretches, [query.from, query.to, ...stationsOf(conn)]);
  if (!advised) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="mt-1.5 flex items-center gap-1.25 text-left text-[13px] leading-snug font-light text-muted">
        <Split className="size-3.5 shrink-0 rotate-90" strokeWidth={1.75} />
        <span className="min-w-0">If this line closes: Plan B via {advised.detour.via}</span>
        <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.5} />
      </button>
      {open && <LineMemorySheet memory={route.memory} stretch={advised.stretch} conn={conn} query={query} prefer={advised.detour.id} onClose={() => setOpen(false)} />}
    </>
  );
}

const stretchOfClosure = (route: RouteMemory, closure: Closure) => (closure.stretch ? (route.memory.stretches.find((s) => s.key === closure.stretch) ?? null) : null);

/** During a disruption: the way round as a real connection, for directly under the alert. */
export function ClosurePlanB({ route, conn, query, closure }: { route: RouteMemory; conn: Connection; query: JourneyQuery; closure: Closure }) {
  const plan = usePlanB(query, conn, stretchOfClosure(route, closure), true);
  if (plan === undefined) return <Skeleton className="mt-2 ml-7 h-[72px] rounded-[15px]" />;
  return plan ? <PlanBLink plan={plan} className="mt-2 ml-7" /> : null;
}

/**
 * During a disruption (live, or the simulated closed line): what usually happens next,
 * for the expanded part of the alert. The stretch's history is one tap further.
 */
export function ClosureDetails({
  route,
  conn,
  query,
  closure,
  offeredVia,
}: {
  route: RouteMemory;
  conn: Connection;
  query: JourneyQuery;
  closure: Closure;
  /** The detour station of a way round the traveller already has in the timeline ("Take instead"). */
  offeredVia?: string;
}) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  if (now === null) return null;
  const stretch = stretchOfClosure(route, closure);
  const start = Date.parse(closure.start);
  const elapsed = Math.max(0, (now * 1000 - start) / 60000);
  const announced = closure.end ? (Date.parse(closure.end) - start) / 60000 : null;
  const steps = scriptFor(route.memory, closure.cause, elapsed, announced);
  // The detour the traveller is being sent on, else the one staff advised most (never through a station of this journey).
  const advised = stretch ? advisedDetour([stretch], [query.from, query.to, ...stationsOf(conn)])?.detour : undefined;
  const detour = stretch?.detours.find((d) => d.via === offeredVia) ?? (advised && advised.n > 0 ? advised : undefined);
  return (
    <div className="mt-2.5 pl-7">
      <p className="text-[12px] font-bold tracking-wide text-muted uppercase">What usually happens next</p>
      <Steps steps={steps} start={start} className="mt-1.5" />
      {detour && (
        <p className={cn(SUB, "mt-2")}>
          Staff sent travellers via {detour.via} {times(detour.n)} before
          {detour.after !== null && `, about ${formatMinutes(detour.after)} into the disruption`}.{offeredVia === detour.via && " You have it now."}
        </p>
      )}
      {stretch && <TicketNote stretch={stretch} className="mt-2" />}
      {stretch && stretch.n > 0 && (
        <button onClick={() => setOpen(true)} className="mt-2 flex items-center gap-1 text-left text-[13px] leading-snug font-bold">
          Past disruptions on this stretch
          <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} />
        </button>
      )}
      {open && stretch && <LineMemorySheet title="Past disruptions" memory={route.memory} stretch={stretch} conn={conn} query={query} history onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The usual order of events: clock times from `start` (epoch ms), or minutes after the start without one. */
function Steps({ steps, start, className }: { steps: Step[]; start?: number; className?: string }) {
  return (
    <ol className={cn("space-y-1", className)}>
      {steps.map((s) => (
        <li key={s.key} className={cn("flex items-baseline gap-2.5 text-[13px] leading-snug", s.done ? "font-light text-muted" : s.key === "end" ? "font-bold" : "font-light")}>
          <span className={cn("shrink-0 tabular-nums", start === undefined ? "w-[62px]" : "w-[46px]")}>
            {start === undefined ? `+${s.minutes} min` : s.done ? <Check aria-label="Usually by now" className="relative top-0.5 size-3.5" strokeWidth={2} /> : `~${clock(start + s.minutes * 60000)}`}
          </span>
          <span className="min-w-0 flex-1">
            {s.label}
            {s.done && start !== undefined ? <span> · usually by now</span> : s.share !== null && <span className="text-muted"> · {inTen(s.share)} cases</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The way round as a real connection; opens it. */
function PlanBLink({ plan, className, compare = "later than planned" }: { plan: PlanB; className?: string; compare?: string }) {
  const c = plan.connection;
  return (
    <Link
      href={journeyHref("/connections/detail", plan.query, { key: connectionKey(c) })}
      onClick={() => rememberConnections([c])}
      className={cn("flex items-center gap-3 rounded-[15px] border border-fg/25 px-3 py-2.5 transition-colors hover:bg-fg/5", className)}
    >
      <Split className="size-4.5 shrink-0 rotate-90" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] leading-snug font-bold">Plan B via {plan.detour.via}</span>
        <span className={cn(SUB, "block truncate")}>
          {formatTime(c.from.departure)} → {formatTime(c.to.arrival)} · {c.products.join(" → ")}
        </span>
        <span className={cn(SUB, "block")}>{plan.extraMinutes > 0 ? `${formatMinutes(plan.extraMinutes)} ${compare}` : "No later than planned"}</span>
      </span>
      <ChevronRight className="size-4.25 shrink-0" strokeWidth={1.5} />
    </Link>
  );
}

/** Whether tickets were valid on another route the last times. */
function TicketNote({ stretch, className }: { stretch: Stretch; className?: string }) {
  if (!stretch.ticketVia.length) return null;
  return (
    <p className={cn(SUB, "flex items-start gap-2", className)}>
      <Ticket className="mt-px size-3.5 shrink-0 text-ok" strokeWidth={2} />
      <span>In past disruptions here, tickets over this stretch were also valid via {stretch.ticketVia.join(" or ")}, without a new ticket.</span>
    </p>
  );
}

/** Minutes as one would say them: to 5 min under an hour, a quarter under three, else half an hour. */
function sayable(minutes: number, round: (n: number) => number = Math.round): string {
  const step = minutes < 60 ? 5 : minutes < 180 ? 15 : 30;
  return formatMinutes(Math.max(step, round(minutes / step) * step));
}

function Fact({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
      <Icon className="size-4.5 shrink-0 text-fg/70" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 text-[14.5px] leading-snug font-light">{children}</span>
    </li>
  );
}

const B = ({ children }: { children: React.ReactNode }) => <b className="font-bold">{children}</b>;

/**
 * Line memory for one stretch, kept to what a traveller acts on: the way round as a live
 * connection, then a handful of facts. The dated history stays folded away.
 */
export function LineMemorySheet({
  title = "If this line closes",
  memory,
  stretch,
  conn,
  query,
  compare,
  prefer,
  history = false,
  onClose,
}: {
  title?: string;
  memory: LineMemory;
  stretch: Stretch;
  /** The connection the way round is compared with. */
  conn: Connection;
  query: JourneyQuery;
  /** How the way round compares, after the minutes ("later than planned"). */
  compare?: string;
  /** Stop id of the detour already named to the traveller. */
  prefer?: string;
  /** Start with the dated history unfolded. */
  history?: boolean;
  onClose: () => void;
}) {
  const hasDetour = stretch.detours.length > 0;
  const plan = usePlanB(query, conn, hasDetour ? stretch : null, true, prefer);
  const [past, setPast] = useState(history);
  const over = overWithin([stretch]);
  const buses = stretch.bus.of > 0 && stretch.bus.n * 2 >= stretch.bus.of;
  return (
    <Sheet title={title} onClose={onClose}>
      {hasDetour && (
        <section className="mb-4">
          {plan === undefined && <Skeleton className="h-[72px] rounded-[15px]" />}
          {plan && <PlanBLink plan={plan} compare={compare} className="bg-surface" />}
          <p className={cn(SUB, "text-muted", plan !== null && "mt-2")}>
            {plan === null ? "No connection round this stretch fits your journey right now." : "What SBB staff advised the last times this line was closed, searched live for your journey."}
          </p>
        </section>
      )}

      <h3 className="pb-1.75 text-[13.5px] font-light tracking-tight">{stretchName(stretch)}</h3>
      <Card className="overflow-hidden">
        <ul>
          {stretch.n > 0 && (
            <Fact icon={Repeat}>
              Disrupted <B>{times(stretch.n)}</B> since {monthYear(memory.since)}
            </Fact>
          )}
          {over && (
            <Fact icon={Clock}>
              {over.most !== null ? (
                <>
                  Usually over within <B>{sayable(over.most, Math.ceil)}</B>
                </>
              ) : over.low === over.high ? (
                <>
                  Lasted about <B>{sayable(over.low)}</B>
                </>
              ) : (
                <>
                  Lasted <B>{sayable(over.low)}</B> to <B>{sayable(over.high)}</B>
                </>
              )}
            </Fact>
          )}
          {buses && (
            <Fact icon={Bus}>
              Replacement buses
              {stretch.bus.after !== null ? (
                <>
                  {" "}
                  after about <B>{sayable(stretch.bus.after)}</B>
                </>
              ) : (
                " were put on"
              )}
            </Fact>
          )}
          {stretch.ticketVia.length > 0 && (
            <Fact icon={Ticket}>
              Tickets were also valid via <B>{stretch.ticketVia.join(" or ")}</B>
            </Fact>
          )}
        </ul>
      </Card>

      {stretch.incidents.length > 0 && (
        <section className="mt-3">
          <button onClick={() => setPast((o) => !o)} aria-expanded={past} className="flex w-full items-center gap-1 py-1 text-left text-[13.5px] font-light tracking-tight text-muted">
            Past disruptions
            <ChevronDown className={cn("size-3.5 transition-transform", past && "rotate-180")} />
          </button>
          {past && (
            <ul className="mt-1 space-y-1.5">
              {stretch.incidents.slice(0, 5).map((i) => (
                <li key={i.i} className="flex gap-2.5 text-[13px] leading-snug font-light">
                  <span className="w-[86px] shrink-0 text-muted tabular-nums">{dayOf(i.d)}</span>
                  <span className="min-w-0 flex-1 truncate">{causeLabel(memory, i.c)}</span>
                  <span className="shrink-0 tabular-nums">{i.m ? formatMinutes(i.m) : "–"}</span>
                </li>
              ))}
              {stretch.incidents.length > 5 && <li className="text-[13px] font-light text-muted">and {stretch.incidents.length - 5} more before</li>}
            </ul>
          )}
        </section>
      )}

      <p className="mt-4 text-[12px] leading-snug font-light text-muted">From SBB’s live ticker and control centre log. The next disruption may go differently.</p>
    </Sheet>
  );
}

/** One tracked connection per commute direction, kept for the session: its path says which stretches it runs over. */
const commuteTrips = new Map<string, Promise<Connection | null>>();

/**
 * Line memory for the commuter route, as a slim last line of the commute card: the way round
 * staff advised for the usual train. Renders nothing for a route without such advice.
 */
export function CommuteMemory({ commute: c, back, className }: { commute: Commute; /** The direction due next. */ back: boolean; className?: string }) {
  const key = `${c.from}|${c.to}|${back}|${back ? c.backTime : c.outTime}`;
  const [trip, setTrip] = useState<{ key: string; conn: Connection; query: JourneyQuery } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const query = commuteQuery(c, back);
    let loading = commuteTrips.get(key);
    if (!loading) {
      loading = getConnections({ ...toConnectionsRequest(query), limit: 1, track: true })
        .then((list) => list[0] ?? null)
        .catch(() => {
          commuteTrips.delete(key);
          return null;
        });
      commuteTrips.set(key, loading);
    }
    loading.then((conn) => live && conn && setTrip({ key, conn, query }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the commute fields used.
  }, [key]);
  const current = trip?.key === key ? trip : null;
  const route = useRouteMemory(current?.conn);
  if (!current || !route) return null;
  const stretches = route.hits.map((h) => h.stretch);
  const advised = advisedDetour(stretches, [c.from, c.to, ...stationsOf(current.conn)]);
  if (!advised) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn("flex w-full animate-fade-in items-center gap-1.25 py-2 pr-3.5 pl-[63px] text-left text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70 transition-colors hover:bg-fg/5", className)}
      >
        <Split className="size-3.5 shrink-0 rotate-90" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">Plan B ready: via {advised.detour.via}</span>
        <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.5} />
      </button>
      {open && (
        <LineMemorySheet
          title="If your line closes"
          memory={route.memory}
          stretch={advised.stretch}
          conn={current.conn}
          query={current.query}
          compare="longer than your usual train"
          prefer={advised.detour.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
