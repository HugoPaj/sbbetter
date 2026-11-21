"use client";

import { useState } from "react";
import { ChevronDown, CircleCheck, TriangleAlert } from "lucide-react";
import { ConnectionCard } from "./journey";
import { Card, OutlineButton, PrimaryButton, cn } from "./ui";
import { formatTime } from "@/lib/format";
import type { Verdict } from "@/lib/disruption";

/**
 * What a disruption means for this traveller, in one sentence, with at most
 * one thing to do about it. Built from the app's own pieces: the alert card
 * used for service messages and the connection card used in search results.
 */
export function VerdictCard({ verdict, altHref, onAccept, onOthers }: { verdict: Verdict; altHref?: string; onAccept: () => void; onOthers: () => void }) {
  const [open, setOpen] = useState(false);
  const alt = verdict.alternative;
  const Icon = verdict.tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div className="space-y-[8.5px]">
      <Card className="px-[15px] py-3">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!verdict.why} className="flex w-full items-start gap-2.5 text-left">
          <Icon className={cn("mt-px size-4.5 shrink-0", verdict.tone === "ok" ? "text-ok" : "text-sbb-red")} strokeWidth={2} />
          <span className="flex-1 text-[14.5px] leading-snug font-bold">{verdict.headline}</span>
          {verdict.why && <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />}
        </button>
        <p className="mt-1 pl-7 text-[14.5px] leading-snug font-light">
          {verdict.detail}
          {alt && ` You’ll arrive at ${formatTime(alt.connection.to.arrival)}${alt.lateMinutes > 0 ? `, ${alt.lateMinutes} min later` : ""}.`}
        </p>
        {open && <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-white/80">{verdict.why} (Simulated for this demo.)</p>}
      </Card>

      {alt && altHref && (
        <>
          <ConnectionCard connection={alt.connection} href={altHref} />
          <div className="space-y-2.5 pt-2">
            <PrimaryButton onClick={onAccept}>Use this connection</PrimaryButton>
            <OutlineButton onClick={onOthers}>Other connections</OutlineButton>
          </div>
        </>
      )}
    </div>
  );
}
