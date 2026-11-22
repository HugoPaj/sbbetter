"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowRightLeft, Bike, Info, Pencil, Ticket, User } from "lucide-react";
import { Card, Checkbox, DESK_COL, ErrorBox, Header, Overlap, PillToggle, PrimaryButton, Radio, Sheet, Skeleton, Stepper, cn, toast } from "@/components/ui";
import { DEMO_TICKETS } from "@/lib/flags";
import { OffersSkeleton } from "@/components/skeletons";
import { DogIcon, LongArrow } from "@/components/icons";
import { journeyFromSearchParams } from "@/lib/journey-query";
import { openSbb, sbbHandoff } from "@/lib/sbb-deeplink";
import { cachedConnection, loadConnection, rerouteFromSearchParams, rerouteParams } from "@/lib/connection-key";
import { cityOf, estimateFare, passSummary } from "@/lib/pricing";
import { coverageOf, cutConnection } from "@/lib/passes";
import { usePrices } from "@/lib/fares";
import { endOfServiceDay, formatShortDate, formatTime, zurichDateTime, zurichEpoch } from "@/lib/format";
import { boardingStop, startLabel } from "@/lib/trip-label";
import { fullName } from "@/lib/mock-data";
import { usePasses } from "@/lib/travelcards";
import { actions, useAppState, useSetting } from "@/lib/store";
import type { Connection } from "@/lib/transport";

type Offer = "regular" | "supersaver" | "p2p";

/** The time, read in an event handler (kept out of render, where the purity rule forbids it). */
const clock = () => Date.now();

