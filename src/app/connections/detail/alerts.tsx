"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Ticket, TriangleAlert } from "lucide-react";
import { Skeleton, cn } from "@/components/ui";
import { disruptionEnd } from "@/lib/disruption-forecast";
import { formatTime } from "@/lib/format";
import { passNotice, type PassSaving } from "@/lib/pricing";
import type { Disruption } from "@/lib/transport";

/** Notices at the head of the timeline: live service alerts and what a travelcard means for the ticket. */

/** What the traveller's travelcard means for this trip's ticket, at the head of the timeline. */
export function PassNotice({ pass, pricing, trip }: { pass: PassSaving; /** The saving is still being priced. */ pricing: boolean; trip: { from: string | null; to: string | null } }) {
  const { headline, detail } = passNotice(pass, trip);
  // Holds the place of "You save CHF …" so the notice doesn't grow when the price arrives.
  const saving = pricing && <Skeleton className="inline-block h-[11px] w-[104px] align-middle" />;
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2.5 text-left">
        <Ticket className="mt-px size-4.5 shrink-0 text-ok" strokeWidth={2} />
        <span className="flex-1 text-[14.5px] leading-snug font-bold">{headline}</span>
        <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />
      </button>
      {open && (
        <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-fg/80">
          {detail}
          {saving}
        </p>
      )}
    </div>
  );
}

/**
 * Live service messages at the head of the timeline: one alert row, however many there are.
 * Several collapse into "2 service alerts on your route", expanding to each summary.
 * When a line is closed, line memory adds the way round (`planB`, always visible) and
 * what usually happens next (`details`, in the expanded part).
 */
export function DisruptionNotices({ disruptions, planB, details }: { disruptions: Disruption[]; planB?: ReactNode; details?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const single = disruptions.length === 1;
  const more = (d: Disruption) => d.description || d.reason;
  const expandable = !single || !!more(disruptions[0]) || !!details;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!expandable} className="flex w-full items-start gap-2.5 text-left">
        <TriangleAlert className="mt-px size-4.5 shrink-0 text-sbb-red" strokeWidth={2} />
        <span className="flex-1 text-[14.5px] leading-snug font-bold">{single ? disruptions[0].summary : `${disruptions.length} service alerts on your route`}</span>
        {expandable && <ChevronDown className={cn("mt-px size-4.25 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.5} />}
      </button>
      <LikelyOver disruptions={disruptions} />
      {planB}
      {open &&
        (single ? (
          more(disruptions[0]) && <p className="mt-1.5 pl-7 text-[13px] leading-snug font-light text-fg/80">{more(disruptions[0])}</p>
        ) : (
          <ul className="mt-2 space-y-2 pl-7">
            {disruptions.map((d, i) => (
              <li key={i} className="text-[13px] leading-snug">
                <p className="font-bold">{d.summary}</p>
                {more(d) && <p className="mt-0.5 font-light text-fg/80">{more(d)}</p>}
              </li>
            ))}
          </ul>
        ))}
      {open && details}
    </div>
  );
}

/** When the (first unplanned) disruption is likely over, from past disruptions with the same cause. */
function LikelyOver({ disruptions }: { disruptions: Disruption[] }) {
  const end = disruptions.map((d) => disruptionEnd(d)).find(Boolean);
  if (!end) return null;
  const at = (ms: number) => formatTime(new Date(ms).toISOString());
  return (
    <p className="mt-1 pl-7 text-[14.5px] leading-snug font-light">
      Likely over around {at(end.likely)}
      {end.sbb && end.sbb < end.likely && <span className="text-fg/60"> (SBB says {at(end.sbb)})</span>}
    </p>
  );
}
