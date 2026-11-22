"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, History, Smartphone } from "lucide-react";
import { Card, Header, InfoLine, ListRow, OutlineButton, Overlap, PrimaryButton, Sheet, cn, toast } from "@/components/ui";
import { LongArrow, PhoneTicketIcon, QrOffIcon } from "@/components/icons";
import { FakeQr, TicketSheet } from "@/components/ticket";
import { EasyRideCard, useRiding } from "@/components/easyride";
import { ServiceSheet, TICKET_SERVICES } from "@/components/shop";
import { USER } from "@/lib/mock-data";
import { travelcardNames, useCatalog, useTravelcards } from "@/lib/travelcards";
import { useAppState, type Ticket } from "@/lib/store";
import { formatDate, formatTime } from "@/lib/format";

/** MOCK travelcard details (dates are fictitious). */
const TRAVELCARDS: Record<string, { validity: string; text: string }> = {
  "Half Fare Travelcard": { validity: "01.01.2026 – 31.12.2026", text: "Travel at half price on trains, buses, boats and most mountain railways throughout Switzerland. Renews automatically." },
  "Night GA Travelcard": { validity: "01.01.2026 – 31.12.2026", text: "Unlimited travel in 2nd class from 7 pm until the end of service (5 am, or 7 am on Saturdays and Sundays). For young people under 25." },
  "Mobilis travelcard, zones 11 + 12": { validity: "01.01.2026 – 31.12.2026", text: "Unlimited travel in 2nd class on trains, metros and buses within Mobilis zones 11 and 12 (Grand Lausanne: Lausanne, Renens, Ecublens, Prilly, Pully, Epalinges, Lutry and neighbouring municipalities)." },
};

const subscribeNoop = () => () => {};

