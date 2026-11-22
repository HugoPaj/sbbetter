"use client";

import { ArrowRightLeft, CalendarPlus, FlaskConical, Share2, Star, Ticket } from "lucide-react";
import { Card, InfoLine, ListRow, OutlineButton, Radio, Sheet } from "@/components/ui";
import { RouteMap } from "@/components/plan/route-map";
import { SCENARIOS, type Scenario } from "@/lib/disruption";
import { formatTime } from "@/lib/format";
import type { Walk } from "./trip-map";

/** The connection page's bottom sheets. */

export function MoreSheet({
  saved,
  covered,
  offersHref,
  onShare,
  onCalendar,
  onToggleSaved,
  onReturn,
  onSimulate,
  onProgress,
  onClose,
}: {
  saved: boolean;
  /** A travelcard covers the trip: only upgrades and co-travellers are left to buy. */
  covered: boolean;
  offersHref: string;
  onShare: () => void;
  onCalendar: () => void;
  onToggleSaved: () => void;
  onReturn: () => void;
  onSimulate: () => void;
  onProgress: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="More" onClose={onClose}>
      <Card className="overflow-hidden">
        <ListRow icon={Share2} label="Share connection" onClick={onShare} />
        <ListRow icon={CalendarPlus} label="Add to calendar" onClick={onCalendar} />
        <ListRow icon={Star} label={saved ? "Remove from trips" : "Save trip"} onClick={onToggleSaved} />
        <ListRow icon={ArrowRightLeft} label="Return journey" onClick={onReturn} />
        <ListRow icon={Ticket} label={covered ? "Class upgrade or co-travellers" : "Buy ticket"} href={offersHref} />
        <ListRow icon={FlaskConical} label="Simulate a disruption (demo)" onClick={onSimulate} />
        <ListRow icon={FlaskConical} label="Simulate journey progress (demo)" onClick={onProgress} />
      </Card>
    </Sheet>
  );
}

/** Demo: pick a disruption to pretend happens to this connection. */
export function SimulateDisruptionSheet({ scenario, onPick, onClose }: { scenario: Scenario | ""; onPick: (s: Scenario | "") => void; onClose: () => void }) {
  return (
    <Sheet title="Simulate a disruption" onClose={onClose}>
      {SCENARIOS.map((o) => (
        <button key={o.value} onClick={() => onPick(o.value)} className="flex w-full items-center gap-3.5 py-2.5 text-left">
          <Radio checked={scenario === o.value} />
          <span>
            <span className="block text-[16px] font-light tracking-tight">{o.label}</span>
            <span className="block text-[13px] font-light text-muted">{o.hint}</span>
          </span>
        </button>
      ))}
    </Sheet>
  );
}

/** Demo: pick a moment along the journey to preview its progress at (`null`: follow the clock). */
export function SimulateProgressSheet({
  moments,
  at,
  onPick,
  onClose,
}: {
  moments: { label: string; at: number }[];
  at: number | null;
  onPick: (at: number | null) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Simulate journey progress" onClose={onClose}>
      {[{ label: "Real time", at: null }, ...moments].map((o, i) => (
        <button key={i} onClick={() => onPick(o.at)} className="flex w-full items-center gap-3.5 py-2.5 text-left">
          <Radio checked={at === o.at} />
          <span>
            <span className="block text-[16px] font-light tracking-tight">{o.label}</span>
            <span className="block text-[13px] font-light text-muted">{o.at === null ? "Follows the clock." : formatTime(new Date(o.at * 1000).toISOString())}</span>
          </span>
        </button>
      ))}
    </Sheet>
  );
}

/** A walk on the map, with a link to walking directions. */
export function WalkSheet({ walk, onClose }: { walk: Walk; onClose: () => void }) {
  return (
    <Sheet title="Walk" onClose={onClose}>
      {walk.a && walk.b && (
        <RouteMap
          lines={[{ coords: walk.track ?? [walk.a, walk.b], walk: true }]}
          points={[
            { lon: walk.a[0], lat: walk.a[1], name: walk.from, major: true },
            { lon: walk.b[0], lat: walk.b[1], name: walk.to, major: true },
          ]}
          className="mb-4 h-[260px]"
        />
      )}
      <Card className="space-y-2 p-4">
        <InfoLine label="From" value={walk.from} />
        <InfoLine label="To" value={walk.to} />
        <InfoLine label="Distance" value={`${walk.metres} m`} />
        <InfoLine label="Duration" value={`${walk.minutes} min`} />
      </Card>
      {walk.a && walk.b && (
        <div className="mt-4">
          <OutlineButton href={`https://www.google.com/maps/dir/?api=1&origin=${walk.a[1]},${walk.a[0]}&destination=${walk.b[1]},${walk.b[0]}&travelmode=walking`}>
            Open walking directions
          </OutlineButton>
        </div>
      )}
    </Sheet>
  );
}
