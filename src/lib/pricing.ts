import { haversine } from "./format";
import type { Connection, NovaFare } from "./transport";
import type { FareState } from "./fares";
import { coverageOf, partRef, type Passes } from "./passes";

/**
 * Ticket prices. Real NOVA prices (via OJP Fare, see src/lib/fares.ts) when
 * available; otherwise a MOCK estimate from the straight-line distance, roughly
 * calibrated so that EPFL → Genève-Aéroport with a Half Fare card ≈ CHF 14.20.
 *
 * A travelcard that covers part of the trip (Night GA, see src/lib/passes.ts)
 * turns the price into the tickets for the uncovered stretches only.
 */
export type Quote = {
  source: "nova" | "estimate";
  /** Product NOVA priced, e.g. "Supersaver Ticket" (real fares only). */
  secondName?: string | null;
  secondClass: number;
  /** Set when a travelcard covers some or all of the trip: `secondClass` is then the sum of `tickets`. */
  pass?: PassSaving;
};

export type Fare = Quote & {
  firstName?: string | null;
  firstClass: number;
  supersaverUpgrade: number;
  pointToPointUpgrade: number;
  cityAddOn: number;
};

export type PassSaving = {
  /** e.g. "Night GA", "Mobilis pass", "Night GA and Mobilis pass" */
  name: string;
  /** `name` lists more than one card. */
  several: boolean;
  /** Tickets still needed in 2nd class (none: the card covers the whole trip). */
  tickets: { from: string; to: string; price: number; product: string | null }[];
  /** 2nd class price of a ticket for the whole trip, i.e. what the card saves you from. Null in a quote that never asked for it. */
  through: number | null;
};

/** One line for cards and banners, e.g. "Ticket only to Morges, then Night GA". */
export function passSummary(pass: PassSaving, trip: { from: string | null; to: string | null }): string {
  if (!pass.tickets.length) return `Covered by your ${pass.name}`;
  const [t] = pass.tickets;
  if (pass.tickets.length === 1 && t.from === trip.from) return `Ticket only to ${t.to}, then ${pass.name}`;
  if (pass.tickets.length === 1 && t.to === trip.to) return `${pass.name} to ${t.from}, ticket only from there`;
  if (pass.tickets.length === 1) return `Ticket only ${t.from} → ${t.to}`;
  return `${pass.name} ${pass.several ? "cover" : "covers"} part of this journey`;
}

/** "with Night GA" for a price tag; several cards don't fit there. */
export const passTag = (pass: PassSaving) => `with ${pass.several ? "travelcards" : pass.name}`;

/** The same, spelled out for the connection screen: what to buy, and what the card is worth here. */
export function passNotice(pass: PassSaving, trip: { from: string | null; to: string | null }): { headline: string; detail: string } {
  const paid = pass.tickets.reduce((sum, t) => sum + t.price, 0);
  const saved = pass.through === null ? "" : `You save CHF ${(pass.through - paid).toFixed(2)}.`;
  const yours = `Your ${pass.name} ${pass.several ? "cover" : "covers"}`;
  if (!pass.tickets.length) return { headline: "No ticket needed", detail: `${yours} this whole journey in 2nd class. ${saved}` };
  const [t] = pass.tickets;
  if (pass.tickets.length === 1 && t.from === trip.from) return { headline: `You only need a ticket to ${t.to}`, detail: `${yours} ${t.to} → ${trip.to}. ${saved}` };
  if (pass.tickets.length === 1 && t.to === trip.to) return { headline: `You only need a ticket from ${t.from}`, detail: `${yours} ${trip.from} → ${t.from}. ${saved}` };
  if (pass.tickets.length === 1) return { headline: `You only need a ticket ${t.from} → ${t.to}`, detail: `${yours} the rest. ${saved}` };
  return { headline: "You only need tickets for part of this journey", detail: `${yours} the rest. ${saved}` };
}

const roundUp20 = (v: number) => Math.ceil(v * 5) / 5;

export function estimateFare(connection: Pick<Connection, "from" | "to">, opts: { halfFare: boolean; returnTrip?: boolean }): Fare {
  const a = connection.from.station.coordinate;
  const b = connection.to.station.coordinate;
  const km = a.x && a.y && b.x && b.y ? (haversine(a.x, a.y, b.x, b.y) / 1000) * 1.2 : 10;

  let full = Math.max(4.4, 3.6 + km * 0.39);
  if (opts.returnTrip) full *= 2;
  const factor = opts.halfFare ? 0.5 : 1;

  const second = roundUp20(full * factor);
  const first = roundUp20(full * 1.75 * factor);
  return {
    source: "estimate",
    secondClass: second,
    firstClass: first,
    supersaverUpgrade: roundUp20((first - second) * 0.6),
    pointToPointUpgrade: roundUp20(first - second),
    cityAddOn: opts.halfFare ? 1.8 : 3.6,
  };
}

