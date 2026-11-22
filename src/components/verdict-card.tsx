"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { Sheet, cn } from "./ui";
import type { Verdict } from "@/lib/disruption";

/**
 * What a disruption means for this traveller, in one sentence. It heads the
 * journey timeline; the affected legs and the suggested alternative are drawn
 * inside the timeline itself.
 */
export function VerdictBanner({
  verdict,
  sub,
  more,
  sheet,
}: {
  verdict: Verdict;
  /** Always shown under the headline (e.g. the service alerts behind it). */
  sub?: ReactNode;
  /** Shown with the explanation, once expanded. */
  more?: ReactNode;
  /** The whole story, in a sheet: the banner then opens it instead of unfolding. */
  sheet?: { title: string; body: ReactNode };
}) {
  const [open, setOpen] = useState(false);
  const alt = verdict.alternative;
  const Icon = verdict.tone === "ok" ? CircleCheck : TriangleAlert;
  const color = verdict.tone === "ok" ? "text-ok" : verdict.tone === "act" ? "text-sbb-red" : "text-amber-400";
  if (sheet)
    return (
      <>
        <button onClick={() => setOpen(true)} className="block w-full text-left">
          <span className="flex items-start gap-2.5">
            <Icon className={cn("mt-px size-4.5 shrink-0", color)} strokeWidth={2} />
            <span className="flex-1 text-[14.5px] leading-snug font-bold">{verdict.headline}</span>
            <ChevronRight className="mt-px size-4.25 shrink-0 text-muted" strokeWidth={1.5} />
          </span>
          {!alt && <span className="mt-1 block pl-7 text-[14.5px] leading-snug font-light">{verdict.detail}</span>}
          {sub}
        </button>
        {open && (
          <Sheet title={sheet.title} onClose={() => setOpen(false)}>
            {sheet.body}
          </Sheet>
        )}
      </>
    );
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!verdict.why && !more} className="flex w-full items-start gap-2.5 text-left">
        <Icon className={cn("mt-px size-4.5 shrink-0", color)} strokeWidth={2} />
        <span className="flex-1 text-[14.5px] leading-snug font-bold">{verdict.headline}</span>
        {(verdict.why || more) && <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />}
      </button>
      {/* With an alternative, the "Take instead" box in the timeline says what to do. */}
      {!alt && <p className="mt-1 pl-7 text-[14.5px] leading-snug font-light">{verdict.detail}</p>}
      {sub}
      {open && verdict.why && <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-fg/80">{verdict.why} {verdict.note ?? "(Simulated for this demo.)"}</p>}
      {open && more}
    </div>
  );
}
