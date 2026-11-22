import { queryForConnection } from "./connection-key";
import { boarding, wayAround, type Verdict } from "./disruption";
import { zurichDateTime } from "./format";
import type { JourneyQuery } from "./journey-query";
import { closureOf, findPlanB, loadLineMemory, stretchesOn, type PlanB, type Stretch } from "./line-memory";
import { disruptionOf, hitSections, nextMove, runsOver, type ReplayStop, type Snapshot } from "./replay";
import type { Connection } from "./transport";

/**
 * The replayed disruption as the same verdict the simulated ones give (lib/disruption.ts):
 * one sentence, the rides over the closed line marked "Line closed", and the connection
 * to take instead, which the traveller can accept to swap their trip for it.
 *
 * The way round, in order: the detour SBB's ticker advises for this journey (once it does),
 * the detour staff advised the last times this stretch closed (line memory, from minute
 * zero), else any real connection that keeps off the closed stretch.
 */
export async function replayVerdict(conn: Connection, query: JourneyQuery, snap: Snapshot, signal?: AbortSignal): Promise<Verdict | null> {
  const st = snap.state;
  const move = nextMove(snap, conn);
  if (!st || !move) return null;
  const hits = hitSections(conn, st);
  const d = disruptionOf(snap);
  const memory = await loadLineMemory().catch(() => null);
  const closure = memory && d ? closureOf([d], memory, snap.start + snap.t * 60000 + 1, stretchesOn(conn, memory).map((h) => h.stretch)) : null;
  const base = {
    tone: move.tone,
    headline: move.headline,
    why: `${st.summary}. ${move.source}.`,
    note: `(Replay of a real disruption, ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(snap.replay.start))}.)`,
    closure: closure ? { ...closure, cause: snap.replay.cause } : undefined,
  };
  // Trains run again (or are about to): nothing to re-plan.
  if (move.tone !== "act") return { ...base, detail: move.detail, notes: {} };

  const notes: Verdict["notes"] = Object.fromEntries(hits.map((i) => [i, { kind: "closed" as const }]));
  const at = hits[0];
  const firstRide = conn.sections.findIndex((s) => s.journey);
  const leg = conn.sections[at];
  // A closed stretch only reached after a change keeps the legs before it: the way round starts at that change.
  const rejoin = at > firstRide;
  const from: JourneyQuery = rejoin
    ? {
        ...query,
        from: leg.departure.station.id ?? leg.departure.station.name ?? query.from,
        fromName: leg.departure.station.name ?? query.fromName,
        ...zurichDateTime(new Date((leg.departure.departureTimestamp ?? 0) * 1000)),
        isArrivalTime: false,
        walkMinutes: undefined,
        via: undefined,
        viaName: undefined,
      }
    : queryForConnection(query, conn);
  const arrival = conn.to.arrivalTimestamp ?? 0;

  let plan: PlanB | null = null;
  if (move.via) {
    const stretch = adviceStretch(snap, leg, move.via);
    if (stretch) plan = await findPlanB(from, arrival, stretch, signal, move.via.id);
  }
  const remembered = closure?.stretch ? (memory?.stretches.find((s) => s.key === closure.stretch) ?? null) : null;
  if (!plan && remembered?.detours.length) plan = await findPlanB(from, arrival, remembered, signal);
  // The closed stretch as SBB gives it, which a remembered detour may not cover (a longer closure).
  const blocked = (s: Connection["sections"][number]) => st.segments.some((seg) => runsOver(s, seg));
  let planOk = plan && !plan.connection.sections.some(blocked) ? plan : null;
  let way = planOk ? undefined : await wayAround(from, conn, leg, signal, blocked);
  // Still nothing: the replay's own hand-picked ways round (across the lake when Lausanne – Genève is cut).
  for (const d of planOk || way ? [] : (snap.replay.detours ?? [])) {
    const stretch = adviceStretch(snap, leg, { ...d, lat: 0, lon: 0 });
    const found = stretch && (await findPlanB(from, arrival, stretch, signal, d.id));
    if (found && !found.connection.sections.some(blocked)) {
      planOk = found;
      way = undefined;
      break;
    }
  }

  const keep = rejoin ? { at: at - 1, late: 0 } : undefined;
  return {
    ...base,
    detail: planOk
      ? `Go via ${planOk.detour.via}: take the ${boarding(planOk.connection)}.`
      : way
        ? `Take the ${boarding(way.connection)} instead.`
        : `${move.detail} We found no other connection that keeps off the closed line.`,
    notes,
    alternative: planOk
      ? { query: planOk.query, connection: planOk.connection, lateMinutes: Math.max(0, planOk.extraMinutes), rejoin: keep }
      : way && { ...way, rejoin: keep },
  };
}

/** SBB's detour as a stretch line memory's Plan B search understands: the closed stretch this ride runs over. */
export function adviceStretch(snap: Snapshot, ride: Connection["sections"][number], via: ReplayStop): Stretch | null {
  const seg = snap.state?.segments.find((s) => runsOver(ride, s));
  if (!seg) return null;
  return {
    key: `replay:${snap.replay.key}:${via.id}`,
    ends: seg.map((x) => ({ name: x.name, id: x.id, lat: x.lat, lon: x.lon })),
    line: null,
    n: 0,
    closed: 0,
    causes: [],
    bus: { of: 0, n: 0, after: null },
    detours: [{ via: via.name, id: via.id, n: 1, after: null, quote: null, quoted: null, staff: false }],
    ticketVia: [],
    incidents: [],
  };
}
