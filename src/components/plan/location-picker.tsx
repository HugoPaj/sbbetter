"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { searchLocations, type Location } from "@/lib/transport";
import { CURRENT_LOCATION, type Endpoint } from "@/lib/use-position";
import { FAVOURITES } from "@/lib/mock-data";
import { StopIcon, TargetIcon } from "../icons";
import { Overlay, useEscape } from "../ui";
import { ModeBadge } from "../journey";

const ICON_CATEGORY: Record<string, string> = { bus: "B", train: "IR", tram: "T", ship: "BAT", cableway: "GB" };

/** Full-screen stop/address search. Desktop: a centred dialog. */
export function LocationPicker({
  title,
  onPick,
  onClose,
  allowCurrent = true,
}: {
  title: string;
  onPick: (e: Endpoint) => void;
  onClose: () => void;
  allowCurrent?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      searchLocations(q, ctrl.signal)
        .then(setResults)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const shown = q.trim().length < 2 ? [] : results;
  const ref = useEscape(onClose);

  return (
    <Overlay>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={onClose}
        className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col bg-page animate-fade-in lg:max-w-none lg:items-center lg:justify-center lg:bg-black/60"
      >
        {/* On phones this fills the screen; on desktop it is the dialog panel. */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex min-h-0 flex-1 flex-col lg:h-[min(640px,calc(100dvh-96px))] lg:w-[560px] lg:flex-none lg:overflow-hidden lg:rounded-[24px] lg:border lg:border-fg/10 lg:bg-page lg:shadow-2xl lg:shadow-black"
        >
        <div className="bg-sbb-red px-[8.5px] text-white pt-[max(env(safe-area-inset-top),9px)] pb-2.5">
          <div className="relative flex h-10.25 items-center justify-center">
            <button aria-label="Back" onClick={onClose} className="absolute left-0 -ml-1.25 p-1.75">
              <ChevronLeft className="size-6" strokeWidth={1.75} />
            </button>
            <h1 className="text-[18.5px] font-light tracking-tight">{title}</h1>
          </div>
          <label className="mt-[3.5px] flex h-[44px] items-center gap-2.5 rounded-[15px] bg-surface px-3.5 text-fg">
            <Search className="size-4.25 shrink-0 text-muted" strokeWidth={1.5} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Stop, address, point of interest"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-light tracking-tight outline-none placeholder:text-muted"
            />
          </label>
        </div>
        <ul className="no-scrollbar flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {allowCurrent && (
            <Row onClick={() => onPick({ id: CURRENT_LOCATION, name: "Current location" })}>
              <TargetIcon className="size-5 shrink-0 text-[#2f8cff]" />
              <span>Current location</span>
            </Row>
          )}
          {q.trim().length < 2 &&
            FAVOURITES.map((f) => (
              <Row key={f.id} onClick={() => onPick({ id: f.id, name: f.id })}>
                <StopIcon className="size-5 shrink-0 text-fg/70" />
                <span>{f.id}</span>
              </Row>
            ))}
          {loading && shown.length === 0 && <li className="px-4.25 py-3.5 text-muted">Searching…</li>}
          {shown.map((s) => (
            <Row key={`${s.id}-${s.name}`} onClick={() => onPick({ id: s.id ?? s.name!, name: s.name! })}>
              {s.icon && ICON_CATEGORY[s.icon] ? (
                <ModeBadge category={ICON_CATEGORY[s.icon]} />
              ) : (
                <StopIcon className="size-5 shrink-0 text-fg/70" />
              )}
              <span>{s.name}</span>
            </Row>
          ))}
        </ul>
        </div>
      </div>
    </Overlay>
  );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex min-h-12 w-full items-center gap-3.5 border-b border-line px-[15px] py-2.5 text-left text-[16px] leading-tight font-light tracking-tight transition-colors hover:bg-fg/5">
        {children}
      </button>
    </li>
  );
}
