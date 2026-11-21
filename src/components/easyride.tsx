"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ToggleLeft } from "lucide-react";
import { Card, Checkbox, InfoLine, OutlineButton, PrimaryButton, Sheet, toast } from "./ui";
import { EmptyState } from "./scene";
import { actions, useSetting } from "@/lib/store";
import { DEFAULT_POSITION } from "@/lib/mock-data";
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
  from: string;
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

  function checkIn() {
    const t = Date.now();
    setNow(t);
    setCheckedInAt(t);
    setFrom("");
    setStartedAt("");
    toast("Checked in. Have a good journey!");
    locate().then((at) => {
      setStartedAt(`${at.lat},${at.lon}`);
      nearestStop(at).then(setFrom);
    });
  }

  async function checkOut(): Promise<Summary | null> {
    if (checkingOut || !checkedInAt) return null;
    const end = Date.now();
    setCheckingOut(true);
    const here = await locate();
    setCheckingOut(false);
    const minutes = Math.max(1, Math.round((end - checkedInAt) / 60000));
    // Only what no travelcard covers is charged: nothing inside the zones of a zone pass, and with the Night GA only the minutes before 19:00 / after 05:00.
    const { minutes: charged, pass } = uncovered(passes, checkedInAt, end, {
      from: parseSpot(startedAt),
      to: here,
    });
    // MOCK fare: short-distance price plus a little per minute, half fare.
    const price = charged ? Math.ceil((2.3 + Math.max(0, charged - 10) * 0.22) * 5) / 5 : 0;
    const summary = {
      minutes,
      charged,
      pass,
      price,
      from: from || "Current location",
      start: checkedInAt,
      end,
    };
    setCheckedInAt(0);
    if (charged)
      actions.addTicket({
        id: `er-${end}`,
        product: "EasyRide",
        from: from || "EasyRide journey",
        to: "",
        via: `${charged} min, best price calculated automatically`,
        validFrom: new Date(checkedInAt).toISOString(),
        validTo: new Date(end).toISOString(),
        price,
        travelClass: 2,
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
 * Plan › EasyRide: set up, check in, and while a ride runs its timer and the check-out, over a
 * station scene.
 */
export function EasyRideView() {
  const ride = useEasyRide();
  const free = useFreeRide();
  const [setup, setSetup] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const noCheckIn = ride.ready && !ride.checkedInAt && !!free;

  return (
    <>
      <EmptyState
        variant="station"
        top={37.5}
        title={ride.checkedInAt ? `Checked in · ${ride.clock}` : noCheckIn ? "No check-in needed." : ride.ready ? "Ready to go." : "Travel without choosing a ticket."}
        text={
          ride.checkedInAt
            ? `${ride.from ? `Checked in at ${ride.from}. ` : ""}Have a good journey. Check out when you reach your destination; the best fare is calculated automatically.`
            : noCheckIn
              ? `Your ${free} is valid right now, so 2nd class travel is free. There is nothing for EasyRide to charge.`
              : ride.ready
                ? "Check in before you board and check out when you arrive. The price of your journey is calculated automatically afterwards."
                : "With EasyRide you don’t search for the right ticket: check in when you board, check out when you arrive, and you pay the best price for what you rode. Hop on and off wherever and whenever you like."
        }
        action={
          <PrimaryButton disabled={noCheckIn} onClick={async () => (ride.checkedInAt ? setSummary(await ride.checkOut()) : ride.ready ? ride.checkIn() : setSetup(true))}>
            {ride.checkingOut ? "Checking out…" : ride.checkedInAt ? "Check out" : noCheckIn ? "No ticket needed" : ride.ready ? "Check in" : "Set up EasyRide"}
          </PrimaryButton>
        }
      />
      {setup && (
        <SetupSheet
          onClose={() => setSetup(false)}
          onDone={() => {
            ride.activate();
            setSetup(false);
            toast("EasyRide is set up. Tap “Check in” to start a journey.");
          }}
        />
      )}
      {summary && <SummarySheet summary={summary} onClose={() => setSummary(null)} />}
    </>
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
            <p className="truncate text-[15.5px] leading-snug font-bold tabular-nums">EasyRide · {ride.clock}</p>
            <p className="truncate text-[12.5px] leading-[17px] font-light tracking-tight text-fg/70">{ride.from ? `Since ${ride.from}. ` : ""}Check out when you arrive.</p>
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
  return (
    <Sheet title="Set up EasyRide" onClose={onClose}>
      <ol className="space-y-2 px-1 text-[14.5px] leading-snug font-light text-fg/85">
        <li>1. Check in with one tap before you board.</li>
        <li>2. Travel anywhere in the GA area of validity; your ticket is your phone.</li>
        <li>3. Check out when you arrive. You are charged the best available price for the day.</li>
      </ol>
      <Card className="mt-4 space-y-2 p-4">
        <InfoLine label="Class" value="2nd class" />
        <InfoLine label="Reduction" value="Half Fare Travelcard" />
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
  return (
    <Sheet title="Journey completed" onClose={onClose}>
      <Card className="space-y-2 p-4">
        <InfoLine label="Checked in at" value={summary.from} />
        <InfoLine label="Duration" value={`${summary.minutes} min`} />
        <InfoLine label="Class" value="2nd class, Half Fare" />
        {summary.pass && <InfoLine label={`Covered by ${summary.pass}`} value={summary.charged ? `${summary.minutes - summary.charged} of ${summary.minutes} min` : "Whole journey"} />}
        <div className="border-t border-line pt-2">
          <InfoLine label={<b className="font-bold text-fg">Price</b>} value={<b className="font-bold">CHF {summary.price.toFixed(2)}</b>} />
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
      </div>
    </Sheet>
  );
}
