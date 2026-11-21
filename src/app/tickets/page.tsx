"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, DESK_COL, Header, InfoLine, OutlineButton, Overlap, PrimaryButton, Segmented, Sheet, cn, toast } from "@/components/ui";
import { LongArrow, PhoneTicketIcon, QrOffIcon } from "@/components/icons";
import { USER } from "@/lib/mock-data";
import { travelcardNames, useCatalog, useTravelcards } from "@/lib/travelcards";
import { actions, useAppState, type Ticket } from "@/lib/store";
import { formatDate, formatTime, zurichDateTime } from "@/lib/format";
import { journeyHref } from "@/lib/journey-query";

/** MOCK travelcard details (dates are fictitious). */
const TRAVELCARDS: Record<string, { validity: string; text: string }> = {
  "Half Fare Travelcard": { validity: "01.01.2026 – 31.12.2026", text: "Travel at half price on trains, buses, boats and most mountain railways throughout Switzerland. Renews automatically." },
  "Night GA Travelcard": { validity: "01.01.2026 – 31.12.2026", text: "Unlimited travel in 2nd class from 7 pm until the end of service (5 am, or 7 am on Saturdays and Sundays). For young people under 25." },
  "Mobilis travelcard, zones 11 + 12": { validity: "01.01.2026 – 31.12.2026", text: "Unlimited travel in 2nd class on trains, metros and buses within Mobilis zones 11 and 12 (Grand Lausanne: Lausanne, Renens, Ecublens, Prilly, Pully, Epalinges, Lutry and neighbouring municipalities)." },
};

/** Deterministic QR-looking pattern (NOT a real, scannable code). */
function FakeQr({ seed, className }: { seed: string; className?: string }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const n = 25;
  const cells: boolean[] = [];
  for (let i = 0; i < n * n; i++) {
    h = (h * 1103515245 + 12345) | 0;
    cells.push(((h >>> 16) & 1) === 1);
  }
  const finder = (x: number, y: number) =>
    [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderOn = (x: number, y: number) => {
    for (const [fx, fy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      const dx = x - fx;
      const dy = y - fy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    }
    return false;
  };
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} className={cn("bg-white", className)} shapeRendering="crispEdges">
      {cells.map((on, i) => {
        const x = i % n;
        const y = Math.floor(i / n);
        const fill = finder(x, y) ? finderOn(x, y) : on;
        return fill ? <rect key={i} x={x} y={y} width="1" height="1" fill="#000" /> : null;
      })}
    </svg>
  );
}

const subscribeNoop = () => () => {};

