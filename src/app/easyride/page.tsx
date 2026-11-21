"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Checkbox, Header, InfoLine, OutlineButton, PrimaryButton, Sheet, toast } from "@/components/ui";
import { EmptyState } from "@/components/scene";
import { actions, useSetting } from "@/lib/store";
import { DEFAULT_POSITION } from "@/lib/mock-data";
import { nearbyStations } from "@/lib/transport";

type Summary = { minutes: number; price: number; from: string; start: number; end: number };

/** Nearest stop to the browser position (EPFL fallback), for the check-in label. */
function nearestStop(): Promise<string> {
  const lookup = (lat: number, lon: number) =>
    nearbyStations(lat, lon)
      .then((s) => s[0]?.name ?? "Current location")
      .catch(() => "Current location");
  return new Promise((resolve) => {
    const fallback = () => resolve(lookup(DEFAULT_POSITION.lat, DEFAULT_POSITION.lon));
    if (!("geolocation" in navigator)) return fallback();
    navigator.geolocation.getCurrentPosition((p) => resolve(lookup(p.coords.latitude, p.coords.longitude)), fallback, { timeout: 3000, maximumAge: 60_000 });
  });
}

/** EasyRide: mock set-up, then check-in / check-out with a running timer. */
export default function EasyRidePage() {
  const router = useRouter();
  const [ready, setReady] = useSetting<boolean>("easyride.ready", false);
  // The running journey is persisted so it survives tab switches and reloads.
  const [checkedInAt, setCheckedInAt] = useSetting<number>("easyride.since", 0);
  const [from, setFrom] = useSetting<string>("easyride.from", "");
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

  const elapsed = checkedInAt && now ? Math.max(0, Math.floor((now - checkedInAt) / 1000)) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  function checkIn() {
    const t = Date.now();
    setNow(t);
    setCheckedInAt(t);
    setFrom("");
    toast("Checked in. Have a good journey!");
    nearestStop().then(setFrom);
  }

  function checkOut() {
    const end = Date.now();
    const minutes = Math.max(1, Math.round((end - checkedInAt) / 60000));
    // MOCK fare: short-distance price plus a little per minute, half fare.
    const price = Math.ceil((2.3 + Math.max(0, minutes - 10) * 0.22) * 5) / 5;
    setSummary({ minutes, price, from: from || "Current location", start: checkedInAt, end });
    setCheckedInAt(0);
    actions.addTicket({
      id: `er-${end}`,
      product: "EasyRide",
      from: from || "EasyRide journey",
      to: "",
      via: `${minutes} min, best price calculated automatically`,
      validFrom: new Date(checkedInAt).toISOString(),
      validTo: new Date(end).toISOString(),
      price,
      travelClass: 2,
    });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Header title="EasyRide" />
      <EmptyState
        variant="station"
        top={59.5}
        title={checkedInAt ? `Checked in · ${mm}:${ss}` : ready ? "Ready to go." : "A new freedom to travel in Switzerland."}
        text={
          checkedInAt
            ? `${from ? `Checked in at ${from}. ` : ""}Have a good journey. Check out when you reach your destination; the best fare is calculated automatically.`
            : ready
              ? "Check in before you board and check out when you arrive. The price of your journey is calculated automatically afterwards."
              : "EasyRide means you don’t need to search for the right ticket. That’s because the price of your journey is calculated automatically, so you can hop on and off public transport, wherever and whenever you’d like."
        }
        action={
          <PrimaryButton onClick={() => (checkedInAt ? checkOut() : ready ? checkIn() : setSetup(true))}>
            {checkedInAt ? "Check out" : ready ? "Check in" : "Set up EasyRide"}
          </PrimaryButton>
        }
      />

      {setup && (
        <Sheet title="Set up EasyRide" onClose={() => setSetup(false)}>
          <ol className="space-y-2 px-1 text-[14.5px] leading-snug font-light text-white/85">
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
            <div className="border-t border-line pt-2">
              <InfoLine label={<b className="font-bold text-white">Price</b>} value={<b className="font-bold">CHF {summary.price.toFixed(2)}</b>} />
            </div>
          </Card>
          <p className="my-3 px-1 text-[11px] text-muted">Prototype only — the price is a mock estimate and nothing was charged.</p>
          <div className="space-y-2.5">
            <PrimaryButton onClick={() => setSummary(null)}>Done</PrimaryButton>
            <OutlineButton onClick={() => router.push("/tickets")}>Show in Tickets</OutlineButton>
          </div>
        </Sheet>
      )}
    </div>
  );
}
