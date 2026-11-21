"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Accessibility, Baby, BadgeSwissFranc, Bike, CircleUserRound, FileText, Gift, Luggage, Pencil, Tickets, Users, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { Card, DESK_COL, Header, InfoLine, ListRow, OutlineButton, Overlap, PillLink, PillToggle, PrimaryButton, Radio, Segmented, Sheet, cn, toast } from "@/components/ui";
import { LocationPicker } from "@/components/plan/location-picker";
import { CURRENT_LOCATION } from "@/lib/use-position";
import { actions, useAppState, useSetting, type Ticket } from "@/lib/store";
import { formatDate, formatTime } from "@/lib/format";
import { DogIcon, TicketIcon } from "@/components/icons";
import { fullName } from "@/lib/mock-data";
import { usePasses } from "@/lib/travelcards";
import { passCovering, passCoveringRestOfDay } from "@/lib/passes";
import { usePosition } from "@/lib/use-position";

/** MOCK catalogue: prices and texts are illustrative, not official fares. */
type Product = {
  label: string;
  icon: ReactNode;
  /** 2nd-class price; `first` is the 1st-class price when the product has classes. */
  price: number;
  first?: number;
  /** Validity in minutes; omitted = until the end of service on the day of purchase. */
  minutes?: number;
  area: string;
  text: string;
  kind?: "parking";
  /** A ticket for the buyer's own travel, pointless while one of their travelcards covers it: in the zones around them ("local") or anywhere. */
  travel?: "local" | "national";
};

const DAY_PASSES: Product[] = [
  { label: "Friends Day Pass for Youth", icon: <Users strokeWidth={1.1} />, price: 80, area: "GA area of validity", text: "One day of unlimited travel for up to four people under 25 travelling together, in 2nd class." },
  { label: "Saver Day Pass", icon: <TicketIcon glyph="percent" />, price: 29, first: 52, travel: "national", area: "GA area of validity", text: "Unlimited travel for one day. The earlier you buy, the cheaper it is; limited availability. Price shown with a Half Fare Travelcard." },
  { label: "Day Pass for the Half Fare Travelcard", icon: <TicketIcon glyph="day" />, price: 75, first: 127, travel: "national", area: "GA area of validity", text: "Unlimited travel for one day throughout the GA area of validity. Only valid with a Half Fare Travelcard." },
  { label: "Day Class Upgrade", icon: <Tickets strokeWidth={1.1} />, price: 52, area: "GA area of validity", text: "Travel in 1st class for a whole day with your 2nd-class ticket or travelcard." },
  { label: "Day Pass Children", icon: <Baby strokeWidth={1.1} />, price: 19, first: 33, area: "GA area of validity", text: "Unlimited travel for one day for children aged 6 to 16 accompanied by an adult." },
  { label: "Tandem Day Pass for GA Travelcard Youth", icon: <UsersRound strokeWidth={1.1} />, price: 25, area: "GA area of validity", text: "Take a companion along for a day: valid together with a GA Travelcard Youth." },
  { label: "Day Bike Pass", icon: <Bike strokeWidth={1.1} />, price: 14, area: "GA area of validity", text: "Take your bike with you for a whole day, where self-service bike loading is possible." },
  { label: "Day Pass Dog", icon: <DogIcon strokeWidth={1.1} />, price: 25, area: "GA area of validity", text: "Your dog travels with you for a whole day in 1st or 2nd class." },
];

const LOCAL: Product[] = [
  { label: "Short-distance and single ticket", icon: <TicketIcon glyph="route" />, price: 2.3, first: 3.9, minutes: 30, travel: "local", area: "Local zone", text: "Short-distance ticket for the fare network around your departure stop. Price shown with a Half Fare Travelcard." },
  { label: "Regional Day Pass", icon: <TicketIcon glyph="day" />, price: 6.9, first: 11.7, travel: "local", area: "Local zones", text: "Unlimited travel for one day in the zones around your departure stop. Price shown with a Half Fare Travelcard." },
];

const PARKING: Product[] = [
  { label: "1-hour parking ticket", icon: <TicketIcon glyph="parking" />, price: 1.5, minutes: 60, area: "P+Rail", kind: "parking", text: "Park for one hour at the selected P+Rail car park. Only valid together with a public-transport ticket." },
  { label: "24-hour parking ticket", icon: <TicketIcon glyph="day" />, price: 8, minutes: 24 * 60, area: "P+Rail", kind: "parking", text: "Park for 24 hours at the selected P+Rail car park. Only valid together with a public-transport ticket." },
];

