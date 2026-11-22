"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Pencil, ToggleLeft } from "lucide-react";
import { Card, Checkbox, InfoLine, OutlineButton, Overlap, PillToggle, PrimaryButton, Sheet, cn, toast } from "./ui";
import { Scene } from "./scene";
import { LocationPicker } from "./plan/location-picker";
import { actions, useSetting } from "@/lib/store";
import { DEFAULT_POSITION, fullName } from "@/lib/mock-data";
import { formatDate, formatTime } from "@/lib/format";
import { usePasses } from "@/lib/travelcards";
import { passCovering, uncovered } from "@/lib/passes";
import { nearbyStations } from "@/lib/transport";

/**
 * EasyRide: check in before boarding, check out on arrival, the fare is worked out afterwards.
 * It lives in Plan (Timetable | EasyRide). While a ride runs it is your ticket, so a compact card
 * with the timer and check-out also sits on top of Plan › Timetable and on Tickets.
 */

type Summary = {
  minutes: number;
  charged: number;
  pass: string | null;
  price: number;
  /** Priced with the traveller's Half Fare Travelcard. */
  halfFare: boolean;
  travelClass: 1 | 2;
  from: string;
  to: string;
  start: number;
  end: number;
};
type Spot = { lat: number; lon: number };

/** The browser position (EPFL fallback). */
function locate(): Promise<Spot> {
  return new Promise((resolve) => {
    const fallback = () => resolve(DEFAULT_POSITION);
    if (!("geolocation" in navigator)) return fallback();
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), fallback, { timeout: 3000, maximumAge: 60_000 });
  });
}

/** Nearest stop to a position, for the check-in label. */
const nearestStop = (at: Spot): Promise<string> =>
  nearbyStations(at.lat, at.lon)
    .then((s) => s[0]?.name ?? "Current location")
    .catch(() => "Current location");

const parseSpot = (v: string): Spot | null => {
  const [lat, lon] = v.split(",").map(Number);
  return v && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
};

