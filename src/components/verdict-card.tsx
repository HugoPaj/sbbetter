"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, CircleCheck, TriangleAlert } from "lucide-react";
import { cn } from "./ui";
import type { Verdict } from "@/lib/disruption";

/**
 * What a disruption means for this traveller, in one sentence. It heads the
 * journey timeline; the affected legs and the suggested alternative are drawn
 * inside the timeline itself.
 */
export function VerdictBanner({ verdict, more }: { verdict: Verdict; /** Shown with the explanation, once expanded. */ more?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const alt = verdict.alternative;
  const Icon = verdict.tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!verdict.why} className="flex w-full items-start gap-2.5 text-left">
        <Icon className={cn("mt-px size-4.5 shrink-0", verdict.tone === "ok" ? "text-ok" : verdict.tone === "act" ? "text-sbb-red" : "text-amber-400")} strokeWidth={2} />
        <span className="flex-1 text-[14.5px] leading-snug font-bold">{verdict.headline}</span>
        {verdict.why && <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />}
      </button>
      {/* With an alternative, the "Take instead" box in the timeline says what to do. */}
      {!alt && <p className="mt-1 pl-7 text-[14.5px] leading-snug font-light">{verdict.detail}</p>}
      {open && <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-fg/80">{verdict.why} (Simulated for this demo.)</p>}
      {open && more}
    </div>
  );
}