const PRAIL = ["P+Rail Renens VD", "P+Rail Morges", "P+Rail Lausanne", "P+Rail Bussigny", "P+Rail Nyon", "P+Rail Yverdon-les-Bains", "P+Rail Vevey", "P+Rail Genève-Aéroport"];

const SERVICE_INFO: Record<string, { text: string; action: string; href?: string; done?: string }> = {
  Luggage: {
    text: "Send your luggage ahead from station to station or door to door and travel light. Book at least two days before departure; your luggage is ready at the destination from the second day after it is handed in.",
    action: "Book luggage transport",
    done: "Demo: luggage transport cannot be booked in the prototype.",
  },
  "Gift cards": {
    text: "Gift cards can be used as a means of payment for tickets and travelcards. Enter the code of your gift card to add its balance to your wallet.",
    action: "Redeem gift card",
  },
  "Mobility assistance": {
    text: "Travellers with reduced mobility can book boarding and alighting assistance at supported stations. Please register at least one hour before departure with the SBB Call Center Handicap (0800 007 102, free of charge in Switzerland, daily 5:00–24:00).",
    action: "Call 0800 007 102",
    href: "tel:+41800007102",
  },
};

const SERVICES = [
  { label: "Luggage", icon: Luggage },
  { label: "Gift cards", icon: Gift },
  { label: "Mobility assistance", icon: Accessibility },
  { label: "Refunds", icon: BadgeSwissFranc },
  { label: "Receipts", icon: FileText },
];

export default function ShopPage() {
  const [tab, setTab] = useState<"quick" | "services">("quick");
  const [dep, setDep] = useSetting<string>("shop.dep", "Ecublens VD, EPFL");
  const [prail, setPrail] = useSetting<string>("shop.prail", PRAIL[0]);
  const [product, setProduct] = useState<{ p: Product; place: string } | null>(null);
  const [edit, setEdit] = useState<"dep" | "prail" | null>(null);
  const [service, setService] = useState<string | null>(null);
  return (
    <div>
      <Header title="Shop & Services" extend>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "quick", label: "Quick access" },
            { value: "services", label: "Services" },
          ]}
        />
      </Header>
      <Overlap className={cn("space-y-4.25", DESK_COL)}>
        <Card className="flex h-[52px] items-center gap-1.5 px-[15px]">
          <CircleUserRound className="-ml-0.5 size-[35px] shrink-0" strokeWidth={0.9} />
          <span className="truncate text-[16px] font-bold">{fullName}</span>
        </Card>

        {tab === "quick" ? (
          <>
            <Group label="Dep:" value={dep} onEdit={() => setEdit("dep")}>
              {LOCAL.map((p) => (
                <PillLink key={p.label} icon={p.icon} label={p.label} onClick={() => setProduct({ p, place: dep })} />
              ))}
            </Group>
            <Group label="P+Rail:" value={prail} onEdit={() => setEdit("prail")}>
              {PARKING.map((p) => (
                <PillLink key={p.label} icon={p.icon} label={p.label} onClick={() => setProduct({ p, place: prail })} />
              ))}
            </Group>
            <div>
              <h2 className="-mt-[4.5px] px-[15px] pb-1.5 text-[16px] font-bold">Products</h2>
              <Card className="space-y-[8.5px] px-[15px] pt-3 pb-[15px]">
                <div className="flex items-center justify-between pb-1.25">
                  <p className="text-[16px] font-bold">Day Passes Switzerland</p>
                  <span className="flex size-5 items-center justify-center rounded-full bg-[#cfcfcf] text-[13px] font-bold text-black">{DAY_PASSES.length}</span>
                </div>
                {DAY_PASSES.map((p) => (
                  <PillLink key={p.label} icon={p.icon} label={p.label} onClick={() => setProduct({ p, place: "Switzerland" })} />
                ))}
              </Card>
            </div>
          </>
        ) : (
          <Card className="overflow-hidden">
            {SERVICES.map((s) => (
              <ListRow key={s.label} icon={s.icon} label={s.label} chevron onClick={() => setService(s.label)} />
            ))}
          </Card>
        )}
        <div className="h-[calc(78px+var(--home-inset))]" />
      </Overlap>

      {product && <ProductSheet product={product.p} place={product.place} onClose={() => setProduct(null)} />}
      {edit === "dep" && (
        <LocationPicker
          title="Departure stop"
          onClose={() => setEdit(null)}
          onPick={(e) => {
            setEdit(null);
            if (e.id === CURRENT_LOCATION) return toast("Demo: nearest stop not resolved here. Please pick a stop.");
            setDep(e.name);
          }}
          allowCurrent={false}
        />
      )}
      {edit === "prail" && (
        <Sheet title="P+Rail car park" onClose={() => setEdit(null)}>
          <Card className="overflow-hidden">
            {PRAIL.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPrail(p);
                  setEdit(null);
                }}
                className="flex w-full items-center gap-3 border-b border-surface-3 px-4 py-[12px] text-left text-[16px] font-light tracking-tight last:border-b-0"
              >
                <Radio checked={p === prail} /> {p}
              </button>
            ))}
          </Card>
        </Sheet>
      )}
      {service && <ServiceSheet service={service} onClose={() => setService(null)} />}
    </div>
  );
}

