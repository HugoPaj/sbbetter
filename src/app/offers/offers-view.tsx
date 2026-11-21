"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowRightLeft, Bike, Info, Pencil, User } from "lucide-react";
import { Card, Checkbox, ErrorBox, Header, Overlap, PillToggle, PrimaryButton, Radio, Sheet, Spinner, Stepper, toast } from "@/components/ui";
import { DogIcon, LongArrow } from "@/components/icons";
import { journeyFromSearchParams } from "@/lib/journey-query";
import { fetchConnection } from "@/lib/connection-key";
import { estimateFare, cityOf } from "@/lib/pricing";
import { formatShortDate, formatTime } from "@/lib/format";
import { USER, fullName } from "@/lib/mock-data";
import { actions, useAppState, useSetting } from "@/lib/store";
import type { Connection } from "@/lib/transport";

type Offer = "regular" | "supersaver" | "p2p";

export function OffersView() {
  const router = useRouter();
  const sp = useSearchParams();
  const raw = sp.toString();
  const query = journeyFromSearchParams(new URLSearchParams(raw));
  const key = sp.get("key");

  const [conn, setConn] = useState<Connection | null | undefined>(undefined);
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
    fetchConnection(q, key, ctrl.signal)
      .then(setConn)
      .catch((e: Error) => e.name !== "AbortError" && setConn(null));
    return () => ctrl.abort();
  }, [raw, key]);

  if (!query) return <ErrorBox message="No journey selected." />;

  const fare = conn ? estimateFare(conn, { halfFare: USER.halfFare, returnTrip: trip === "return" }) : null;
  const depDate = conn ? new Date((conn.from.departureTimestamp ?? 0) * 1000) : null;
  const fromName = conn?.from.station.name ?? query.fromName;
  const toName = conn?.to.station.name ?? query.toName;
  const via = conn?.sections
    .filter((s) => s.journey)
    .slice(1)
    .map((s) => s.departure.station.name?.split(",")[0])
    .join(" · ");
  const firstMode = conn?.sections.find((s) => s.journey)?.journey?.category === "B" ? "Bus" : null;

  const base = fare ? (klass === "1" ? fare.firstClass : fare.secondClass) : 0;
  const perPerson =
    base +
    (city && fare ? fare.cityAddOn : 0) +
    (fare && klass === "2" && offer === "supersaver" ? fare.supersaverUpgrade : 0) +
    (fare && klass === "2" && offer === "p2p" ? fare.pointToPointUpgrade : 0);
  // MOCK: co-travellers pay the same fare, dogs the reduced fare, bikes at most a day bike pass.
  const bikePrice = Math.min(base, 14);
  const total = perPerson * party.persons + base * party.dogs + bikePrice * party.bikes;
  const productName = trip === "return" ? "Return Ticket" : "Point-to-point Ticket";
  const effectiveClass = klass === "1" || offer !== "regular" ? 1 : 2;

  function purchase() {
    if (!conn) return;
    const start = new Date((conn.from.departureTimestamp ?? Date.now() / 1000) * 1000);
    const end = new Date(start);
    end.setHours(23, 59, 59);
    actions.addTicket({
      id: `t-${Date.now()}`,
      product: productName,
      from: fromName ?? "",
      to: toName ?? "",
      via: (via || "direct") + (party.persons + party.dogs + party.bikes > 1 ? ` · ${partyLabel(party)}` : ""),
      validFrom: new Date(Math.min(Date.now(), start.getTime())).toISOString(),
      validTo: end.toISOString(),
      price: total,
      travelClass: effectiveClass as 1 | 2,
    });
    if (autoSave && key && !trips.some((t) => t.id === key)) {
      actions.toggleTrip({ id: key, query: query!, index: 0, departure: conn.from.departure ?? "", arrival: conn.to.arrival ?? "", summary: conn.products.join(" → ") });
    }
    toast(`Ticket purchased for CHF ${total.toFixed(2)} (demo, nothing was charged).`);
    router.push("/tickets");
  }

  return (
    <div>
      <Header title="Offers" back extend />
      <Overlap>
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
        </Card>

        <Card className="mt-4.25 flex items-center px-[15px] pt-2 pb-[9.5px]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold">{fullName}</p>
            <div className="mt-[1.5px] flex gap-6 text-[16px] font-light">
              <span className="flex items-center gap-[3.5px]">
                {party.persons} <Times /> <User className="size-[19px]" strokeWidth={1.1} />
              </span>
              <span className={`flex items-center gap-[3.5px] ${party.dogs ? "" : "text-white/65"}`}>
                {party.dogs} <Times /> <DogIcon className="size-[19px]" strokeWidth={1.1} />
              </span>
              <span className={`flex items-center gap-[3.5px] ${party.bikes ? "" : "text-white/65"}`}>
                {party.bikes} <Times /> <Bike className="size-[19px]" strokeWidth={1.1} />
              </span>
            </div>
          </div>
          <button aria-label="Edit travellers" onClick={() => setSheet("travellers")} className="flex size-[32px] shrink-0 items-center justify-center rounded-full border border-white/50">
            <Pencil className="size-4.25" strokeWidth={1.25} />
          </button>
        </Card>

        <div className="mt-[8.5px] flex gap-4.25">
          <PillToggle
            value={trip}
            onChange={setTrip}
            options={[
              { value: "single", label: <ArrowRight aria-label="Single" className="size-5" strokeWidth={1.1} /> },
              { value: "return", label: <ArrowRightLeft aria-label="Return" className="size-5" strokeWidth={1.1} /> },
            ]}
          />
          <PillToggle
            value={klass}
            onChange={setKlass}
            options={[
              { value: "2", label: "2nd cl." },
              { value: "1", label: "1st cl." },
            ]}
          />
        </div>
      </Overlap>

      {conn === undefined && <Spinner />}
      {conn === null && <ErrorBox message="Could not load offers." />}

      {fare && (
        <div className="mt-4.25 px-[8.5px]">
          <Card className="overflow-hidden">
            <button onClick={() => setOffer("regular")} className="flex w-full gap-2.5 px-[15px] pt-[14.5px] pb-3.5 text-left">
              <span className="pt-[1.5px]">
                <Radio checked={offer === "regular"} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="text-[16px] leading-[22px] font-bold">Regular offer</span>
                  <span className="text-[15px] font-bold whitespace-nowrap">
                    <span className="text-[12px]">CHF</span> {base.toFixed(2)}
                  </span>
                </div>
                <p className="text-[14px] leading-[20px] font-light tracking-tight">
                  {fromName} - {toName}
                  {(firstMode || via) && (
                    <>
                      <br />
                      via {[firstMode, via].filter(Boolean).join(" · ")}
                    </>
                  )}
                </p>
              </div>
            </button>
            <button onClick={() => setCity((c) => !c)} className="ml-[44px] flex h-[53px] w-[calc(100%-44px)] items-center gap-3 border-t border-surface-3 pr-[15px] text-left">
              <Checkbox checked={city} />
              <span className="min-w-0 flex-1 truncate text-[16px] font-light tracking-tight">City {cityOf(toName ?? "")}</span>
              <span className="text-[16px] font-light whitespace-nowrap">
                + <span className="text-[12px]">CHF</span> {fare.cityAddOn.toFixed(2)}
              </span>
            </button>
            <button onClick={() => setSheet("info")} aria-label={`About the ${productName}`} className="ml-[44px] flex h-[57px] w-[calc(100%-44px)] items-center border-t border-surface-3 pr-4.25 text-left">
              <span className="flex-1 text-[16px] font-light tracking-tight">
                {party.persons}× {productName}
              </span>
              <Info className="size-[19px]" strokeWidth={1.25} />
            </button>
          </Card>

          {klass === "2" && (
            <>
              <h2 className="px-[8.5px] pt-[14.5px] pb-1.5 text-[13.5px] font-light tracking-tight">Additional offers</h2>
              <div className="space-y-[8.5px]">
                <OfferRow checked={offer === "supersaver"} onClick={() => setOffer("supersaver")} label="Supersaver Class Upgrade" price={fare.supersaverUpgrade} discount />
                <OfferRow checked={offer === "p2p"} onClick={() => setOffer("p2p")} label="Point-to-Point Class Upgrade" price={fare.pointToPointUpgrade} />
              </div>
            </>
          )}
        </div>
      )}
      <div className="h-[calc(204px+var(--home-inset))]" />

      {fare && (
        <div className="fixed bottom-0 left-1/2 z-30 flex w-full max-w-[430px] -translate-x-1/2 items-center gap-[8.5px] rounded-t-[22px] bg-[#1c1c1c] pt-[16.5px] pr-[18px] pb-[calc(var(--home-inset)+93px)] pl-4 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
          <button onClick={() => (quickBuy ? purchase() : setConfirm(true))} aria-label={quickBuy ? "Quick purchase" : "Pay"} className="flex h-[27px] w-[43.5px] shrink-0 items-center justify-center rounded-md border border-white/60 text-[13.5px] font-semibold">
            Pay
          </button>
          <PrimaryButton onClick={() => setConfirm(true)}>Continue to purchase overview</PrimaryButton>
        </div>
      )}

      {confirm && fare && (
        <Sheet title="Purchase overview" onClose={() => setConfirm(false)}>
          <Card className="space-y-1.75 p-4.25 text-[14.5px] font-light">
            <Line label="Traveller" value={fullName} />
            {party.persons + party.dogs + party.bikes > 1 && <Line label="Travelling with" value={partyLabel(party)} />}
            <Line label="Route" value={`${fromName} → ${toName}`} />
            <Line label="Class" value={effectiveClass === 1 ? "1st class" : "2nd class"} />
            <Line label="Ticket" value={trip === "return" ? "Return" : "Single"} />
            {USER.halfFare && <Line label="Reduction" value="Half Fare Travelcard" />}
            <div className="border-t border-line pt-2.5">
              <Line label={<b className="font-bold">Total</b>} value={<b className="font-bold">CHF {total.toFixed(2)}</b>} />
            </div>
          </Card>
          <p className="my-3.5 px-[3.5px] text-[11px] text-muted">Prototype only — no payment is made. Prices are estimated.</p>
          <PrimaryButton onClick={purchase}>Buy for CHF {total.toFixed(2)}</PrimaryButton>
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
          <p className="my-3 px-1 text-[11px] text-muted">Co-passengers are managed under Profile → Co-passenger. Demo: every traveller is priced like the main traveller.</p>
          <PrimaryButton onClick={() => setSheet(null)}>Apply</PrimaryButton>
        </Sheet>
      )}
      {sheet === "info" && (
        <Sheet title={productName} onClose={() => setSheet(null)}>
          <ul className="space-y-2 px-1 text-[14.5px] leading-snug font-light text-white/85">
            <li>
              {trip === "return" ? "Valid for the outward and return journey" : "Valid for a single journey"} from {fromName} to {toName}
              {via ? ` via ${via}` : ""} on the day of travel.
            </li>
            <li>Valid on all connections of the chosen route until the end of service (5 am the next day); not tied to a specific train.</li>
            <li>{effectiveClass === 1 ? "1st" : "2nd"} class. The price shown includes your Half Fare Travelcard discount.</li>
            <li>Refundable before the first day of validity (a deductible may apply).</li>
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

function OfferRow({ checked, onClick, label, price, discount }: { checked: boolean; onClick: () => void; label: string; price: number; discount?: boolean }) {
  return (
    <button onClick={onClick} className="relative flex min-h-[51px] w-full items-center gap-2.5 overflow-hidden rounded-[19px] bg-surface px-[15px] py-2.5 text-left">
      {discount && <span className="absolute top-0 right-0 h-[15px] rounded-bl-[8.5px] bg-surface-3 pr-2.5 pl-3 text-[11px] leading-[15px] font-bold">%</span>}
      <Radio checked={checked} />
      <span className="min-w-0 flex-1 text-[16px] leading-tight font-light tracking-tight">{label}</span>
      <span className="text-[16px] font-light whitespace-nowrap">
        <span className="text-[12px]">CHF</span> {price.toFixed(2)}
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
