"use client";

import { useRouter } from "next/navigation";
import { Card, InfoLine, OutlineButton, PrimaryButton, Sheet, cn, toast } from "@/components/ui";
import { QrOffIcon } from "@/components/icons";
import { USER } from "@/lib/mock-data";
import { actions, type Ticket } from "@/lib/store";
import { formatDate, formatTime, zurichDateTime } from "@/lib/format";
import { journeyHref } from "@/lib/journey-query";
import { openSbbApp } from "@/lib/sbb-deeplink";

/** Deterministic QR-looking pattern (NOT a real, scannable code). */
export function FakeQr({ seed, className }: { seed: string; className?: string }) {
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

/** A ticket opened full-screen: its code to show during inspection, details, and refund or buy again. */
export function TicketSheet({ ticket, valid, onClose }: { ticket: Ticket; valid: boolean; onClose: () => void }) {
  const router = useRouter();
  const route = [ticket.from, ticket.to].filter(Boolean).join(" → ");
  const inSbb = ticket.source === "sbb-app";
  const period = `${formatDate(new Date(ticket.validFrom))}, ${formatTime(ticket.validFrom)} – ${formatDate(new Date(ticket.validTo))}, ${formatTime(ticket.validTo)}`;
  return (
    <Sheet title={ticket.product} onClose={onClose} full={valid}>
      {valid && inSbb ? (
        <div className="rounded-[14px] bg-surface p-4">
          <p className="text-[14.5px] leading-snug font-light text-fg/85">You bought this ticket in the SBB app. Its code for inspection is there, in Tickets.</p>
          <PrimaryButton className="mt-3" onClick={openSbbApp}>
            Show ticket in the SBB app
          </PrimaryButton>
        </div>
      ) : valid ? (
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
        {!ticket.classless && <InfoLine label="Class" value={ticket.travelClass === 1 ? "1st class" : "2nd class"} />}
        <InfoLine label="Validity" value={period} />
        <InfoLine label="Price" value={`${inSbb ? "about " : ""}CHF ${ticket.price.toFixed(2)}`} />
        {inSbb ? <InfoLine label="Bought in" value="SBB app" /> : <InfoLine label="Ticket ID" value={ticket.id} />}
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
        {inSbb ? (
          <OutlineButton
            onClick={() => {
              actions.removeTicket(ticket.id);
              onClose();
              toast("Removed from SBBetter. To refund the ticket, use the SBB app.");
            }}
          >
            Remove from SBBetter
          </OutlineButton>
        ) : valid && (
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