export function OffersView() {
  const passes = usePasses();
  const router = useRouter();
  const sp = useSearchParams();
  const raw = sp.toString();
  const query = journeyFromSearchParams(new URLSearchParams(raw));
  const key = sp.get("key");

  // Shown straight away when already seen this session, then refreshed.
  const cached = cachedConnection(new URLSearchParams(raw));
  const [loaded, setLoaded] = useState<{ raw: string; conn: Connection | null } | null>(null);
  const conn = loaded?.raw === raw ? loaded.conn : (cached ?? undefined);
  const [trip, setTrip] = useState<"single" | "return">("single");
  // Until the user picks a class here, follow Profile → Settings for ticket purchase.
  const [prefClass] = useSetting<string>("purchase.class", "2");
  const [pickedClass, setKlass] = useState<"2" | "1" | null>(null);
  const klass = pickedClass ?? (prefClass === "1" ? "1" : "2");
  const [quickBuy] = useSetting<boolean>("purchase.quick", false);
  const [autoSave] = useSetting<boolean>("purchase.autosave", true);
  const { coPassengers, trips } = useAppState();
  const [party, setParty] = useState({ persons: 1, dogs: 0, bikes: 0 });
  const [sheet, setSheet] = useState<"travellers" | "info" | null>(null);
  const [offer, setOffer] = useState<Offer>("regular");
  const [city, setCity] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const q = journeyFromSearchParams(new URLSearchParams(raw));
    if (!q) return;
    const ctrl = new AbortController();
    const sp = new URLSearchParams(raw);
    loadConnection(q, sp, ctrl.signal)
      .then((c) => setLoaded({ raw, conn: c ?? cachedConnection(sp) }))
      .catch((e: Error) => e.name !== "AbortError" && setLoaded({ raw, conn: cachedConnection(sp) }));
    return () => ctrl.abort();
  }, [raw, key]);

  const priceOf = usePrices(conn ? [conn] : null, passes);
  if (!query)
    return (
      <>
        <Header title="Offers" back="/plan" />
        <ErrorBox message="No journey selected." />
      </>
    );

  // With a travelcard covering part of the trip, the ticket is for the uncovered stretch only,
  // and nothing the card already covers may be sold. The card depends on the time of travel,
  // so the return is its own search: single tickets only.
  const single = conn ? priceOf(conn) : null;
  const pass = single?.pass;
  const isReturn = !pass && trip === "return";
  const fare = conn && isReturn ? priceOf(conn, { returnTrip: true }) : single;
  const stretch = pass?.tickets.length === 1 ? pass.tickets[0] : null;
  /** Nothing to buy in 2nd class for the card holder. */
  const covered = !!pass && pass.tickets.length === 0;
  /** The card is still valid on arrival, so local transport at the destination is covered too. */
  const arrivalCovered = !!pass && !pass.tickets.some((t) => t.to === conn?.to.station.name);
  const depDate = conn ? new Date((conn.from.departureTimestamp ?? 0) * 1000) : null;
  const fromName = conn?.from.station.name ?? query.fromName;
  const toName = conn?.to.station.name ?? query.toName;
  const via = conn?.sections
    .filter((s) => s.journey)
    .slice(1)
    .map((s) => s.departure.station.name?.split(",")[0])
    .join(" · ");
  const firstMode = conn?.sections.find((s) => s.journey)?.journey?.category === "B" ? "Bus" : null;

  /**
   * What there is to offer is known as soon as the connection is, unless a travelcard covers
   * part of it: which tickets are left to buy then depends on the prices. Until the price
   * arrives, the offers are shown as they are, with only the amounts still to come.
   */
  const known = !!conn && (!!fare || !coverageOf(conn, passes).pass);
  const base = fare ? (klass === "1" ? fare.firstClass : fare.secondClass) : 0;
  // Modelled, not looked up: it never waits for the price.
  const cityAddOn = fare?.cityAddOn ?? (conn ? estimateFare(conn, { halfFare: passes.halfFare }).cityAddOn : null);
  const cityOn = city && !arrivalCovered;
  const perPerson =
    base +
    (cityOn && fare ? fare.cityAddOn : 0) +
    (fare && klass === "2" && offer === "supersaver" ? fare.supersaverUpgrade : 0) +
    (fare && klass === "2" && offer === "p2p" ? fare.pointToPointUpgrade : 0);
  // The travelcard is personal: everyone else travelling along pays for the whole trip.
  const withoutCard = pass && fare ? (pass.through ?? fare.secondClass) - fare.secondClass : 0;
  // MOCK: co-travellers pay the same fare, dogs the reduced fare, bikes at most a day bike pass.
  const bikePrice = Math.min(base + withoutCard, 14);
  const total = perPerson + (perPerson + withoutCard) * (party.persons - 1) + (base + withoutCard) * party.dogs + bikePrice * party.bikes;
  /** Tickets in the basket: the card holder needs none when covered in 2nd class. */
  const ticketCount = covered && klass === "2" ? party.persons - 1 : party.persons;
  const novaName = klass === "1" ? fare?.firstName : fare?.secondName;
  const upgradeName = klass === "1" || offer === "p2p" ? "Point-to-Point Class Upgrade" : offer === "supersaver" ? "Supersaver Class Upgrade" : null;
  const productKnown = !!fare || isReturn;
  const productName = isReturn ? "Return Ticket" : covered && ticketCount === 0 && upgradeName ? upgradeName : (novaName ?? "Point-to-point Ticket");
  const effectiveClass = klass === "1" || offer !== "regular" ? 1 : 2;
  /** NOVA's cheapest product can be a Supersaver: tied to the train and not refundable. */
  const saver = /saver|spar/i.test(productName);

  /**
   * Tickets are bought in the real SBB app (deep link). It can't tell us whether the traveller
   * bought it, so this remembers the purchase and asks on return (components/purchase-return.tsx);
   * a "yes" adds a record of the ticket, linked to this journey, to Tickets and Plan's Upcoming.
   * In demo mode (lib/flags.ts) the ticket is simply bought here, with a demo code.
   */
  function purchase() {
    if (!conn) return;
    const reroute = rerouteFromSearchParams(new URLSearchParams(raw));
    const tripId = key && key + (reroute ? `~${reroute.key}` : "");
    const trip = tripId ? { id: tripId, query: query!, departure: conn.from.departure ?? "", arrival: conn.to.arrival ?? "", summary: conn.products.join(" → "), fromStop: boardingStop(conn), params: reroute ? rerouteParams(reroute) : undefined } : undefined;
    // A point-to-point ticket is valid on its day of travel; it shows from now on.
    const now = clock();
    const start = new Date((conn.from.departureTimestamp ?? now / 1000) * 1000);
    // Valid until the end of service (05:00 Zurich time), and never before the train arrives.
    const arrival = (conn.to.arrivalTimestamp ?? 0) * 1000;
    const end = new Date(Math.max(endOfServiceDay(start).getTime(), arrival));
    // Bought ahead: valid from the start of the travel day (Zurich), not from now.
    const dayStart = (zurichEpoch(zurichDateTime(start).date, "00:00") ?? 0) * 1000;
    // A travelcard covering the rest: the ticket to buy is for the uncovered stretch only.
    const part = stretch ? coverageOf(conn, passes).parts[0] : undefined;
    const handoff = sbbHandoff(part ? cutConnection(conn, part.a, part.b) : conn, { travelClass: effectiveClass as 1 | 2, returnTrip: isReturn });
    const ticket = {
      id: `t-${now}`,
      // What was bought on top shows on the ticket too (the price includes it).
      product: [productName, cityOn ? `City ${cityOf(toName ?? "")}` : null].filter(Boolean).join(" + "),
      from: stretch?.from ?? startLabel(fromName ?? "", boardingStop(conn)),
      to: stretch?.to ?? toName ?? "",
      via: via || "direct",
      validFrom: new Date(now >= dayStart ? Math.min(now, start.getTime()) : dayStart).toISOString(),
      validTo: end.toISOString(),
      price: total,
      travelClass: effectiveClass as 1 | 2,
      trip,
    };
    if (DEMO_TICKETS) {
      actions.addTicket(ticket);
      if (autoSave && trip && !trips.some((t) => t.id === trip.id)) actions.toggleTrip({ ...trip, index: 0 });
      toast("Ticket bought (demo). It’s in Tickets and Plan’s Upcoming.");
      router.push("/tickets");
      return;
    }
    actions.startPurchase({ ticket: { ...ticket, source: "sbb-app" }, trip: autoSave && trip ? { ...trip, index: 0 } : undefined, sbb: handoff, at: now });
    openSbb(handoff);
  }

  return (
    <div>
      <Header title="Offers" back={`/connections/detail?${raw}`} extend />
      {/* The trip stays in view; the choices below scroll under it. */}
      <Overlap sticky fade className={cn(DESK_COL, "lg:static")}>
        <Card className="px-[18px] pt-[15px] pb-4">
          <p className="text-[16px] leading-[24px] font-bold">
            <span className="inline-block">
              {fromName} <LongArrow className="mx-1.25" />
            </span>{" "}
            <span className="inline-block">{toName}</span>
          </p>
          {conn && depDate && (
            <p className="text-[14.5px] font-light tracking-tight text-muted">
              {formatShortDate(depDate)}
              {depDate.getFullYear()}, {formatTime(conn.from.departure)}
            </p>
          )}
          {/* Holds the line of the departure, so the cards below don't move when it arrives. */}
          {conn === undefined && (
            <p className="flex h-[22px] items-center">
              <Skeleton className="h-[12px] w-[132px]" />
            </p>
          )}
        </Card>
      </Overlap>

      <div className={cn("px-[8.5px]", DESK_COL)}>
        <Card className="mt-4.25 flex items-center px-[15px] pt-2 pb-[9.5px]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold">{fullName}</p>
            <div className="mt-[1.5px] flex gap-6 text-[16px] font-light">
              <span className="flex items-center gap-[3.5px]">
                {party.persons} <Times /> <User className="size-[19px]" strokeWidth={1.1} />
              </span>
              <span className={`flex items-center gap-[3.5px] ${party.dogs ? "" : "text-fg/65"}`}>
                {party.dogs} <Times /> <DogIcon className="size-[19px]" strokeWidth={1.1} />
              </span>
              <span className={`flex items-center gap-[3.5px] ${party.bikes ? "" : "text-fg/65"}`}>
                {party.bikes} <Times /> <Bike className="size-[19px]" strokeWidth={1.1} />
              </span>
            </div>
          </div>
          <button aria-label="Edit travellers" onClick={() => setSheet("travellers")} className="flex size-[32px] shrink-0 items-center justify-center rounded-full border border-fg/50">
            <Pencil className="size-4.25" strokeWidth={1.25} />
          </button>
        </Card>

        <div className="mt-[8.5px] flex gap-4.25">
          {!pass && (
            <PillToggle
              value={trip}
              onChange={setTrip}
              options={[
                { value: "single", label: <ArrowRight aria-label="Single" className="size-5" strokeWidth={1.1} /> },
                { value: "return", label: <ArrowRightLeft aria-label="Return" className="size-5" strokeWidth={1.1} /> },
              ]}
            />
          )}
          <PillToggle
            value={klass}
            onChange={setKlass}
            options={[
              { value: "2", label: "2nd cl." },
              { value: "1", label: "1st cl." },
            ]}
          />
        </div>
      </div>

      {/* Placeholder offers only while what there is to offer is itself unknown (see `known`). */}
      {conn !== null && !known && <OffersSkeleton className={DESK_COL} />}
      {conn === null && <ErrorBox message="Could not load offers." />}

      {known && (
        <div className={cn("mt-4.25 px-[8.5px]", DESK_COL)} aria-busy={!fare}>
          {pass && (
            <Card className="mb-[8.5px] flex items-start gap-2.5 px-[15px] py-3">
              <Ticket className="mt-0.5 size-4.5 shrink-0 text-ok" strokeWidth={1.75} />
              <div className="min-w-0">
                <p className="text-[14.5px] leading-snug font-bold">{passSummary(pass, { from: fromName ?? null, to: toName ?? null })}</p>
                <p className="mt-0.5 text-[13px] leading-snug font-light text-muted">
                  {pass.through !== null && <>A 2nd class ticket for the whole trip would cost CHF {pass.through.toFixed(2)}. </>}Your {pass.name} {pass.several ? "are" : "is"} valid in 2nd class; 1st class adds a class upgrade. Search the return separately so it is applied there too.
                  {party.persons + party.dogs + party.bikes > 1 && " It covers you only: everyone travelling with you pays for the whole trip."}
                </p>
              </div>
            </Card>
          )}
          <Card className="overflow-hidden">
            <button onClick={() => setOffer("regular")} className="flex w-full gap-2.5 px-[15px] pt-[14.5px] pb-3.5 text-left">
              <span className="pt-[1.5px]">
                <Radio checked={offer === "regular"} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="text-[16px] leading-[22px] font-bold">Regular offer</span>
                  <span className="text-[15px] font-bold whitespace-nowrap">
                    <Chf value={fare ? base : null} estimate={fare?.source === "estimate"} />
                  </span>
                </div>
                <p className="text-[14px] leading-[20px] font-light tracking-tight">
                  {!pass ? (
                    <>
                      {fromName} - {toName}
                    </>
                  ) : pass.tickets.length ? (
                    pass.tickets.map((t, i) => (
                      <span key={i} className="block">
                        {t.from} - {t.to}
                      </span>
                    ))
                  ) : klass === "1" ? (
                    <>Class upgrade {fromName} - {toName}</>
                  ) : (
                    <>No ticket needed in 2nd class</>
                  )}
                  {!pass && (firstMode || via) && (
                    <>
                      <br />
                      via {[firstMode, via].filter(Boolean).join(" · ")}
                    </>
                  )}
                </p>
              </div>
            </button>
            {!arrivalCovered && (
              <button onClick={() => setCity((c) => !c)} className="ml-[44px] flex h-[53px] w-[calc(100%-44px)] items-center gap-3 border-t border-surface-3 pr-[15px] text-left">
                <Checkbox checked={city} />
                <span className="min-w-0 flex-1 truncate text-[16px] font-light tracking-tight">City {cityOf(toName ?? "")}</span>
                <span className="text-[16px] font-light whitespace-nowrap">
                  + <Chf value={cityAddOn} estimate={fare?.source !== "nova"} />
                </span>
              </button>
            )}
            {ticketCount > 0 && (
              <button onClick={() => setSheet("info")} disabled={!productKnown} aria-label={`About the ${productKnown ? productName : "ticket"}`} className="ml-[44px] flex h-[57px] w-[calc(100%-44px)] items-center border-t border-surface-3 pr-4.25 text-left">
                <span className="flex flex-1 items-center gap-[5px] text-[16px] font-light tracking-tight">
                  {/* NOVA names the product it priced (e.g. a Supersaver Ticket). */}
                  {ticketCount}× {productKnown ? productName : <Skeleton className="h-[14px] w-[150px]" />}
                </span>
                <Info className="size-[19px]" strokeWidth={1.25} />
              </button>
            )}
          </Card>

          {klass === "2" && (
            <>
              <h2 className="px-[8.5px] pt-[14.5px] pb-1.5 text-[13.5px] font-light tracking-tight">Additional offers</h2>
              <div className="space-y-[8.5px]">
                <OfferRow checked={offer === "supersaver"} onClick={() => setOffer("supersaver")} label="Supersaver Class Upgrade" price={fare?.supersaverUpgrade ?? null} discount />
                <OfferRow checked={offer === "p2p"} onClick={() => setOffer("p2p")} label="Point-to-Point Class Upgrade" price={fare?.pointToPointUpgrade ?? null} />
              </div>
            </>
          )}
        </div>
      )}
      <div className="h-[calc(187px+var(--home-inset))]" />

      {conn !== null && (
        <div className="fixed bottom-0 left-1/2 z-30 flex w-full max-w-[430px] -translate-x-1/2 items-center lg:bottom-5 lg:left-[calc(50%+124px)] lg:max-w-[672px] lg:rounded-[22px] lg:border lg:border-fg/10 gap-[8.5px] rounded-t-[22px] bg-[#1c1c1c] light:bg-white pt-[16.5px] pr-[18px] pb-[calc(var(--home-inset)+76px)] pl-4 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
          {/* The buttons are there from the start, and work once there is a price to pay. */}
          {!fare || total > 0 ? (
            <>
              <button onClick={() => (quickBuy ? purchase() : setConfirm(true))} disabled={!fare} aria-label={quickBuy ? "Quick purchase" : "Pay"} className="flex h-[27px] w-[43.5px] shrink-0 items-center justify-center rounded-md border border-fg/60 text-[13.5px] font-semibold disabled:opacity-50">
                Pay
              </button>
              <PrimaryButton onClick={() => setConfirm(true)} disabled={!fare}>
                Continue to purchase overview
              </PrimaryButton>
            </>
          ) : (
            <PrimaryButton disabled>No ticket needed</PrimaryButton>
          )}
        </div>
      )}

      {confirm && fare && (
        <Sheet title="Purchase overview" onClose={() => setConfirm(false)}>
          <Card className="space-y-1.75 p-4.25 text-[14.5px] font-light">
            <Line label="Traveller" value={fullName} />
            {party.persons + party.dogs + party.bikes > 1 && <Line label="Travelling with" value={partyLabel(party)} />}
            <Line label="Route" value={pass?.tickets.length && klass === "2" ? pass.tickets.map((t) => `${t.from} → ${t.to}`).join(", ") : `${fromName} → ${toName}`} />
            <Line label="Class" value={effectiveClass === 1 ? "1st class" : "2nd class"} />
            <Line label="Ticket" value={isReturn ? "Return" : "Single"} />
            {(passes.halfFare || pass) && <Line label="Reduction" value={[passes.halfFare && "Half Fare Travelcard", pass?.name].filter(Boolean).join(", ")} />}
            <div className="border-t border-line pt-2.5">
              <Line label={<b className="font-bold">Total</b>} value={<b className="font-bold">CHF {total.toFixed(2)}</b>} />
            </div>
          </Card>
          <p className="my-3.5 px-[3.5px] text-[11px] text-muted">{DEMO_TICKETS ? "Demo purchase: nothing is charged and the ticket isn’t valid for travel." : "You pay in the SBB app (or on sbb.ch if it isn’t installed)."}{" "}
            {fare.source === "nova" ? "Prices from SBB's NOVA price service (OJP Fare test system)." : "Prices are estimated (≈); the SBB app shows the exact amount."}</p>
          <PrimaryButton onClick={purchase}>{DEMO_TICKETS ? "Buy" : "Buy in the SBB app"} · {fare.source === "estimate" ? "≈ " : ""}CHF {total.toFixed(2)}</PrimaryButton>
        </Sheet>
      )}

      {sheet === "travellers" && (
        <Sheet title="Travellers" onClose={() => setSheet(null)}>
          <Card className="overflow-hidden">
            {(
              [
                ["persons", "Travellers", `${fullName}${party.persons > 1 ? ` + ${coPassengerNames(coPassengers, party.persons - 1)}` : ""}`, 1],
                ["dogs", "Dogs", "Reduced fare", 0],
                ["bikes", "Bikes", "Bike ticket", 0],
              ] as const
            ).map(([k, label, hint, min]) => (
              <div key={k} className="flex items-center gap-3 border-b border-surface-3 px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-light tracking-tight">{label}</p>
                  <p className="truncate text-[12px] font-light text-muted">{hint}</p>
                </div>
                <Stepper label={label.toLowerCase()} value={party[k]} min={min} max={k === "persons" ? 6 : 3} onChange={(v) => setParty({ ...party, [k]: v })} />
              </div>
            ))}
          </Card>
          <p className="my-3 px-1 text-[11px] text-muted">Co-passengers are managed under Profile → Co-passenger. Demo: every traveller is priced like the main traveller, except that your GA-type travelcards cover you only.</p>
          <PrimaryButton onClick={() => setSheet(null)}>Apply</PrimaryButton>
        </Sheet>
      )}
      {sheet === "info" && (
        <Sheet title={productName} onClose={() => setSheet(null)}>
          <ul className="space-y-2 px-1 text-[14.5px] leading-snug font-light text-fg/85">
            <li>
              {isReturn ? "Valid for the outward and return journey" : "Valid for a single journey"} from {stretch?.from ?? fromName} to {stretch?.to ?? toName}
              {via && !pass ? ` via ${via}` : ""} on the day of travel.
            </li>
            {saver ? (
              <>
                <li>Valid only on the connection you chose: tied to these trains, at these times.</li>
                <li>
                  {effectiveClass === 1 ? "1st" : "2nd"} class.{passes.halfFare ? " The price shown includes your Half Fare Travelcard discount." : ""}
                </li>
                <li>Not refundable and cannot be exchanged.</li>
              </>
            ) : (
              <>
                <li>Valid on all connections of the chosen route until the end of service (5 am the next day); not tied to a specific train.</li>
                <li>
                  {effectiveClass === 1 ? "1st" : "2nd"} class.{passes.halfFare ? " The price shown includes your Half Fare Travelcard discount." : ""}
                </li>
                <li>Refundable before the first day of validity (a deductible may apply).</li>
              </>
            )}
          </ul>
          <p className="mt-3 px-1 text-[11px] text-muted">Prototype: conditions and prices are illustrative.</p>
        </Sheet>
      )}
    </div>
  );
}