export default function TicketsPage() {
  const [tab, setTab] = useState<"valid" | "expired">("valid");
  const { tickets } = useAppState();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Ticket | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [selection] = useTravelcards();
  const cards = travelcardNames(selection, useCatalog());
  const [zoom, setZoom] = useState(false);
  // Read the clock only on the client to keep render pure and hydration-safe.
  const now = useSyncExternalStore(subscribeNoop, () => Math.floor(Date.now() / 60000) * 60000, () => 0);
  const valid = tickets.filter((t) => new Date(t.validTo).getTime() >= now);
  const expired = tickets.filter((t) => new Date(t.validTo).getTime() < now);

  return (
    <div>
      <Header title="Tickets & Travelcards" extend={tab === "valid"}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "valid", label: "Valid" },
            { value: "expired", label: "Expired" },
          ]}
        />
      </Header>

      {tab === "valid" ? (
        <Overlap className="lg:mx-auto lg:grid lg:max-w-[1040px] lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:px-8">
          {/* SwissPass card (desktop: stays in view on the left, tickets on the right) */}
          <Card className="overflow-hidden lg:sticky lg:top-[88px]">
            <div className="relative flex justify-between overflow-hidden bg-[#b8242a] px-[15.5px] text-white pt-2 pb-[6.5px]">
              <DotField className="absolute top-[9px] right-[10px] h-[64px] w-[118px] text-white/80" />
              <div className="relative">
                <p className="text-[16px] leading-[22px] font-bold">
                  {USER.lastName}
                  <br />
                  {USER.firstName}
                </p>
                <p className="text-[14.5px] font-light tracking-tight">
                  {USER.birthDate} {USER.gender}
                </p>
              </div>
              <p className="relative mr-[85px] text-[13.5px] font-light">
                Swiss<b className="font-bold">Pass</b>
              </p>
            </div>
            <div className="bg-[#2a2a2a] light:bg-white px-[15.5px] pt-[16.5px] pb-[9px]">
              {page === 0 ? (
                <div className="flex items-stretch justify-between">
                  <button aria-label="Enlarge SwissPass code" onClick={() => setZoom(true)} className="w-[48.2%]">
                    <FakeQr seed={USER.email} className="aspect-square w-full rounded-[4.5px]" />
                  </button>
                  <div className="relative w-[37.7%] overflow-hidden rounded-t-[2.5px] bg-gradient-to-b from-[#f2f2f2] to-[#dcdcdc]">
                    <svg viewBox="0 0 80 100" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 size-full" aria-label="Photo placeholder">
                      <path d="M3 100c1-20 13-28 26-30h22c13 2 25 10 26 30z" fill="#56627f" />
                      <path d="M29 70l11 13 11-13z" fill="#f4f5f7" />
                      <rect x="33" y="54" width="14" height="21" rx="6" fill="#cf9c7d" />
                      <ellipse cx="40" cy="42" rx="16" ry="18" fill="#e2b193" />
                      <path d="M23 43q-3-24 17-24t17 24q-5-12-17-12t-17 12z" fill="#4a3226" />
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="flex aspect-[1/0.482] flex-col justify-center space-y-2 px-1">
                  <InfoLine label="SwissPass no." value="DEMO-000-000-0" />
                  <InfoLine label="Card holder" value={`${USER.firstName} ${USER.lastName}`} />
                  <InfoLine label="Date of birth" value={USER.birthDate} />
                  <InfoLine label="Card valid until" value="31.12.2030" />
                  <InfoLine label="Travelcards" value={String(cards.length)} />
                </div>
              )}
              <div className="mt-[9.5px] flex justify-center" role="tablist" aria-label="SwissPass pages">
                {[0, 1].map((i) => (
                  <button key={i} role="tab" aria-selected={page === i} aria-label={i === 0 ? "Code" : "Card details"} onClick={() => setPage(i)} className="-my-2 px-[5px] py-2">
                    <span className={cn("block size-1.75 rounded-full", page === i ? "bg-fg" : "bg-fg/40")} />
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <div className="lg:min-w-0">
          <div className="mt-[38.5px] space-y-[8.5px] lg:mt-0">
            {valid.length === 0 ? (
              <div className="rounded-[19px] border border-fg/35 bg-gradient-to-b from-[#1a1a1a] to-[#0c0c0c] light:from-white light:to-[#f6f6f6] px-5 pt-4.25 pb-3 text-center">
                <PhoneTicketIcon className="mx-auto h-[78px] w-[62px]" />
                <p className="mt-1.5 text-[14px] font-light tracking-tight text-fg/75">You do not currently have a valid ticket.</p>
              </div>
            ) : (
              valid.map((t) => <TicketCard key={t.id} ticket={t} valid onOpen={() => setOpen(t)} />)
            )}
          </div>

          <h2 className="px-[15px] pt-5 pb-1.75 text-[13.5px] font-light tracking-tight">Travelcards on your SwissPass</h2>
          <div className="space-y-[8.5px]">
            {cards.map((c) => (
              <button key={c} onClick={() => setCard(c)} className="flex h-[45px] w-full items-center rounded-[19px] bg-surface pr-5 pl-[15.5px] text-left transition-colors hover:bg-[#2b2b2b] light:hover:bg-[#f5f5f5]">
                <span className="flex-1 text-[15.5px] font-light tracking-tight">{c}</span>
                <ChevronRight className="size-4.25" strokeWidth={1.5} />
              </button>
            ))}
          </div>
          <div className="h-[calc(109px+var(--home-inset))]" />
          </div>
        </Overlap>
      ) : (
        <div className={cn("px-[8.5px]", DESK_COL)}>
          <h2 className="px-[15px] pt-[28.5px] pb-3 text-[13.5px] font-light tracking-tight">Expired tickets</h2>
          <div className="space-y-[8.5px]">
            {expired.length === 0 && <p className="px-[15px] text-[14.5px] font-light text-muted">No expired tickets.</p>}
            {expired.map((t) => (
              <TicketCard key={t.id} ticket={t} onOpen={() => setOpen(t)} />
            ))}
          </div>
          <div className="h-[calc(109px+var(--home-inset))]" />
        </div>
      )}

      {open && <TicketSheet ticket={open} valid={new Date(open.validTo).getTime() >= now} onClose={() => setOpen(null)} />}
      {zoom && (
        <Sheet title="SwissPass" onClose={() => setZoom(false)}>
          <FakeQr seed={USER.email} className="mx-auto aspect-square w-[78%] rounded-md" />
          <p className="mt-3 text-center text-[16px] font-bold">
            {USER.firstName} {USER.lastName}
          </p>
          <p className="text-center text-[13px] font-light text-muted">Show this code during ticket inspection. Demo code — not scannable.</p>
        </Sheet>
      )}
      {card && (
        <Sheet title={card} onClose={() => setCard(null)}>
          <p className="px-1 text-[14.5px] leading-snug font-light text-fg/85">{TRAVELCARDS[card]?.text ?? "Unlimited travel in 2nd class on the lines and in the zones this travelcard covers. Change your travelcards in Profile → Travelcards."}</p>
          <Card className="mt-4 space-y-2 p-4">
            <InfoLine label="Holder" value={`${USER.firstName} ${USER.lastName}`} />
            <InfoLine label="Validity" value={TRAVELCARDS[card]?.validity ?? "–"} />
            <InfoLine label="Class" value="2nd class" />
            <InfoLine label="Status" value={<span className="text-ok">Valid</span>} />
          </Card>
          <div className="mt-4">
            <OutlineButton onClick={() => toast("Demo: travelcards are renewed in your SwissPass account.")}>Renew or change travelcard</OutlineButton>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function TicketSheet({ ticket, valid, onClose }: { ticket: Ticket; valid: boolean; onClose: () => void }) {
  const router = useRouter();
  const route = [ticket.from, ticket.to].filter(Boolean).join(" → ");
  const period = `${formatDate(new Date(ticket.validFrom))}, ${formatTime(ticket.validFrom)} – ${formatDate(new Date(ticket.validTo))}, ${formatTime(ticket.validTo)}`;
  return (
    <Sheet title={ticket.product} onClose={onClose} full={valid}>
      {valid ? (
        <>
          <FakeQr seed={ticket.id} className="mx-auto aspect-square w-[72%] rounded-md" />
          <p className="mt-2 text-center text-[12px] font-light text-muted">Demo code — not a valid ticket.</p>
        </>
      ) : (
        <p className="flex items-center gap-2 px-1 text-[14.5px] font-light text-fg/80">
          <QrOffIcon className="size-5 shrink-0" strokeWidth={1.1} /> This ticket has expired.
        </p>
      )}
      <Card className="mt-4 space-y-2 p-4">
        <InfoLine label="Traveller" value={`${USER.firstName} ${USER.lastName}, ${USER.birthDate}`} />
        <InfoLine label={ticket.to ? "Route" : "Valid for"} value={route} />
        <InfoLine label={ticket.to ? "Via" : "Details"} value={ticket.via} />
        <InfoLine label="Class" value={ticket.travelClass === 1 ? "1st class" : "2nd class"} />
        <InfoLine label="Validity" value={period} />
        <InfoLine label="Price" value={`CHF ${ticket.price.toFixed(2)}`} />
        <InfoLine label="Ticket ID" value={ticket.id} />
      </Card>
      <div className="mt-4 space-y-2.5">
        {ticket.to && (
          <PrimaryButton
            onClick={() =>
              router.push(
                journeyHref("/connections", { from: ticket.from, fromName: ticket.from, to: ticket.to, toName: ticket.to, ...zurichDateTime(), isArrivalTime: false, transportations: [] }),
              )
            }
          >
            {valid ? "Show connections" : "Buy again"}
          </PrimaryButton>
        )}
        {valid && (
          <OutlineButton
            onClick={() => {
              actions.removeTicket(ticket.id);
              onClose();
              toast(`Refund of CHF ${ticket.price.toFixed(2)} requested (demo). The ticket was cancelled.`);
            }}
          >
            Refund ticket
          </OutlineButton>
        )}
      </div>
    </Sheet>
  );
}

/** Decorative dot field for the SwissPass banner (abstract, original). */
function DotField({ className }: { className?: string }) {
  const dots: { x: number; y: number }[] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 15; col++) {
      // Rough blob: keep dots inside a lumpy ellipse.
      const dx = (col - 7.5) / 7.5;
      const dy = (row - 4) / 4.4;
      const lump = 0.12 * Math.sin(col * 1.7) + 0.1 * Math.cos(row * 2.3 + col);
      if (dx * dx + dy * dy < 0.82 + lump) dots.push({ x: col * 8 + 4 + (row % 2) * 4, y: row * 8 + 4 });
    }
  }
  return (
    <svg viewBox="0 0 124 72" className={className} fill="currentColor" aria-hidden>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={0.9} />
      ))}
    </svg>
  );
}

