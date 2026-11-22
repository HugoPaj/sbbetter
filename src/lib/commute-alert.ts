import { connectionKey } from "./connection-key";
import { forecastDelay } from "./connection-estimate";
import { formatMinutes, formatTime, zurichDateTime } from "./format";
import { journeyHref, toConnectionsRequest, type JourneyQuery } from "./journey-query";
import { advisedDetour, closureOf, findPlanB, loadLineMemory, stretchName, stretchesOn, type LineMemory } from "./line-memory";
import type { Commute } from "./store";
import { getConnections, type Checkpoint, type Connection } from "./transport";

/**
 * Commute alerts: is the usual train on the commuter route late, likely late or
 * cut off? Checked on the server shortly before each commute (see
 * src/lib/server/commute-alerts.ts) and sent as a push notification, with the
 * Plan B from line memory when the line is closed.
 *
 * `checkCommute` gathers the facts (live data, delay forecast, line memory);
 * `composeAlert` turns them into the message, and is where the wording lives.
 */

/** Check this long before the usual departure, until it leaves. */
export const WINDOW_MINUTES = 60;
/** Live delays from this many minutes are worth a notification. */
export const LATE_MIN = 3;
/** Forecast delays (80 % sure it is no more) from this many minutes. */
export const FORECAST_MIN = 5;

export type Leg = { back: boolean; date: string; time: string };

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const weekday = (d: Date) => !["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", weekday: "short" }).format(d));

/**
 * The commute leg due for a check at `now`: from an hour before its usual departure until
 * then, on weekdays. `force` (the "Check now" button) takes the next one whatever the time.
 */
export function dueLeg(c: Commute, now: Date, force = false): Leg | null {
  const { date, time } = zurichDateTime(now);
  const t = minutesOf(time);
  for (const back of [false, true]) {
    const at = back ? c.backTime : c.outTime;
    const until = minutesOf(at) - t;
    if (until >= 0 && until <= WINDOW_MINUTES && (force || weekday(now))) return { back, date, time: at };
  }
  if (!force) return null;
  if (t < minutesOf(c.outTime)) return { back: false, date, time: c.outTime };
  if (t < minutesOf(c.backTime)) return { back: true, date, time: c.backTime };
  return { back: false, date: zurichDateTime(new Date(now.getTime() + 24 * 3600e3)).date, time: c.outTime };
}

export function legQuery(c: Commute, leg: Leg): JourneyQuery {
  return {
    from: leg.back ? c.to : c.from,
    fromName: leg.back ? c.toName : c.fromName,
    to: leg.back ? c.from : c.to,
    toName: leg.back ? c.fromName : c.toName,
    date: leg.date,
    time: leg.time,
    isArrivalTime: false,
    transportations: [],
  };
}

/** Everything an alert is made of. */
export type Facts = {
  /** The usual train: the first connection leaving at or after the usual time. */
  train: { time: string; line: string; to: string };
  /** Minutes late, from live data. */
  liveDeparture: number;
  liveArrival: number;
  /** A change that live delays break: where. */
  missedChange: string | null;
  /** Delay model, minutes at the destination (80 % sure it is no more). */
  forecast: number;
  /** A line on the way is closed right now. */
  closure: { stretch: string | null; planB: { via: string; time: string; line: string; arrival: string; extraMinutes: number; url: string } | null; advisedVia: string | null } | null;
  /** Another live service message on the way. */
  notice: string | null;
  /** Where staff sent travellers the last times this route's line closed. */
  planBVia: string | null;
  /** The usual train's page. */
  url: string;
};

export type CommuteAlert = {
  kind: "closed" | "missed" | "late" | "forecast" | "notice" | "ok";
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** Same for the same news: an alert is sent again only when this changes (a delay growing by 5 min, say). */
  signature: string;
};

/** The message for the facts, the most serious news first. */
export function composeAlert(f: Facts): CommuteAlert {
  const train = `${f.train.time} ${f.train.line}`;
  const planB = f.planBVia ? ` Plan B if the line closes: via ${f.planBVia}.` : "";
  const bucket = (m: number) => Math.floor(m / 5);

  if (f.closure) {
    const where = f.closure.stretch ? `${f.closure.stretch} is closed` : "A line on your way is closed";
    const p = f.closure.planB;
    return {
      kind: "closed",
      title: `Line closed on your way to ${f.train.to}`,
      body: p
        ? `${where}. Plan B: ${p.line} via ${p.via} at ${p.time}, arriving ${p.arrival}${p.extraMinutes > 0 ? ` (${formatMinutes(p.extraMinutes)} later)` : ""}.`
        : f.closure.advisedVia
          ? `${where}. Staff usually send travellers via ${f.closure.advisedVia}: check the way round.`
          : `${where}. Check other connections before you leave.`,
      url: p?.url ?? f.url,
      signature: `closed:${p?.via ?? ""}`,
    };
  }
  if (f.missedChange) {
    return {
      kind: "missed",
      title: `Your change at ${f.missedChange} won’t work`,
      body: `The ${train} is expected ${f.liveArrival || f.liveDeparture} min late, after your next train leaves. Tap for other connections.`,
      url: f.url,
      signature: `missed:${f.missedChange}`,
    };
  }
  const late = Math.max(f.liveDeparture, f.liveArrival);
  if (late >= LATE_MIN) {
    return {
      kind: "late",
      title: `${train} to ${f.train.to}: ${late} min late`,
      body: `${f.liveDeparture >= LATE_MIN ? `Expected to leave ${f.liveDeparture} min late.` : `Expected at ${f.train.to} ${f.liveArrival} min late.`}${planB}`,
      url: f.url,
      signature: `late:${bucket(late)}`,
    };
  }
  if (f.forecast >= FORECAST_MIN) {
    return {
      kind: "forecast",
      title: `${train} to ${f.train.to} is likely late`,
      body: `Our delay forecast says up to ${f.forecast} min late at ${f.train.to}.${planB}`,
      url: f.url,
      signature: `forecast:${bucket(f.forecast)}`,
    };
  }
  if (f.notice) {
    return { kind: "notice", title: `Service alert on your way to ${f.train.to}`, body: f.notice, url: f.url, signature: `notice:${f.notice}` };
  }
  return {
    kind: "ok",
    title: `${train} to ${f.train.to} runs on time`,
    body: `No delays or alerts right now. We’ll tell you if that changes.${planB}`,
    url: f.url,
    signature: "ok",
  };
}