export default function TicketsPage() {
  const [showExpired, setShowExpired] = useState(false);
  const [service, setService] = useState<string | null>(null);
  const { tickets } = useAppState();
  const [page, setPage] = useState(0);
  const pagerRef = useRef<HTMLDivElement>(null);
  const onPagerScroll = () => {
    const el = pagerRef.current;
    if (el) setPage(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goToPage = (i: number) => {
    const el = pagerRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const [open, setOpen] = useState<Ticket | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [selection] = useTravelcards();
  const cards = travelcardNames(selection, useCatalog());
  const [zoom, setZoom] = useState(false);
  const riding = useRiding();
  // Phone: the SwissPass collapses to its red strip on scroll. The strip is sticky and the code
  // part scrolls up under it (no layout change, so no scroll jumps). As the code part's rounded
  // bottom passes under the strip, the strip's bottom corners follow that same arc (so the card keeps
  // one outline), and its shadow and the blur below fade in. Set per frame on the DOM, not in state.
  const passBar = useRef<HTMLDivElement>(null);
  const passStrip = useRef<HTMLDivElement>(null);
  const passShadow = useRef<HTMLDivElement>(null);
  const passBlur = useRef<HTMLDivElement>(null);
  const passBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const R = 19; // the card's corner radius
    const check = () => {
      frame = 0;
      const [bar, strip, shadow, blur, body] = [passBar.current, passStrip.current, passShadow.current, passBlur.current, passBody.current];
      if (!bar || !strip || !shadow || !blur || !body) return;
      const sticky = getComputedStyle(bar).position === "sticky";
      // How much of the code part still shows below the strip (0…R: its bottom arc is passing under).
      const r = sticky ? Math.min(R, Math.max(0, body.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom)) : R;
      const p = 1 - r / R;
      if (r >= R) strip.style.clipPath = "";
      else {
        const W = strip.offsetWidth;
        const H = strip.offsetHeight;
        // The arc's centre, from the strip's top; it meets the strip's bottom edge x0 in from each side.
        const cy = H + r - R;
        const x0 = R - Math.sqrt(R * R - (R - r) ** 2);
        strip.style.clipPath = `path("M0 ${R}A${R} ${R} 0 0 1 ${R} 0H${W - R}A${R} ${R} 0 0 1 ${W} ${R}V${cy}A${R} ${R} 0 0 1 ${W - x0} ${H}H${x0}A${R} ${R} 0 0 1 0 ${cy}Z")`;
      }
      // Light mode only (class on the wrapper): on the dark page a black shadow just smudges the card scrolling under.
      shadow.style.setProperty("--pass-shadow", (0.3 * p).toFixed(3));
      blur.style.opacity = String(p);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    // Phone: the app scrolls in #app-scroll (layout.tsx), not the window.
    const scroller = document.getElementById("app-scroll") ?? window;
    check();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  // Read the clock only on the client to keep render pure and hydration-safe.
  const now = useSyncExternalStore(subscribeNoop, () => Math.floor(Date.now() / 60000) * 60000, () => 0);
  const valid = tickets.filter((t) => new Date(t.validTo).getTime() >= now);
  const expired = tickets.filter((t) => new Date(t.validTo).getTime() < now);

  return (
    <div>
      {/* What you show: SwissPass, valid tickets, a running EasyRide ride. Buying starts on Plan. */}
      <Header title="Tickets" extend />

        {/* Phone: tall enough to scroll the SwissPass code (≈48 % of the width + padding) fully under its strip, even with few tickets. */}
        <Overlap className="min-h-[calc(var(--app-h)+min(48vw,207px)+40px)] lg:min-h-0 lg:mx-auto lg:grid lg:max-w-[1040px] lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:px-8">
          {/* SwissPass card (desktop: stays in view on the left, tickets on the right) */}
          {/* Phone: `contents`, so the strip can stick inside the whole page column. */}
          <div className="contents lg:sticky lg:top-[88px] lg:block lg:overflow-hidden lg:rounded-[19px]">
            <div
              ref={passBar}
              // Sticks exactly where it rests (header + 3.5px: the card overlaps the 27.5px skirt by 24px), so it never shifts.
              className="sticky top-[calc(max(calc(var(--safe-top)+var(--top-gap)),6px)+46.5px)] z-20 lg:static"
            >
              {/* A copy of the header's red skirt pinned to the strip: at rest it lies exactly on the real one, then it stays. */}
              <div aria-hidden className="absolute -inset-x-[8.5px] -top-[5.5px] h-[29.5px] bg-gradient-to-b from-sbb-red to-[#db0000] lg:hidden" />
              {/* Page colour behind the rest of the strip, so what scrolls under it never shows around its rounded corners. */}
              <div aria-hidden className="absolute -inset-x-[8.5px] top-6 bottom-0 bg-page lg:hidden" />
              {/* Collapsed, the tickets fade out under the strip through a soft blur (as in the native app), not a hard edge. */}
              <div
                ref={passBlur}
                aria-hidden
                style={{ opacity: 0 }}
                className="pointer-events-none absolute -inset-x-[8.5px] top-full h-7 bg-page/40 backdrop-blur-[6px] [mask-image:linear-gradient(to_bottom,black,transparent)] lg:hidden"
              />
            {/* The shadow is a filter on a wrapper: the strip's clip-path would cut off a box-shadow. */}
            <div ref={passShadow} className="relative light:[filter:drop-shadow(0_4px_7px_rgb(0_0_0/var(--pass-shadow,0)))]">
            <div
              ref={passStrip}
              className="relative flex justify-between overflow-hidden rounded-t-[19px] bg-[#b8242a] px-[15.5px] text-white pt-2 pb-[6.5px] lg:rounded-none"
            >
              <DotField className="absolute top-[13px] right-[14px] h-[58px] w-[97px] text-white/85" />
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
              {/* Ends just inside the map's top-left, as on the card. */}
              <p className="relative mr-[80px] text-[13.5px] font-light">
                Swiss<b className="font-bold">Pass</b>
              </p>
            </div>
            </div>
            </div>
            <div ref={passBody} className="rounded-b-[19px] bg-[#2a2a2a] light:bg-white pt-[16.5px] pb-[9px] lg:rounded-none">
              {/* Swipe between the code and the card details (native scroll-snap). */}
              <div
                ref={pagerRef}
                onScroll={onPagerScroll}
                className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
              >
                <div className="flex w-full shrink-0 snap-center snap-always items-stretch justify-between px-[15.5px]">
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
                <div className="flex w-full shrink-0 snap-center snap-always flex-col justify-center space-y-2 px-[19.5px]">
                  <InfoLine label="SwissPass no." value="DEMO-000-000-0" />
                  <InfoLine label="Card holder" value={`${USER.firstName} ${USER.lastName}`} />
                  <InfoLine label="Date of birth" value={USER.birthDate} />
                  <InfoLine label="Card valid until" value="31.12.2030" />
                  <InfoLine label="Travelcards" value={String(cards.length)} />
                </div>
              </div>
              <div className="mt-[9.5px] flex justify-center" role="tablist" aria-label="SwissPass pages">
                {[0, 1].map((i) => (
                  <button key={i} role="tab" aria-selected={page === i} aria-label={i === 0 ? "Code" : "Card details"} onClick={() => goToPage(i)} className="-my-2 px-[5px] py-2">
                    <span className={cn("block size-1.75 rounded-full", page === i ? "bg-fg" : "bg-fg/40")} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:min-w-0">
          <div className="mt-[38.5px] space-y-[8.5px] lg:mt-0">
            <EasyRideCard />
            {valid.length === 0 ? (
              // A running EasyRide ride is a valid ticket (its card is just above).
              riding ? null : (
              <div className="rounded-[19px] border border-fg/35 bg-gradient-to-b from-[#1a1a1a] to-[#0c0c0c] light:from-white light:to-[#f6f6f6] px-5 pt-4.25 pb-3 text-center">
                <PhoneTicketIcon className="mx-auto h-[78px] w-[62px]" />
                <p className="mt-1.5 text-[14px] font-light tracking-tight text-fg/75">You do not currently have a valid ticket.</p>
                <div className="mx-auto mt-3 mb-1 max-w-[240px]">
                  <PrimaryButton href="/plan">Find a ticket</PrimaryButton>
                </div>
              </div>
              )
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
          <h2 className="px-[15px] pt-5 pb-1.75 text-[13.5px] font-light tracking-tight">Past</h2>
          <Card className="overflow-hidden">
            <ListRow icon={History} label="Expired tickets" chevron trailing={<span className="text-[13.5px] font-light text-fg/70">{expired.length}</span>} onClick={() => setShowExpired(true)} />
            {TICKET_SERVICES.map((s) => (
              <ListRow key={s.label} icon={s.icon} label={s.label} chevron onClick={() => setService(s.label)} />
            ))}
          </Card>
          <div className="h-[calc(112px+var(--home-inset))]" />
          </div>
        </Overlap>

      {service && <ServiceSheet service={service} onClose={() => setService(null)} />}
      {showExpired && (
        <Sheet title="Expired tickets" onClose={() => setShowExpired(false)} full>
          <div className="space-y-[8.5px]">
            {expired.map((t) => (
              <TicketCard key={t.id} ticket={t} onOpen={() => setOpen(t)} />
            ))}
          </div>
        </Sheet>
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

/** Decorative dot field for the SwissPass banner (abstract, original). */
/**
 * The SwissPass map: Switzerland as a square grid of dots (from a simplified border, 20 columns),
 * with a larger cross on a few cities, like the card in the native app.
 */
const SWISS_DOTS = [
  "...........#........",
  ".......########.....",
  ".....###########....",
  "....############....",
  "....############....",
  "...################.",
  "..#################.",
  ".##################.",
  ".#############.####.",
  ".#..#####...##...#..",
  "....#####...##......",
  ".....####....#......",
];
/** Basel, Zürich, Bern, Lausanne, Geneva, Lugano: [column, row]. */
const SWISS_CITIES = [
  [7, 1],
  [11, 2],
  [6, 5],
  [3, 7],
  [1, 9],
  [13, 11],
];
const isCity = (c: number, r: number) => SWISS_CITIES.some(([x, y]) => x === c && y === r);

function DotField({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 72" className={className} fill="currentColor" stroke="currentColor" aria-hidden>
      {SWISS_DOTS.flatMap((line, r) =>
        [...line].map((ch, c) => {
          if (ch !== "#") return null;
          const x = c * 6 + 3;
          const y = r * 6 + 3;
          return isCity(c, r) ? (
            <path key={`${c}-${r}`} d={`M${x - 2.6} ${y}h5.2M${x} ${y - 2.6}v5.2`} strokeWidth={1.3} />
          ) : (
            <circle key={`${c}-${r}`} cx={x} cy={y} r={1.05} stroke="none" />
          );
        }),
      )}
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
          {valid && !ticket.classless && ` · ${ticket.travelClass === 1 ? "1st" : "2nd"} cl.`}
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
      {valid && ticket.source === "sbb-app" ? (
        <span className="flex shrink-0 flex-col items-center gap-0.5 text-[10.5px] font-light text-fg/70">
          <Smartphone className="size-6" strokeWidth={1.1} />
          SBB app
        </span>
      ) : valid ? (
        <FakeQr seed={ticket.id} className="size-13.5 shrink-0 rounded" />
      ) : (
        <QrOffIcon className="size-6 shrink-0" strokeWidth={1.1} />
      )}
    </button>
  );
}
