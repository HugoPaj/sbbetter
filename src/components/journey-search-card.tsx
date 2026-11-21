"use client";

import { useState } from "react";
import { ArrowUpDown, Check, History } from "lucide-react";
import type { JourneyQuery } from "@/lib/journey-query";
import { TRANSPORT_FILTERS, type TransportFilter } from "@/lib/transport";
import { formatShortDate, zurichDateTime } from "@/lib/format";
import { Card, Checkbox, PillToggle, PrimaryButton, Sheet, Toggle, cn } from "./ui";
import { SlidersIcon, StopIcon, TargetIcon } from "./icons";
import { ModeBadge } from "./journey";
import { LocationPicker } from "./plan/location-picker";
import { CURRENT_LOCATION } from "@/lib/use-position";

/** From/To + date/time + filters card at the top of the Connections screen. */
export function JourneySearchCard({
  query,
  onChange,
  showPrices,
  onShowPricesChange,
}: {
  query: JourneyQuery;
  onChange: (q: JourneyQuery) => void;
  showPrices: boolean;
  onShowPricesChange: (v: boolean) => void;
}) {
  const [sheet, setSheet] = useState<"advanced" | "datetime" | "from" | "to" | null>(null);
  const isCurrent = query.fromName === "Current location";
  const when = new Date(`${query.date}T${query.time || "00:00"}:00`);

  const swap = () =>
    onChange({
      ...query,
      from: query.to,
      fromName: query.toName,
      to: query.from,
      toName: query.fromName,
      walkMinutes: undefined,
    });

  return (
    <>
      <Card className="overflow-hidden shadow-lg shadow-black/40">
        <div className="relative">
          <span aria-hidden className="absolute top-[31.5px] bottom-[31.5px] left-[21.5px] w-px bg-white" />
          <button onClick={() => setSheet("from")} className="flex h-[47.5px] w-full items-center gap-3 pr-[71px] pl-3 text-left">
            {isCurrent ? <TargetIcon className="size-5 shrink-0 text-[#2f8cff]" /> : <StopIcon className="size-5 shrink-0" />}
            <span className="truncate text-[16px] font-light tracking-tight">{query.fromName}</span>
          </button>
          <div className="ml-11 h-px bg-surface-3" />
          <button onClick={() => setSheet("to")} className="flex h-[47.5px] w-full items-center gap-3 pr-[71px] pl-3 text-left">
            <StopIcon className="size-5 shrink-0" />
            <span className="truncate text-[16px] font-light tracking-tight">{query.toName}</span>
          </button>
          <button
            aria-label="Swap"
            onClick={swap}
            className="absolute top-1/2 right-3 flex size-[44px] -translate-y-1/2 items-center justify-center rounded-full border border-white/50 bg-surface"
          >
            <ArrowUpDown className="size-6" strokeWidth={1.1} />
          </button>
        </div>
        <div className="ml-11 h-px bg-surface-3" />
        <div className="flex h-[44px] items-stretch">
          <button
            onClick={() => setSheet("datetime")}
            className="flex min-w-0 items-center gap-[8.5px] pl-11 text-[15.5px] font-light tracking-tight tabular-nums whitespace-nowrap text-muted"
          >
            <span>{formatShortDate(when)}</span>
            <span className="h-4.25 w-px shrink-0 bg-surface-3" />
            <span>
              {query.time} {query.isArrivalTime ? "arr" : "dep"}
            </span>
            <span className="h-4.25 w-px shrink-0 bg-surface-3" />
          </button>
          <button
            aria-label="Now"
            onClick={() => onChange({ ...query, ...zurichDateTime(), isArrivalTime: false })}
            className="px-3"
          >
            <History className="size-5" strokeWidth={1.25} />
          </button>
          <span className="flex-1" />
          <button
            aria-label="Advanced search"
            onClick={() => setSheet("advanced")}
            className="relative flex w-[46px] shrink-0 items-center justify-center border-l border-surface-3"
          >
            <SlidersIcon className="size-6" strokeWidth={1.1} />
            {(query.transportations.length > 0 || query.via) && (
              <span className="absolute top-1.25 right-1.25 flex size-4.25 items-center justify-center rounded-full bg-sbb-red">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
          </button>
        </div>
      </Card>

      {sheet === "advanced" && (
        <AdvancedSearch
          value={query.transportations}
          via={query.via ? { id: query.via, name: query.viaName ?? query.via } : null}
          showPrices={showPrices}
          onShowPricesChange={onShowPricesChange}
          onClose={() => setSheet(null)}
          onApply={(tr, via) => {
            if (tr.join() === query.transportations.join() && (via?.id ?? "") === (query.via ?? "")) return;
            onChange({ ...query, transportations: tr, via: via?.id, viaName: via?.name });
          }}
        />
      )}
      {sheet === "datetime" && (
        <DateTimeSheet
          query={query}
          onClose={() => setSheet(null)}
          onApply={(p) => {
            setSheet(null);
            onChange({ ...query, ...p });
          }}
        />
      )}
      {(sheet === "from" || sheet === "to") && (
        <LocationPicker
          title={sheet === "from" ? "From" : "To"}
          allowCurrent={false}
          onClose={() => setSheet(null)}
          onPick={(e) => {
            const which = sheet;
            setSheet(null);
            if (e.id === CURRENT_LOCATION) return;
            onChange(
              which === "from"
                ? { ...query, from: e.id, fromName: e.name, walkMinutes: undefined }
                : { ...query, to: e.id, toName: e.name },
            );
          }}
        />
      )}
    </>
  );
}

const TRAIN_SUBTYPES: { value: TransportFilter; label: string }[] = [
  { value: "ice_tgv_rj", label: "ICE/TGV/RJ" },
  { value: "ec_ic", label: "EC/IC" },
  { value: "ir", label: "IR/PE" },
  { value: "re_d", label: "RE" },
  { value: "s_sn_r", label: "S/SN/R" },
  { value: "arz_ext", label: "ARZ/EXT" },
];
const OTHER_MODES: { value: TransportFilter; label: string; cat: string }[] = [
  { value: "bus", label: "Bus", cat: "B" },
  { value: "ship", label: "Ship", cat: "BAT" },
  { value: "cableway", label: "Funicular/Cog railway", cat: "GB" },
  { value: "tramway_underground", label: "Tramway/Underground", cat: "T" },
];

function Row({ children, indent, onClick }: { children: React.ReactNode; indent?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("flex min-h-[46px] w-full items-center gap-[8.5px] py-1.75 text-left text-[16.5px] font-bold tracking-tight", indent && "pl-5")}>
      {children}
    </button>
  );
}

function AdvancedSearch({
  value,
  via: initialVia,
  onApply,
  onClose,
  showPrices,
  onShowPricesChange,
}: {
  value: TransportFilter[];
  via: { id: string; name: string } | null;
  onApply: (v: TransportFilter[], via: { id: string; name: string } | null) => void;
  onClose: () => void;
  showPrices: boolean;
  onShowPricesChange: (v: boolean) => void;
}) {
  const [limit, setLimit] = useState(value.length > 0);
  const [sel, setSel] = useState<Set<TransportFilter>>(new Set(value.length ? value : TRANSPORT_FILTERS));
  const [via, setVia] = useState(initialVia !== null);
  const [viaStop, setViaStop] = useState(initialVia);
  const [pickVia, setPickVia] = useState(false);

  const toggle = (vals: TransportFilter[], on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      vals.forEach((v) => (on ? n.add(v) : n.delete(v)));
      return n;
    });
  const trainVals = TRAIN_SUBTYPES.map((t) => t.value);
  const allTrains = trainVals.every((v) => sel.has(v));

  const close = () => {
    const all = sel.size === TRANSPORT_FILTERS.length;
    onClose();
    onApply(limit && !all && sel.size > 0 ? [...sel] : [], via ? viaStop : null);
  };

  return (
    <Sheet title="Advanced search" onClose={close} full>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3.5 border-b border-surface-3 px-4 py-[15px]">
          <div className="flex-1">
            <p className="text-[16px] leading-tight font-light tracking-tight">Via</p>
            <p className="mt-[8.5px] text-[11.5px] leading-tight font-light tracking-tight text-muted">Show via</p>
          </div>
          <Toggle
            on={via}
            onChange={(v) => {
              setVia(v);
              if (v && !viaStop) setPickVia(true);
            }}
          />
        </div>
        {via && (
          <button onClick={() => setPickVia(true)} className="flex h-[47.5px] w-full items-center gap-3 border-b border-surface-3 pr-4 pl-4 text-left">
            <StopIcon className="size-5 shrink-0" />
            <span className={cn("truncate text-[16px] font-light tracking-tight", !viaStop && "text-muted")}>{viaStop ? `Via ${viaStop.name}` : "Choose via stop"}</span>
          </button>
        )}
        <div className="flex items-center gap-3.5 border-b border-surface-3 px-4 py-[15px]">
          <div className="flex-1">
            <p className="text-[16px] leading-tight font-light tracking-tight">Price display</p>
            <p className="mt-[8.5px] text-[11.5px] leading-tight font-light tracking-tight text-muted">Show prices in timetable</p>
          </div>
          <Toggle on={showPrices} onChange={onShowPricesChange} />
        </div>
        <div className="flex items-center gap-3.5 px-4 py-[15px]">
          <div className="flex-1">
            <p className="text-[16px] leading-tight font-light tracking-tight">Means of transport</p>
            <p className="mt-[8.5px] text-[11.5px] leading-tight font-light tracking-tight text-muted">Limit your search to certain means of transport</p>
          </div>
          <Toggle on={limit} onChange={setLimit} />
        </div>
        {limit && (
          <div className="ml-4 border-t border-surface-3 pb-[3.5px]">
            <Row onClick={() => toggle(trainVals, !allTrains)}>
              <Checkbox checked={allTrains} />
              <ModeBadge category="IR" className="size-6" /> Train
            </Row>
            {TRAIN_SUBTYPES.map((t) => (
              <Row key={t.value} indent onClick={() => toggle([t.value], !sel.has(t.value))}>
                <Checkbox checked={sel.has(t.value)} /> {t.label}
              </Row>
            ))}
            {OTHER_MODES.map((m) => (
              <div key={m.value} className="border-t border-surface-3">
                <Row onClick={() => toggle([m.value], !sel.has(m.value))}>
                  <Checkbox checked={sel.has(m.value)} />
                  <ModeBadge category={m.cat} className="size-6" /> {m.label}
                </Row>
              </div>
            ))}
          </div>
        )}
      </Card>
      {pickVia && (
        <LocationPicker
          title="Via"
          allowCurrent={false}
          onClose={() => setPickVia(false)}
          onPick={(e) => {
            setPickVia(false);
            setViaStop({ id: e.id, name: e.name });
          }}
        />
      )}
    </Sheet>
  );
}