function partyLabel(p: { persons: number; dogs: number; bikes: number }) {
  return [p.persons > 1 && `${p.persons} travellers`, p.dogs && `${p.dogs} dog${p.dogs > 1 ? "s" : ""}`, p.bikes && `${p.bikes} bike${p.bikes > 1 ? "s" : ""}`].filter(Boolean).join(", ");
}

function coPassengerNames(list: { name: string }[], n: number) {
  const named = list.slice(0, n).map((c) => c.name);
  const guests = n - named.length;
  return [...named, ...(guests > 0 ? [`${guests} guest${guests > 1 ? "s" : ""}`] : [])].join(", ");
}

function Times() {
  return <span className="text-[13px]">×</span>;
}

/** "CHF 12.40"; the amount is a placeholder while its price loads (null). */
function Chf({ value, estimate }: { value: number | null; estimate?: boolean }) {
  return (
    <>
      {estimate && value !== null && <abbr title="Estimated price" className="no-underline">≈ </abbr>}
      <span className="text-[12px]">CHF</span> {value === null ? <Skeleton className="inline-block h-[0.8em] w-[2.6em] align-baseline" /> : value.toFixed(2)}
    </>
  );
}

function OfferRow({ checked, onClick, label, price, discount }: { checked: boolean; onClick: () => void; label: string; price: number | null; discount?: boolean }) {
  return (
    <button onClick={onClick} className="relative flex min-h-[51px] w-full items-center gap-2.5 overflow-hidden rounded-[19px] bg-surface px-[15px] py-2.5 text-left">
      {discount && <span className="absolute top-0 right-0 h-[15px] rounded-bl-[8.5px] bg-surface-3 pr-2.5 pl-3 text-[11px] leading-[15px] font-bold">%</span>}
      <Radio checked={checked} />
      <span className="min-w-0 flex-1 text-[16px] leading-tight font-light tracking-tight">{label}</span>
      <span className="text-[16px] font-light whitespace-nowrap">
        <Chf value={price} />
      </span>
    </button>
  );
}

function Line({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3.5">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
