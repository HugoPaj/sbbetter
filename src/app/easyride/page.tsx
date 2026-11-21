"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Checkbox, Header, InfoLine, OutlineButton, PrimaryButton, Sheet, toast } from "@/components/ui";
import { EmptyState } from "@/components/scene";
import { actions, useSetting } from "@/lib/store";
import { DEFAULT_POSITION } from "@/lib/mock-data";
import { usePasses } from "@/lib/travelcards";
import { passCovering, uncovered } from "@/lib/passes";
import { nearbyStations } from "@/lib/transport";

type Summary = { minutes: number; charged: number; pass: string | null; price: number; from: string; start: number; end: number };
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

/** EasyRide: mock set-up, then check-in / check-out with a running timer. */
export default function EasyRidePage() {
  const router = useRouter();
  const passes = usePasses();
  const [ready, setReady] = useSetting<boolean>("easyride.ready", false);
  // The running journey is persisted so it survives tab switches and reloads.
  const [checkedInAt, setCheckedInAt] = useSetting<number>("easyride.since", 0);
  const [from, setFrom] = useSetting<string>("easyride.from", "");
  // Where the journey started ("lat,lon"): a zone pass covers it if it also ends inside its zones.
  const [startedAt, setStartedAt] = useSetting<string>("easyride.at", "");
  const [checkingOut, setCheckingOut] = useState(false);
  const [now, setNow] = useState(0);
  const [setup, setSetup] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

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

  // While a travelcard is valid there is nothing to charge, so no check-in is offered.
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
  const noCheckIn = ready && !checkedInAt && !!free;

  const elapsed = checkedInAt && now ? Math.max(0, Math.floor((now - checkedInAt) / 1000)) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

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

  async function checkOut() {
    if (checkingOut) return;
    const end = Date.now();
    setCheckingOut(true);
    const here = await locate();
    setCheckingOut(false);
    const minutes = Math.max(1, Math.round((end - checkedInAt) / 60000));
    // Only what no travelcard covers is charged: nothing inside the zones of a zone pass, and with the Night GA only the minutes before 19:00 / after 05:00.
    const { minutes: charged, pass } = uncovered(passes, checkedInAt, end, { from: parseSpot(startedAt), to: here });
    // MOCK fare: short-distance price plus a little per minute, half fare.
    const price = charged ? Math.ceil((2.3 + Math.max(0, charged - 10) * 0.22) * 5) / 5 : 0;
    setSummary({ minutes, charged, pass, price, from: from || "Current location", start: checkedInAt, end });
    setCheckedInAt(0);
    if (!charged) return;
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
  }

  return (
    <div className="flex min-h-(--app-h) flex-col">
      <Header title="EasyRide" />
      <EmptyState
        variant="station"
        top={59.5}
        title={checkedInAt ? `Checked in · ${mm}:${ss}` : noCheckIn ? "No check-in needed." : ready ? "Ready to go." : "A new freedom to travel in Switzerland."}
        text={
          checkedInAt
            ? `${from ? `Checked in at ${from}. ` : ""}Have a good journey. Check out when you reach your destination; the best fare is calculated automatically.`
            : noCheckIn
              ? `Your ${free} is valid right now, so 2nd class travel is free. There is nothing for EasyRide to charge.`
              : ready
              ? "Check in before you board and check out when you arrive. The price of your journey is calculated automatically afterwards."
              : "EasyRide means you don’t need to search for the right ticket. That’s because the price of your journey is calculated automatically, so you can hop on and off public transport, wherever and whenever you’d like."
        }
        action={
          <PrimaryButton disabled={noCheckIn} onClick={() => (checkedInAt ? checkOut() : ready ? checkIn() : setSetup(true))}>
            {checkingOut ? "Checking out…" : checkedInAt ? "Check out" : noCheckIn ? "No ticket needed" : ready ? "Check in" : "Set up EasyRide"}
          </PrimaryButton>
        }
      />

      {setup && (
        <Sheet title="Set up EasyRide" onClose={() => setSetup(false)}>
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
            <PrimaryButton
              onClick={() => {
                if (!accepted) return toast("Please accept the terms of use first.");
                setReady(true);
                setSetup(false);
                toast("EasyRide is set up. Tap “Check in” to start a journey.");
              }}
            >
              Activate EasyRide
            </PrimaryButton>
          </div>
          <p className="mt-3 px-1 text-[11px] text-muted">Prototype only — no location tracking and no payment.</p>
        </Sheet>
      )}

      {summary && (
        <Sheet title="Journey completed" onClose={() => setSummary(null)}>
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
            <PrimaryButton onClick={() => setSummary(null)}>Done</PrimaryButton>
            {summary.price > 0 && <OutlineButton onClick={() => router.push("/tickets")}>Show in Tickets</OutlineButton>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
