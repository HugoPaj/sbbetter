"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, PrimaryButton, cn } from "./ui";
import { formatTime } from "@/lib/format";
import type { Tone, Verdict } from "@/lib/disruption";

/** Green = nothing to do, amber = plan changed, red = you must act. Nothing else uses these. */
export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", changed: "text-warn", act: "text-sbb-red" };
const TONE_BAR: Record<Tone, string> = { ok: "bg-ok", changed: "bg-warn", act: "bg-sbb-red" };

/**
 * What a disruption means for this traveller, in one sentence, with at most
 * one thing to do about it. Everything else stays behind "Why?".
 */
export function VerdictCard({ verdict, onAccept, onOthers }: { verdict: Verdict; onAccept: () => void; onOthers: () => void }) {
  const [open, setOpen] = useState(false);
  const alt = verdict.alternative;
  return (
    <Card className="relative overflow-hidden pt-3.5 pr-[15px] pb-3 pl-5">
      <span className={cn("absolute inset-y-0 left-0 w-[5px]", TONE_BAR[verdict.tone])} />
      <p className={cn("text-[12px] font-bold tracking-[0.06em] uppercase", TONE_TEXT[verdict.tone])}>{verdict.label}</p>
      <h2 className="mt-1 text-[19px] leading-[1.2] font-bold tracking-tight">{verdict.headline}</h2>
      <p className="mt-1.5 text-[14.5px] leading-snug font-light text-white/85">{verdict.detail}</p>

      {alt && (
        <>
          <p className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-[14.5px] font-light">
            <span className="text-muted">New arrival</span>
            <span>
              <b className="text-[16px] font-bold tabular-nums">{formatTime(alt.connection.to.arrival)}</b>
              {alt.lateMinutes > 0 && <span className="ml-2 font-bold text-warn">+{alt.lateMinutes} min</span>}
            </span>
          </p>
          <PrimaryButton onClick={onAccept} className="mt-3.5">
            Use this connection
          </PrimaryButton>
          <button onClick={onOthers} className="mt-1 flex h-9 w-full items-center justify-center text-[13.5px] font-light text-muted">
            See other connections
          </button>
        </>
      )}

      {verdict.why && (
        <div className={cn(!alt && "mt-2.5")}>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-8 items-center gap-1 text-[13.5px] font-light text-muted">
            Why?
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && <p className="pb-1 text-[13px] leading-snug font-light text-white/80">{verdict.why} (Simulated for this demo.)</p>}
        </div>
      )}
    </Card>
  );
}