/** The ride's persisted state (shared by every view through the store) and its actions. */
function useEasyRide() {
  const passes = usePasses();
  const [ready, setReady] = useSetting<boolean>("easyride.ready", false);
  // The running journey is persisted so it survives tab switches and reloads.
  const [checkedInAt, setCheckedInAt] = useSetting<number>("easyride.since", 0);
  const [from, setFrom] = useSetting<string>("easyride.from", "");
  // Where the journey started ("lat,lon"): a zone pass covers it if it also ends inside its zones.
  const [startedAt, setStartedAt] = useSetting<string>("easyride.at", "");
  const [rideClass, setRideClass] = useSetting<number>("easyride.rideClass", 2);
  const [checkingOut, setCheckingOut] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!checkedInAt) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [checkedInAt]);

  const elapsed = checkedInAt && now ? Math.max(0, Math.floor((now - checkedInAt) / 1000)) : 0;
  const h = Math.floor(elapsed / 3600);
  const clock = `${h ? `${h}:` : ""}${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  /** `start`: the stop shown as "From" (the nearest one is looked up if it is not known yet). */
  function checkIn(start = "", travelClass: 1 | 2 = 2) {
    const t = Date.now();
    setNow(t);
    setCheckedInAt(t);
    setFrom(start);
    setStartedAt("");
    setRideClass(travelClass);
    toast("Checked in. Your EasyRide ticket is in Tickets.");
    locate().then((at) => {
      setStartedAt(`${at.lat},${at.lon}`);
      if (!start) nearestStop(at).then(setFrom);
    });
  }

  async function checkOut(): Promise<Summary | null> {
    if (checkingOut || !checkedInAt) return null;
    const end = Date.now();
    setCheckingOut(true);
    const here = await locate();
    const to = await nearestStop(here);
    setCheckingOut(false);
    const minutes = Math.max(1, Math.round((end - checkedInAt) / 60000));
    // Only what no travelcard covers is charged: nothing inside the zones of a zone pass, and with the Night GA only the minutes before 19:00 / after 05:00.
    const { minutes: charged, pass } = uncovered(passes, checkedInAt, end, {
      from: parseSpot(startedAt),
      to: here,
    });
    // MOCK fare: short-distance price plus a little per minute (at half fare), doubled without a Half Fare Travelcard.
    const half = (2.3 + Math.max(0, charged - 10) * 0.22) * (rideClass === 1 ? 1.75 : 1);
    const price = charged ? Math.ceil((passes.halfFare ? half : half * 2) * 5) / 5 : 0;
    const travelClass: 1 | 2 = rideClass === 1 ? 1 : 2;
    const summary = {
      minutes,
      charged,
      pass,
      price,
      halfFare: passes.halfFare,
      travelClass,
      from: from || "Current location",
      to,
      start: checkedInAt,
      end,
    };
    setCheckedInAt(0);
    if (charged)
      actions.addTicket({
        id: `er-${end}`,
        product: "EasyRide",
        from: from || "EasyRide journey",
        to: to === "Current location" ? "" : to,
        via: `${charged} min, best price calculated automatically`,
        validFrom: new Date(checkedInAt).toISOString(),
        validTo: new Date(end).toISOString(),
        price,
        travelClass,
      });
    return summary;
  }

  return {
    ready,
    activate: () => setReady(true),
    checkedInAt,
    from,
    clock,
    checkingOut,
    checkIn,
    checkOut,
  };
}

/** True while a travelcard valid right now leaves nothing for EasyRide to charge (its name), re-checked every 30 s. */
function useFreeRide(): string | null {
  const passes = usePasses();
  const [free, setFree] = useState<string | null>(null);
  useEffect(() => {
    const check = () => setFree(passCovering(passes, Date.now(), Date.now()));
    const first = setTimeout(check, 0);
    const id = setInterval(check, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [passes]);
  return free;
}

/**
 * Plan › EasyRide, laid out like the native app: who travels (and with which reduction) on top,
 * the illustration in the middle, and at the bottom where you start, the class and a slider:
 * swipe the red "Start" knob right to check in, the "Stop" knob left to check out. While a ride
 * runs the illustration changes to the moving view from the train and the travel time counts up.
 */
export function EasyRideView() {
  const ride = useEasyRide();
  const free = useFreeRide();
  const passes = usePasses();
  const [travelClass, setTravelClass] = useSetting<string>("easyride.class", "2");
  const [payment] = useSetting<string>("payment", "twint");
  const [setup, setSetup] = useState(false);
  const [picking, setPicking] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  // Where the next ride starts: the nearest stop, unless another one was picked.
  const [nearest, setNearest] = useState("");
  const [picked, setPicked] = useState("");
  const noCheckIn = ride.ready && !ride.checkedInAt && !!free;
  const riding = !!ride.checkedInAt;
  const start = picked || nearest;

  useEffect(() => {
    if (riding) return;
    let live = true;
    locate().then(nearestStop).then((name) => live && setNearest(name));
    return () => {
      live = false;
    };
  }, [riding]);

  const reduction = passes.ga ? `${passes.ga} Travelcard` : passes.halfFare ? "Half Fare Travelcard (1/2)" : "No reduction";

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Who travels: the ride is priced with their travelcards. */}
      <Overlap className="lg:mx-auto lg:w-full lg:max-w-[520px]">
        <Card className="flex items-center gap-3 py-3 pr-3 pl-4 shadow-xl shadow-black/40 light:shadow-black/15">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15.5px] leading-snug font-bold">{fullName}</p>
            <p className="truncate text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">{reduction}</p>
          </div>
          <Link
            href="/profile"
            aria-label="Edit travelcards"
            className="flex size-[36px] shrink-0 items-center justify-center rounded-full border border-fg/50 transition-colors hover:bg-fg/10"
          >
            <Pencil className="size-4" strokeWidth={1.25} />
          </Link>
        </Card>
      </Overlap>

      {/* The illustration fills what is left between the two cards (on desktop, the whole pane behind them); it moves once you are checked in. */}
      <div className="relative -mt-12 min-h-[220px] flex-1 overflow-hidden lg:absolute lg:inset-0 lg:mt-0 lg:min-h-0">
        <Scene variant={riding ? "commute" : "station"} />
      </div>

      {/* Start (from, class) or the running ride (travel time), and the slider: a sheet on the tab bar, as in the app. */}
      <div className="relative z-30 -mt-5 lg:mx-auto lg:mt-auto lg:mb-10 lg:w-[520px]">
        <Card className="rounded-b-none px-3 pt-3.5 pb-[calc(var(--home-inset)+72px)] shadow-[0_-6px_20px_rgba(0,0,0,0.25)] lg:rounded-b-[19px] lg:pb-3">
          {riding ? (
            <div className="px-1.5 pt-0.5 pb-3">
              <p className="text-[15.5px] leading-snug font-bold tabular-nums">Travel time {ride.clock}</p>
              <p className="truncate text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">
                {travelClass === "1" ? "1st class" : "2nd class"}
                {ride.from ? ` · since ${ride.from}` : ""}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1.5 pb-2.5">
                <p className="min-w-0 flex-1 truncate text-[15px] tracking-tight">
                  <span className="font-light">From: </span>
                  <b className="font-bold">{start || "Finding nearest stop…"}</b>
                </p>
                <button onClick={() => setPicking(true)} className="h-[28px] shrink-0 rounded-full border border-fg/50 px-3 text-[13.5px] font-light transition-colors hover:bg-fg/10">
                  Change
                </button>
              </div>
              <div className="mb-3 flex">
                <PillToggle
                  value={travelClass}
                  onChange={setTravelClass}
                  options={[
                    { value: "2", label: "2nd class" },
                    { value: "1", label: "1st class" },
                  ]}
                />
              </div>
              {noCheckIn && <p className="mb-2.5 px-1.5 text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">Your {free} is valid right now, so there is nothing for EasyRide to charge.</p>}
            </>
          )}
          <div className="flex items-center gap-2.5">
            <PaymentBadge kind={payment} />
            <SwipeSlider
              key={riding ? "stop" : "start"}
              on={riding}
              disabled={noCheckIn}
              busy={ride.checkingOut}
              onCommit={async () => {
                if (riding) setSummary(await ride.checkOut());
                else if (!ride.ready) setSetup(true);
                else ride.checkIn(start, travelClass === "1" ? 1 : 2);
              }}
            />
          </div>
        </Card>
      </div>

      {picking && (
        <LocationPicker
          title="From"
          allowCurrent={false}
          onClose={() => setPicking(false)}
          onPick={(e) => {
            setPicking(false);
            setPicked(e.name);
          }}
        />
      )}
      {setup && (
        <SetupSheet
          onClose={() => setSetup(false)}
          onDone={() => {
            ride.activate();
            setSetup(false);
            ride.checkIn(start, travelClass === "1" ? 1 : 2);
          }}
        />
      )}
      {summary && <SummarySheet summary={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}

/** The default means of payment as a small card-like badge left of the slider (as in the app). */
function PaymentBadge({ kind }: { kind: string }) {
  const label = { twint: "TWINT", card: "Card", applepay: "Pay", invoice: "Invoice", reka: "Reka" }[kind] ?? "Pay";
  return (
    <span
      title="Default means of payment (Profile › Wallet)"
      className="flex h-[30px] w-[44px] shrink-0 items-center justify-center rounded-[6px] border border-fg/25 bg-surface-2 text-[9.5px] font-bold tracking-tight text-fg/80"
    >
      {kind === "card" ? (
        <span aria-label="Card" className="flex">
          <span className="size-[15px] rounded-full bg-[#eb001b]" />
          <span className="-ml-[6px] size-[15px] rounded-full bg-[#f79e1b]/90" />
        </span>
      ) : (
        label
      )}
    </span>
  );
}

const KNOB = 60;
const PAD = 3;

/**
 * The EasyRide slider: a red knob ("Start" on the left, "Stop" on the right) dragged across a
 * pill track; the hint sits on the other side and fades as you drag. Let go past 70 % and it
 * commits, otherwise it springs back. A tap only nudges it; Enter / Space commit (keyboard).
 */
function SwipeSlider({ on, onCommit, disabled, busy }: { on: boolean; onCommit: () => void; disabled?: boolean; busy?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; travel: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState(false);
  // The knob's run, measured when a drag starts (state, not the ref: the hint fades with it).
  const [travel, setTravel] = useState(200);
  const dir = on ? -1 : 1;
  const travelNow = () => (track.current ? track.current.clientWidth - KNOB - 2 * PAD : 200);

  function commit() {
    if (committed || disabled) return;
    setCommitted(true);
    setDx(dir * travelNow());
    onCommit();
  }

  const progress = Math.min(1, Math.abs(dx) / travel);
  const hint = disabled ? "No ticket needed" : on ? "Swipe left to stop" : "Swipe right to start";

  return (
    <div
      ref={track}
      className={cn(
        "relative h-[66px] min-w-0 flex-1 rounded-full bg-surface-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-fg)_14%,transparent)] select-none",
        disabled && "opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 flex items-center text-[13px] leading-tight font-light tracking-tight text-fg/60", on ? "left-5 text-left" : "right-5 text-right")}
        style={{ opacity: committed ? 0 : 1 - progress }}
      >
        {hint}
      </span>
      <button
        type="button"
        aria-label={on ? "Check out: swipe left to stop" : "Check in: swipe right to start"}
        disabled={disabled}
        onPointerDown={(e) => {
          if (committed || disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, travel: travelNow(), moved: false };
          setTravel(drag.current.travel);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const raw = e.clientX - d.x;
          if (Math.abs(raw) > 4) d.moved = true;
          setDx(dir > 0 ? Math.max(0, Math.min(d.travel, raw)) : Math.min(0, Math.max(-d.travel, raw)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d) return;
          if (Math.abs(dx) > d.travel * 0.7) return commit();
          setDx(0);
          // A tap: show which way to swipe.
          if (!d.moved) {
            setDx(dir * 22);
            setTimeout(() => setDx(0), 180);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setDx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            commit();
          }
        }}
        className={cn(
          "absolute top-[3px] flex touch-none items-center justify-center rounded-full bg-sbb-red text-[15.5px] text-white shadow-lg shadow-black/30 outline-offset-2 disabled:cursor-not-allowed",
          !dragging && "transition-transform duration-200 ease-out",
        )}
        style={{
          width: KNOB,
          height: KNOB,
          [on ? "right" : "left"]: PAD,
          transform: `translateX(${dx}px)`,
        }}
      >
        {committed || busy ? <span className="size-[30px] animate-spin rounded-full border-2 border-white border-t-transparent" /> : on ? "Stop" : "Start"}
      </button>
    </div>
  );
}

/** A running ride as a compact card (Plan › Timetable and Tickets): timer and check-out. Nothing while not checked in, except the summary sheet after a check-out. */
export function EasyRideCard() {
  const ride = useEasyRide();
  const [summary, setSummary] = useState<Summary | null>(null);
  return (
    <>
      {!!ride.checkedInAt && (
        <Card className="flex items-center gap-3 py-3 pr-3 pl-[15px]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sbb-red text-white">
            <ToggleLeft className="size-5 rotate-180" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15.5px] leading-snug font-bold">EasyRide ticket</p>
            <p className="truncate text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70 tabular-nums">
              Check-in {formatTime(new Date(ride.checkedInAt).toISOString())} · {ride.clock}
            </p>
          </div>
          <button
            onClick={async () => setSummary(await ride.checkOut())}
            className="h-9 shrink-0 rounded-full border border-fg/50 px-4 text-[14px] font-light whitespace-nowrap transition-colors hover:bg-fg/10"
          >
            {ride.checkingOut ? "…" : "Check out"}
          </button>
        </Card>
      )}
      {summary && <SummarySheet summary={summary} onClose={() => setSummary(null)} />}
    </>
  );
}

/** Whether a ride is running (Plan shows it on top while it is). */
export function useRiding(): boolean {
  return useSetting<number>("easyride.since", 0)[0] > 0;
}

function SetupSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [accepted, setAccepted] = useState(false);
  const passes = usePasses();
  return (
    <Sheet title="Set up EasyRide" onClose={onClose}>
      <ol className="space-y-2 px-1 text-[14.5px] leading-snug font-light text-fg/85">
        <li>1. Before you board, swipe “Start” to the right to check in.</li>
        <li>2. Travel anywhere in the GA area of validity; your ticket is your phone.</li>
        <li>3. When you get off, swipe “Stop” to the left to check out. You are charged the best available price for the day.</li>
      </ol>
      <Card className="mt-4 space-y-2 p-4">
        <InfoLine label="Class" value="2nd class" />
        <InfoLine label="Reduction" value={passes.halfFare ? "Half Fare Travelcard" : "None"} />
        <InfoLine label="Payment" value="Default means of payment (Wallet)" />
        <InfoLine label="Location" value="Used while checked in" />
      </Card>
      <button onClick={() => setAccepted((a) => !a)} role="checkbox" aria-checked={accepted} className="mt-4 flex w-full items-center gap-3 px-1 text-left text-[14.5px] font-light">
        <Checkbox checked={accepted} /> I accept the EasyRide terms of use (demo).
      </button>
      <div className="mt-4">
        <PrimaryButton onClick={() => (accepted ? onDone() : toast("Please accept the terms of use first."))}>Activate EasyRide</PrimaryButton>
      </div>
      <p className="mt-3 px-1 text-[11px] text-muted">Prototype only — no location tracking and no payment.</p>
    </Sheet>
  );
}

function SummarySheet({ summary, onClose }: { summary: Summary; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const passes = usePasses();
  const at = (t: number) => formatTime(new Date(t).toISOString());
  return (
    <Sheet title="Your journey has ended" onClose={onClose}>
      <Card className="p-4">
        {/* From → to, like the native app's journey summary. */}
        <div className="relative space-y-3 pl-5">
          <span aria-hidden className="absolute top-[7px] bottom-[27px] left-[4.5px] w-[2px] bg-fg" />
          <div>
            <span aria-hidden className="absolute left-0 mt-[5px] size-[11px] rounded-full bg-fg" />
            <p className="text-[15px] font-bold tracking-tight">{summary.from}</p>
            <p className="text-[12.5px] font-light text-fg/70 tabular-nums">{at(summary.start)}</p>
          </div>
          <div>
            <span aria-hidden className="absolute left-0 mt-[5px] size-[11px] rounded-full bg-fg" />
            <p className="text-[15px] font-bold tracking-tight">{summary.to}</p>
            <p className="text-[12.5px] font-light text-fg/70 tabular-nums">{at(summary.end)}</p>
          </div>
        </div>
      </Card>
      <Card className="mt-2.5 space-y-2 p-4">
        <InfoLine label="Date" value={formatDate(new Date(summary.start))} />
        <InfoLine label="Class" value={summary.travelClass === 1 ? "1st class" : "2nd class"} />
        <InfoLine label={fullName} value={passes.ga ? `${passes.ga} Travelcard` : summary.halfFare ? "Half Fare (1/2)" : "No reduction"} />
        <InfoLine label="Travel time" value={`${summary.minutes} min`} />
        {summary.pass && <InfoLine label={`Covered by ${summary.pass}`} value={summary.charged ? `${summary.minutes - summary.charged} of ${summary.minutes} min` : "Whole journey"} />}
        <div className="space-y-1 border-t border-line pt-2">
          <InfoLine label="Calculated price" value={`CHF ${summary.price.toFixed(2)}`} />
          <InfoLine label={<b className="font-bold text-fg">Invoiced price</b>} value={<b className="font-bold">CHF {summary.price.toFixed(2)}</b>} />
        </div>
      </Card>
      <p className="my-3 px-1 text-[11px] text-muted">Prototype only — the price is a mock estimate and nothing was charged.</p>
      <div className="space-y-2.5">
        <PrimaryButton onClick={onClose}>Done</PrimaryButton>
        {summary.price > 0 && !pathname.startsWith("/tickets") && (
          <OutlineButton
            onClick={() => {
              onClose();
              router.push("/tickets");
            }}
          >
            Show in Tickets
          </OutlineButton>
        )}
        <OutlineButton onClick={() => toast("Demo: reporting a problem is not available in the prototype.")}>Report a problem</OutlineButton>
      </div>
    </Sheet>
  );
}