function ProductSheet({ product, place, onClose }: { product: Product; place: string; onClose: () => void }) {
  const router = useRouter();
  const passes = usePasses();
  const { plates } = useAppState();
  const [klass, setKlass] = useState<"2" | "1">("2");
  const [plate, setPlate] = useState(plates[0] ?? "");
  const price = klass === "1" && product.first ? product.first : product.price;
  const parking = product.kind === "parking";
  // Bought now, it is valid from now and (local tickets) around here: if a travelcard already covers that in 2nd class, don't sell it.
  const [openedAt] = useState(() => Date.now());
  const here = usePosition();
  const local = product.travel === "local" ? here : null;
  const coveredBy =
    product.travel && klass === "2"
      ? product.minutes
        ? passCovering(passes, openedAt, openedAt + product.minutes * 60_000, local)
        : passCoveringRestOfDay(passes, openedAt, local)
      : null;

  function buy() {
    if (parking && !plate.trim()) return toast("Please enter your licence plate.");
    const start = new Date();
    const end = new Date(start);
    if (product.minutes) end.setMinutes(end.getMinutes() + product.minutes);
    else end.setHours(23, 59, 59);
    actions.addTicket({
      id: `t-${start.getTime()}`,
      product: product.label,
      from: place,
      to: "",
      via: parking ? `licence plate ${plate.trim().toUpperCase()}` : product.area,
      validFrom: start.toISOString(),
      validTo: end.toISOString(),
      price,
      travelClass: klass === "1" ? 1 : 2,
    });
    if (parking && !plates.includes(plate.trim().toUpperCase())) actions.set({ plates: [...plates, plate.trim().toUpperCase()] });
    toast(`${product.label} purchased (demo, nothing was charged).`);
    router.push("/tickets");
  }

  return (
    <Sheet title={product.label} onClose={onClose}>
      <p className="px-1 text-[14.5px] leading-snug font-light text-fg/85">{product.text}</p>
      {product.first && (
        <div className="mt-4 flex">
          <PillToggle
            value={klass}
            onChange={setKlass}
            options={[
              { value: "2", label: "2nd cl." },
              { value: "1", label: "1st cl." },
            ]}
          />
        </div>
      )}
      {parking && (
        <input
          aria-label="Licence plate"
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          placeholder="Licence plate, e.g. VD 123456"
          className="mt-4 h-[44px] w-full rounded-[15px] bg-surface-2 px-3.5 text-[16px] font-light tracking-tight outline-none placeholder:text-muted"
        />
      )}
      <Card className="mt-4 space-y-2 p-4">
        <InfoLine label="Traveller" value={fullName} />
        <InfoLine label={parking ? "Car park" : "Valid for"} value={place === "Switzerland" ? product.area : place} />
        <InfoLine label="Validity" value={product.minutes ? (product.minutes >= 1440 ? "24 hours from purchase" : `${product.minutes} minutes from purchase`) : "Today until end of service"} />
        <div className="border-t border-line pt-2">
          <InfoLine label={<b className="font-bold text-fg">Total</b>} value={<b className="font-bold">CHF {price.toFixed(2)}</b>} />
        </div>
      </Card>
      <p className="my-3 px-1 text-[11px] text-muted">Prototype only — no payment is made. Prices are illustrative.</p>
      {coveredBy ? (
        <>
          <p className="mb-3 px-1 text-[13px] leading-snug font-light text-ok">Your {coveredBy} already covers this in 2nd class, where and for as long as the ticket would be valid.</p>
          <PrimaryButton disabled>No ticket needed</PrimaryButton>
        </>
      ) : (
        <PrimaryButton onClick={buy}>Buy for CHF {price.toFixed(2)}</PrimaryButton>
      )}
    </Sheet>
  );
}

