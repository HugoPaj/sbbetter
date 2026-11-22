"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, InfoLine, OutlineButton, PrimaryButton, Sheet, toast } from "@/components/ui";
import { formatDate, formatTime } from "@/lib/format";
import { openSbb } from "@/lib/sbb-deeplink";
import { actions, useAppState } from "@/lib/store";

/** After this long a purchase that was never confirmed is dropped without asking. */
const FORGET_MS = 24 * 3600e3;

/**
 * Tickets are bought in the SBB app, which can't call back or tell us whether the traveller paid.
 * So once they are back (the app shown again, or opened later) this asks: bought or not?
 * Closing the sheet asks again the next time the app is opened.
 */
export function PurchaseReturn() {
  const { pendingPurchase: p } = useAppState();
  const router = useRouter();
  /** The purchase (by its `at`) the traveller came back from on this page, and the one whose question was closed. */
  const [returned, setReturned] = useState(0);
  const [closed, setClosed] = useState(0);

  useEffect(() => {
    if (!p) return;
    if (Date.now() - p.at > FORGET_MS) return actions.cancelPurchase();
    // Started on this page: ask once the traveller has been to the SBB app and come back.
    let left = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left = true;
      else if (left) setReturned(p.at);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [p]);

  // Started before this page loaded (the app opened again later): ask straight away.
  const ask = !!p && closed !== p.at && (returned === p.at || (p.at < performance.timeOrigin && performance.timeOrigin - p.at <= FORGET_MS));
  if (!p || !ask) return null;
  const t = p.ticket;
  const close = () => setClosed(p.at);
  return (
    <Sheet title="Did you buy the ticket?" onClose={close}>
      <p className="px-1 text-[14.5px] leading-snug font-light text-fg/85">The SBB app doesn’t tell us, so we ask. If you bought it, we keep it with your tickets and the journey.</p>
      <Card className="mt-4 space-y-2 p-4">
        <InfoLine label="Ticket" value={t.product} />
        <InfoLine label="Route" value={[t.from, t.to].filter(Boolean).join(" → ")} />
        <InfoLine label="Travel" value={`${formatDate(new Date(t.validFrom))}, ${t.travelClass === 1 ? "1st" : "2nd"} class`} />
        <InfoLine label="Price" value={`about CHF ${t.price.toFixed(2)}`} />
      </Card>
      <div className="mt-4 space-y-2.5">
        <PrimaryButton
          onClick={() => {
            actions.confirmPurchase();
            close();
            toast(p.trip ? "Ticket and journey saved. Show the ticket from the SBB app." : "Ticket saved. Show it from the SBB app.");
            router.push("/tickets");
          }}
        >
          Yes, I bought it
        </PrimaryButton>
        <OutlineButton onClick={() => openSbb(p.sbb)}>Not yet: open the SBB app again</OutlineButton>
        <OutlineButton
          onClick={() => {
            actions.cancelPurchase();
            close();
          }}
        >
          No, I didn’t buy it
        </OutlineButton>
      </div>
      <p className="mt-3 text-center text-[12px] font-light text-muted">Left the SBB app at {formatTime(new Date(p.at).toISOString())}.</p>
    </Sheet>
  );
}
