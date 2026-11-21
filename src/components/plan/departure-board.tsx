"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStationboard, type StationboardEntry } from "@/lib/transport";
import { formatTime, zurichDateTime } from "@/lib/format";
import { journeyHref } from "@/lib/journey-query";
import { ErrorBox, PillToggle, Sheet } from "../ui";
import { ListRowsSkeleton } from "../skeletons";
import { LineLabel, ModeBadge } from "../journey";

/** Live departures for one stop, as a bottom sheet. */
export function DepartureBoard({ stationId, stationName, onClose }: { stationId: string; stationName: string; onClose: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<"departure" | "arrival">("departure");
  // Tagged with the request it answers, so switching the type shows placeholders.
  const [result, setResult] = useState<{ key: string; entries: StationboardEntry[] | null; error: string | null }>({ key: "", entries: null, error: null });
  const key = `${stationId}|${type}`;

  useEffect(() => {
    const ctrl = new AbortController();
    getStationboard(stationId, { limit: 20, type }, ctrl.signal)
      .then((d) => setResult({ key: `${stationId}|${type}`, entries: d.stationboard, error: null }))
      .catch((e: Error) => e.name !== "AbortError" && setResult({ key: `${stationId}|${type}`, entries: null, error: `Could not load ${type}s.` }));
    return () => ctrl.abort();
  }, [stationId, type]);

  const entries = result.key === key ? result.entries : null;
  const error = result.key === key ? result.error : null;
  const arrivals = type === "arrival";

  /** Tap a departure: plan the journey from this stop to the line's destination. */
  const plan = (e: StationboardEntry) => {
    const when = e.stop.departure ? new Date(e.stop.departure) : new Date();
    onClose();
    router.push(journeyHref("/connections", { from: stationId, fromName: stationName, to: e.to, toName: e.to, ...zurichDateTime(when), isArrivalTime: false, transportations: [] }));
  };

  return (
    <Sheet title={stationName} onClose={onClose} full>
      {/* pt-px: the selected pill overhangs the track by 1px, which the sheet's scroll area would clip. */}
      <div className="mb-3 flex pt-px">
        <PillToggle
          value={type}
          onChange={setType}
          options={[
            { value: "departure", label: "Departures" },
            { value: "arrival", label: "Arrivals" },
          ]}
        />
      </div>
      {error && <ErrorBox message={error} />}
      {!entries && !error && <ListRowsSkeleton count={8} label={`Loading ${type}s`} className="divide-y divide-surface-3 rounded-[19px] bg-surface" />}
      {/* Quiet stops (e.g. campus lines at the weekend) return nothing for the next hours. */}
      {entries?.length === 0 && (
        <p className="rounded-[19px] bg-surface px-[15px] py-[14px] text-[14.5px] font-light text-muted">
          No {type}s in the next few hours.
        </p>
      )}
      <ul className="divide-y divide-surface-3 rounded-[19px] bg-surface">
        {entries?.map((e, i) => {
          const delay = e.stop.delay ?? 0;
          return (
            <li key={`${e.name}-${i}`}>
              <button
                onClick={() => plan(e)}
                disabled={arrivals || !e.to}
                aria-label={arrivals ? undefined : `Plan journey to ${e.to}`}
                className="flex min-h-[44px] w-full items-center gap-[8.5px] px-[15px] py-[8.5px] text-left"
              >
              <span className="w-[48px] shrink-0 text-[16px] font-bold tabular-nums">{formatTime(arrivals ? (e.stop.arrival ?? e.stop.departure) : e.stop.departure)}</span>
              <ModeBadge category={e.category} />
              <LineLabel journey={e} className="!text-[17px]" />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-light tracking-tight">{e.to}</span>
              {delay > 0 && <span className="shrink-0 text-[12px] text-sbb-red">+{delay}&apos;</span>}
              {e.stop.platform && <span className="shrink-0 text-[13px] font-light whitespace-nowrap text-muted">Pl. {e.stop.platform}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