const minuteOf = (iso: string) => Math.floor(Date.parse(iso) / 60000);
/** Minutes late at a stop from live data; 0 when on time or unknown. */
const lateAt = (cp: Checkpoint, side: "arrival" | "departure") => {
  const planned = cp[side];
  const live = cp.prognosis?.[side];
  return planned && live ? Math.max(0, minuteOf(live) - minuteOf(planned)) : 0;
};

/** The first change that live delays break, if any. */
function missedChangeOf(c: Connection): string | null {
  const rides = c.sections.filter((s) => s.journey);
  for (let i = 0; i + 1 < rides.length; i++) {
    const arrives = rides[i].arrival.prognosis?.arrival ?? rides[i].arrival.arrival;
    const leaves = rides[i + 1].departure.prognosis?.departure ?? rides[i + 1].departure.departure;
    if (arrives && leaves && Date.parse(arrives) > Date.parse(leaves)) return rides[i].arrival.station.name;
  }
  return null;
}

/** What to tell the commuter about this leg right now (null: nothing to check). */
export async function checkCommute(c: Commute, leg: Leg, now = new Date()): Promise<CommuteAlert | null> {
  const query = legQuery(c, leg);
  // The path of each leg (OJP), so line memory also matches trains that run through a stretch.
  const list = await getConnections({ ...toConnectionsRequest(query), limit: 4, track: true });
  const usual = `${leg.date}T${leg.time}`;
  const conn = list.find((x) => {
    const z = x.sections.find((s) => s.journey)?.departure.departure;
    return z && `${zurichDateTime(new Date(z)).date}T${zurichDateTime(new Date(z)).time}` >= usual;
  });
  if (!conn) return null;
  const rides = conn.sections.filter((s) => s.journey);
  const first = rides[0];
  const memory: LineMemory | null = await loadLineMemory().catch(() => null);

  const closure = memory ? closureOf(conn.disruptions, memory, now.getTime()) : null;
  let closureFacts: Facts["closure"] = null;
  if (closure && memory) {
    const stretch = closure.stretch ? memory.stretches.find((s) => s.key === closure.stretch) ?? null : null;
    const found = stretch ? await findPlanB(query, conn.to.arrivalTimestamp ?? 0, stretch).catch(() => null) : null;
    const pr = found?.connection.sections.find((s) => s.journey);
    closureFacts = {
      stretch: stretch ? stretchName(stretch) : null,
      advisedVia: stretch ? (advisedDetour([stretch], [query.from, query.to])?.detour.via ?? null) : null,
      planB:
        found && pr
          ? {
              via: found.detour.via,
              time: formatTime(pr.departure.departure),
              line: `${pr.journey!.category} ${pr.journey!.number}`.trim(),
              arrival: formatTime(found.connection.to.arrival),
              extraMinutes: found.extraMinutes,
              url: journeyHref("/connections/detail", found.query, { key: connectionKey(found.connection) }),
            }
          : null,
    };
  }

  const liveDeparture = lateAt(first.departure, "departure");
  const liveArrival = lateAt(conn.to, "arrival");
  // The forecast only matters while live data says nothing yet.
  const forecast = liveDeparture || liveArrival ? 0 : await forecastDelay(rides.at(-1)!).catch(() => 0);
  const hits = memory ? stretchesOn(conn, memory) : [];

  return composeAlert({
    train: { time: formatTime(first.departure.departure), line: `${first.journey!.category} ${first.journey!.number}`.trim(), to: query.toName },
    liveDeparture,
    liveArrival,
    missedChange: missedChangeOf(conn),
    forecast,
    closure: closureFacts,
    notice: closure ? null : (conn.disruptions?.find((d) => !d.planned)?.summary ?? null),
    planBVia: advisedDetour(hits.map((h) => h.stretch), [query.from, query.to])?.detour.via ?? null,
    url: journeyHref("/connections/detail", query, { key: connectionKey(conn) }),
  });
}