/** City name for the "City <x>" add-on, e.g. "Genève-Aéroport" → "Genève". */
export function cityOf(stationName: string): string {
  return stationName.split(/[,\s-]/)[0] ?? stationName;
}

/**
 * Fare for a connection with the traveller's travelcards. `fareOf` looks up
 * the NOVA price behind a fare ref (the whole trip, or one stretch of it).
 * Returns null while a real price is still loading.
 */
export function priceConnection(connection: Connection, fareOf: (ref: string | undefined) => FareState, opts: { passes: Passes; returnTrip?: boolean }): Fare | null {
  const o = { halfFare: opts.passes.halfFare, returnTrip: opts.returnTrip };
  const through = priceTicket(connection, fareOf(connection.fareRef), o);
  if (!through) return null;
  const coverage = coverageOf(connection, opts.passes);
  if (!coverage.pass) return through;

  const tickets: PassSaving["tickets"] = [];
  for (const part of coverage.parts) {
    const state = fareOf(connection.fareRef && partRef(connection.fareRef, part));
    if (state.status === "loading") return null;
    const fare = priceTicket(part, state, o)!;
    // Never weigh an estimated stretch against a real through price.
    if (fare.source !== through.source) return through;
    tickets.push({ from: part.from.station.name ?? "", to: part.to.station.name ?? "", price: fare.secondClass, product: fare.secondName ?? null });
  }
  const second = round2(tickets.reduce((sum, t) => sum + t.price, 0));
  // Short hops have minimum and zone fares: a through ticket can be no dearer.
  if (tickets.length && second >= through.secondClass) return through;
  // The card is 2nd class only: 1st class costs a class upgrade for the whole route on top.
  const upgrade = Math.max(0, through.firstClass - through.secondClass);
  return {
    ...through,
    secondClass: second,
    firstClass: round2(second + upgrade),
    secondName: tickets.length === 1 ? tickets[0].product : null,
    firstName: null,
    pass: { name: coverage.pass, several: coverage.several, tickets, through: through.secondClass },
  };
}

/**
 * The 2nd class price of a departure that is only being compared with another
 * (cheaper-departure suggestions), with as few price lookups as possible: the
 * price API is rate limited. Where a travelcard covers the trip, the ticket for
 * the whole trip is not looked up: a covered trip costs nothing, a partly
 * covered one its remaining tickets. (The full price can be a little lower
 * when a through ticket beats them; the connection page works that out.)
 */
export function quoteConnection(connection: Connection, fareOf: (ref: string | undefined) => FareState, passes: Passes): Quote | null {
  const coverage = coverageOf(connection, passes);
  // No card involved, or the through price is already known: price it properly.
  if (!coverage.pass || fareOf(connection.fareRef).status !== "loading") return priceConnection(connection, fareOf, { passes });
  const tickets: PassSaving["tickets"] = [];
  let source: Quote["source"] = "nova";
  for (const part of coverage.parts) {
    const state = fareOf(connection.fareRef && partRef(connection.fareRef, part));
    if (state.status === "loading") return null;
    const fare = priceTicket(part, state, { halfFare: passes.halfFare })!;
    if (fare.source === "estimate") source = "estimate";
    tickets.push({ from: part.from.station.name ?? "", to: part.to.station.name ?? "", price: fare.secondClass, product: fare.secondName ?? null });
  }
  return {
    source,
    secondClass: round2(tickets.reduce((sum, t) => sum + t.price, 0)),
    secondName: tickets.length === 1 ? tickets[0].product : null,
    pass: { name: coverage.pass, several: coverage.several, tickets, through: null },
  };
}

/** One ticket between two stops: NOVA's cheapest (often a Supersaver) when we have it, else the estimate. Upgrades and the City add-on stay modelled. */
function priceTicket(route: Pick<Connection, "from" | "to">, state: FareState, opts: { halfFare: boolean; returnTrip?: boolean }): Fare | null {
  if (state.status === "loading") return null;
  if (state.status === "estimate") return estimateFare(route, opts);
  return fromNova(state.fare, estimateFare(route, opts), opts);
}

function fromNova(n: NovaFare, est: Fare, opts: { halfFare: boolean; returnTrip?: boolean }): Fare {
  const mult = opts.returnTrip ? 2 : 1;
  const second = n.second! * mult;
  // NOVA sometimes prices only 2nd class; keep the usual 1st/2nd ratio then.
  const first = n.first !== null ? n.first * mult : roundUp20(second * 1.75);
  const diff = Math.max(0, first - second);
  return {
    source: "nova",
    secondName: n.secondName,
    firstName: n.firstName,
    secondClass: round2(second),
    firstClass: round2(first),
    supersaverUpgrade: roundUp20(diff * 0.6),
    pointToPointUpgrade: round2(diff),
    cityAddOn: est.cityAddOn,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