function DateTimeSheet({
  query,
  onApply,
  onClose,
}: {
  query: JourneyQuery;
  onApply: (p: Pick<JourneyQuery, "date" | "time" | "isArrivalTime">) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(query.date);
  const [time, setTime] = useState(query.time);
  const [arr, setArr] = useState<"dep" | "arr">(query.isArrivalTime ? "arr" : "dep");
  return (
    <Sheet title="Date and time" onClose={onClose}>
      <div className="flex gap-2.5">
        <PillToggle
          value={arr}
          onChange={setArr}
          options={[
            { value: "dep", label: "Departure" },
            { value: "arr", label: "Arrival" },
          ]}
        />
      </div>
      <Card className="mt-3.5 space-y-2.5 p-3.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl bg-surface-2 px-3.5 py-2.5 text-[16px] [color-scheme:dark]" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-xl bg-surface-2 px-3.5 py-2.5 text-[16px] [color-scheme:dark]" />
      </Card>
      <div className="mt-4.25 flex gap-2.5">
        <button
          onClick={() => {
            const n = zurichDateTime();
            setDate(n.date);
            setTime(n.time);
          }}
          className="rounded-full border border-white/40 px-5 text-[15.5px] font-light"
        >
          Now
        </button>
        <PrimaryButton onClick={() => onApply({ date, time, isArrivalTime: arr === "arr" })}>Search</PrimaryButton>
      </div>
    </Sheet>
  );
}