function receiptText(t: Ticket) {
  return [
    "RECEIPT (prototype, not a valid document)",
    "",
    `Product:   ${t.product}`,
    `Route:     ${[t.from, t.to].filter(Boolean).join(" -> ")}`,
    `Class:     ${t.travelClass === 1 ? "1st" : "2nd"}`,
    `Valid:     ${formatDate(new Date(t.validFrom))} ${formatTime(t.validFrom)} - ${formatDate(new Date(t.validTo))} ${formatTime(t.validTo)}`,
    `Traveller: ${fullName}`,
    `Total:     CHF ${t.price.toFixed(2)} (incl. VAT)`,
    `Reference: ${t.id}`,
  ].join("\n");
}

function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ServiceSheet({ service, onClose }: { service: string; onClose: () => void }) {
  const { tickets } = useAppState();
  const [code, setCode] = useState("");
  const info = SERVICE_INFO[service];
  // Opened from a tap, so reading the clock once here is fine.
  const [now] = useState(() => Date.now());

  if (service === "Receipts" || service === "Refunds") {
    const refunds = service === "Refunds";
    const list = refunds ? tickets.filter((t) => new Date(t.validTo).getTime() > now) : tickets;
    return (
      <Sheet title={service} onClose={onClose} full>
        <p className="px-1 pb-3 text-[14.5px] leading-snug font-light text-fg/85">
          {refunds
            ? "Unused tickets can be refunded before the end of their validity. A deductible may apply to real refunds."
            : "Download a receipt for any ticket purchased in the app."}
        </p>
        {list.length === 0 && <p className="px-1 text-[14.5px] font-light text-muted">{refunds ? "You have no refundable tickets." : "No purchases yet."}</p>}
        <div className="space-y-[8.5px]">
          {list.map((t) => (
            <Card key={t.id} className="flex items-center gap-3 py-3 pr-3 pl-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold">{[t.from, t.to].filter(Boolean).join(" → ")}</p>
                <p className="truncate text-[12.5px] font-light text-fg/70">
                  {t.product} · {formatDate(new Date(t.validFrom))} · CHF {t.price.toFixed(2)}
                </p>
              </div>
              <button
                onClick={() => {
                  if (refunds) {
                    actions.removeTicket(t.id);
                    toast(`Refund of CHF ${t.price.toFixed(2)} requested (demo). The ticket was cancelled.`);
                  } else {
                    download(`receipt-${t.id}.txt`, receiptText(t));
                    toast("Receipt downloaded.");
                  }
                }}
                className="flex h-8 shrink-0 items-center rounded-full border border-fg/50 px-3.5 text-[13.5px] font-light"
              >
                {refunds ? "Refund" : "Receipt"}
              </button>
            </Card>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={service} onClose={onClose}>
      <p className="px-1 text-[14.5px] leading-snug font-light text-fg/85">{info.text}</p>
      {service === "Gift cards" && (
        <input
          aria-label="Gift card code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Gift card code"
          className="mt-4 h-[44px] w-full rounded-[15px] bg-surface-2 px-3.5 text-[16px] font-light tracking-tight outline-none placeholder:text-muted"
        />
      )}
      <div className="mt-5">
        {info.href ? (
          <OutlineButton href={info.href}>{info.action}</OutlineButton>
        ) : (
          <PrimaryButton
            onClick={() => {
              if (service === "Gift cards") {
                if (code.trim().length < 6) return toast("Please enter a valid gift card code (at least 6 characters).");
                setCode("");
                return toast("Demo: gift card accepted. No real balance was added.");
              }
              toast(info.done ?? "Not available in the prototype.");
            }}
          >
            {info.action}
          </PrimaryButton>
        )}
      </div>
    </Sheet>
  );
}

function Group({ label, value, children, onEdit }: { label: string; value: string; children: ReactNode; onEdit: () => void }) {
  return (
    <Card className="space-y-[8.5px] px-[15px] pt-[8.5px] pb-[15px]">
      <div className="flex items-center gap-2.5 pb-[1.5px]">
        <p className="min-w-0 flex-1 truncate text-[16px] font-light tracking-tight">
          {label} <b className="font-bold tracking-normal">{value}</b>
        </p>
        <button aria-label={`Edit ${label.replace(":", "")}`} onClick={onEdit} className="mr-1.5 flex size-[32px] shrink-0 items-center justify-center rounded-full border border-fg/50">
          <Pencil className="size-4.25" strokeWidth={1.25} />
        </button>
      </div>
      {children}
    </Card>
  );
}