function TicketCard({ ticket, valid, onOpen }: { ticket: Ticket; valid?: boolean; onOpen: () => void }) {
  const from = new Date(ticket.validFrom);
  const to = new Date(ticket.validTo);
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3.5 rounded-[19px] bg-surface pt-[11.5px] pb-[11px] pr-4 pl-[15.5px] text-left transition-colors hover:bg-[#2b2b2b] light:hover:bg-[#f5f5f5]">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-[15px] font-light tracking-tight text-fg/70">
          {ticket.product}
          {valid && ` · ${ticket.travelClass === 1 ? "1st" : "2nd"} cl.`}
        </p>
        <p className="text-[16px] leading-[1.5] font-bold">
          {ticket.from}
          {ticket.to && (
            <>
              {" "}
              <LongArrow className="mx-1.25" />
              <br />
              {ticket.to}
            </>
          )}
        </p>
        <p className="text-[11.5px] leading-[17px] font-light tracking-tight text-fg/70">
          {ticket.to && "via "}
          {ticket.via}
        </p>
        <p className="text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">
          {formatDate(from)}, {formatTime(ticket.validFrom)} – {formatDate(to) === formatDate(from) ? "" : `${formatDate(to)}, `}
          {formatTime(ticket.validTo)}
        </p>
      </div>
      {valid ? <FakeQr seed={ticket.id} className="size-13.5 shrink-0 rounded" /> : <QrOffIcon className="size-6 shrink-0" strokeWidth={1.1} />}
    </button>
  );
}
