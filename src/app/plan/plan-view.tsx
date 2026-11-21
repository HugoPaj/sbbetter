"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Funnel, Layers, MapPin, Navigation } from "lucide-react";
import { Card, Checkbox, Header, OutlineButton, Overlap, PrimaryButton, Radio, Segmented, Sheet, Toggle, cn, toast } from "@/components/ui";
import { BoardIcon, MapSearchIcon, StopIcon, TargetIcon } from "@/components/icons";
import { JourneyMap, MAP_STYLES, STOP_MODES, type MapStyleId } from "@/components/plan/journey-map";
import { ModeBadge } from "@/components/journey";
import { LocationPicker } from "@/components/plan/location-picker";
import { DepartureBoard } from "@/components/plan/departure-board";
import { TouchTimetable } from "@/components/plan/touch-timetable";
import { buildJourney, CURRENT_LOCATION, usePosition, type Endpoint } from "@/lib/use-position";
import { journeyHref } from "@/lib/journey-query";
import { nearbyStations } from "@/lib/transport";
import { useTheme } from "@/lib/theme";

type View = "timetable" | "touch";

export function PlanView() {
  const router = useRouter();
  const pos = usePosition();
  const [view, setView] = useState<View>("timetable");
  const [from, setFrom] = useState<Endpoint>({ id: CURRENT_LOCATION, name: "Current location" });
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [board, setBoard] = useState<{ id: string; name: string } | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"filter" | "layers" | null>(null);
  // The base map follows the theme until one is picked under "Map layers".
  const theme = useTheme();
  const [pickedStyle, setMapStyle] = useState<MapStyleId | null>(null);
  const mapStyle = pickedStyle ?? theme;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [showStops, setShowStops] = useState(true);
  /** "Pick on map": the crosshair in the middle of the map chooses the place. */
  const [pickOnMap, setPickOnMap] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  const pickedPoint = (): Endpoint => {
    const c = mapCenter ?? pos;
    return { id: `coord:${c.lat.toFixed(5)},${c.lon.toFixed(5)}`, name: "Selected location" };
  };

  async function search(f: Endpoint, t: Endpoint) {
    setBusy(true);
    setError(null);
    try {
      const q = await buildJourney(f, t, pos);
      router.push(journeyHref("/connections", q));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function openNearestBoard() {
    try {
      const [s] = await nearbyStations(pos.lat, pos.lon);
      if (s) setBoard({ id: s.id!, name: s.name! });
      else toast("No stop found near your position.");
    } catch {
      toast("Could not load nearby stops.");
    }
  }

  return (
    <div className={view === "timetable" ? "flex h-dvh flex-col overflow-hidden" : "flex min-h-dvh flex-col"}>
      <Header title="Plan" extend>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "timetable", label: "Timetable" },
            { value: "touch", label: "Touch timetable" },
          ]}
        />
      </Header>

      {view === "timetable" ? (
        <div className="group relative min-h-0 flex-1">
          <JourneyMap
            center={pos}
            showSelf
            recenterKey={recenter}
            onStopClick={setBoard}
            onCenterChange={setMapCenter}
            styleId={mapStyle}
            hiddenModes={hidden}
            showStops={showStops}
          />

          {/* Search card: sits on the header skirt, above the map. Desktop: a floating panel on the left. */}
          <Overlap className="lg:w-[440px] lg:px-6">
            <div className="flex overflow-hidden rounded-[19px] bg-surface shadow-xl shadow-black/50">
              <div className="relative min-w-0 flex-1">
                <span aria-hidden className="absolute top-[31.5px] bottom-[31.5px] left-[21.5px] w-px bg-fg" />
                <button onClick={() => setPicking("from")} className="flex h-[47.5px] w-full items-center gap-3 pr-2.5 pl-3 text-left transition-colors hover:bg-fg/5">
                  {from.id === CURRENT_LOCATION ? <TargetIcon className="size-5 shrink-0 text-[#2f8cff]" /> : <StopIcon className="size-5 shrink-0" />}
                  <span className="truncate text-[16px] font-light tracking-tight">{from.name}</span>
                </button>
                <div className="ml-11 h-px bg-surface-3" />
                <button onClick={() => setPicking("to")} className="flex h-[47.5px] w-full items-center gap-3 pr-2.5 pl-3 text-left transition-colors hover:bg-fg/5">
                  <StopIcon className="size-5 shrink-0" />
                  <span className="truncate text-[16px] font-light tracking-tight text-muted">{busy ? "Searching…" : "To"}</span>
                </button>
              </div>
              <div className="flex items-center border-l border-surface-3 px-[13.5px]">
                <button
                  aria-label="Pick on map"
                  aria-pressed={pickOnMap}
                  onClick={() => setPickOnMap((p) => !p)}
                  className={cn("flex size-[32px] items-center justify-center rounded-full border border-fg/50", pickOnMap && "bg-fg text-page")}
                >
                  <MapSearchIcon className="size-5" />
                </button>
              </div>
            </div>
            {error && <p className="mx-[3.5px] mt-1.75 rounded-xl bg-page/80 px-2.5 py-1.75 text-sm text-sbb-red">{error}</p>}
          </Overlap>

          {/* Floating map controls */}
          <div className="absolute top-[83px] right-[8.5px] z-10 flex flex-col gap-[8.5px] lg:top-6 lg:right-6">
            <MapButton label="Filter" onClick={() => setSheet("filter")} active={hidden.size > 0 || !showStops}>
              <Funnel className="size-5" strokeWidth={1.25} />
            </MapButton>
            <MapButton label="Recenter" onClick={() => setRecenter((n) => n + 1)}>
              <Navigation className="size-5" strokeWidth={1.25} />
            </MapButton>
            <MapButton label="Map layers" onClick={() => setSheet("layers")}>
              <Layers className="size-5" strokeWidth={1.25} />
            </MapButton>
          </div>

          {pickOnMap ? (
            <>
              {/* Crosshair pin: its tip marks the map centre. */}
              <MapPin aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-10 size-9 -translate-x-1/2 -translate-y-full fill-sbb-red text-white drop-shadow-lg" strokeWidth={1.25} />
              <div className="absolute inset-x-[8.5px] bottom-[calc(var(--home-inset)+94px)] z-10 rounded-[19px] bg-[#171717] p-3 light:bg-white shadow-xl shadow-black/60 lg:right-auto lg:left-1/2 lg:w-[420px] lg:-translate-x-1/2">
                <p className="px-1 pb-2.5 text-[13.5px] font-light tracking-tight text-fg/85">Move the map to place the pin, then choose:</p>
                <div className="flex gap-2">
                  <OutlineButton
                    onClick={() => {
                      setFrom(pickedPoint());
                      setPickOnMap(false);
                      toast("Departure set to the selected location. Now choose a destination.");
                    }}
                  >
                    From here
                  </OutlineButton>
                  <PrimaryButton
                    disabled={busy}
                    onClick={() => {
                      setPickOnMap(false);
                      search(from, pickedPoint());
                    }}
                  >
                    To here
                  </PrimaryButton>
                </div>
              </div>
            </>
          ) : (
            <button
              onClick={openNearestBoard}
              className="absolute bottom-[calc(var(--home-inset)+94px)] left-1/2 z-10 flex h-[31px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-fg/50 bg-[#141414] light:bg-white px-3.5 text-[16px] font-light tracking-tight whitespace-nowrap transition-colors group-has-[.maplibregl-compact-show]:invisible hover:bg-[#2a2a2a] light:hover:bg-[#ececec] lg:group-has-[.maplibregl-compact-show]:visible"
            >
              <BoardIcon className="size-[22px]" /> Departure board
            </button>
          )}
        </div>
      ) : (
        <>
          <TouchTimetable onSearch={search} />
          {busy && <p className="mt-1.75 text-center text-muted">Searching…</p>}
          {error && <p className="mt-1.75 text-center text-sbb-red">{error}</p>}
          <div className="h-[calc(109px+var(--home-inset))]" />
        </>
      )}

      {picking && (
        <LocationPicker
          title={picking === "from" ? "From" : "To"}
          onClose={() => setPicking(null)}
          onPick={(e) => {
            setPicking(null);
            if (picking === "from") setFrom(e);
            else search(from, e);
          }}
        />
      )}
      {sheet === "filter" && (
        <Sheet title="Filter" onClose={() => setSheet(null)}>
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3.5 border-b border-surface-3 px-4 py-[13px]">
              <div className="flex-1">
                <p className="text-[16px] leading-tight font-light tracking-tight">Stops</p>
                <p className="mt-1.5 text-[11.5px] leading-tight font-light tracking-tight text-muted">Show stops on the map</p>
              </div>
              <Toggle on={showStops} onChange={setShowStops} />
            </div>
            {showStops &&
              STOP_MODES.map((m) => {
                const on = !hidden.has(m.value);
                return (
                  <button
                    key={m.value}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() =>
                      setHidden((h) => {
                        const n = new Set(h);
                        if (on) n.add(m.value);
                        else n.delete(m.value);
                        return n;
                      })
                    }
                    className="flex min-h-[46px] w-full items-center gap-[8.5px] border-b border-surface-3 px-4 text-left text-[16px] font-light tracking-tight last:border-b-0"
                  >
                    <Checkbox checked={on} />
                    <ModeBadge category={MODE_CATEGORY[m.value]} className="size-6" /> {m.label}
                  </button>
                );
              })}
          </Card>
        </Sheet>
      )}
      {sheet === "layers" && (
        <Sheet title="Map layers" onClose={() => setSheet(null)}>
          <Card className="overflow-hidden">
            {(Object.keys(MAP_STYLES) as MapStyleId[]).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={mapStyle === id}
                onClick={() => setMapStyle(id)}
                className="flex min-h-[46px] w-full items-center gap-3 border-b border-surface-3 px-4 text-left text-[16px] font-light tracking-tight last:border-b-0"
              >
                <Radio checked={mapStyle === id} /> {MAP_STYLES[id].label}
              </button>
            ))}
          </Card>
        </Sheet>
      )}
      {board && <DepartureBoard stationId={board.id} stationName={board.name} onClose={() => setBoard(null)} />}
    </div>
  );
}

const MODE_CATEGORY: Record<string, string> = { train: "IR", bus: "B", tram: "T", ship: "BAT", cableway: "GB" };

function MapButton({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button aria-label={label} onClick={onClick} className="relative flex size-[44px] items-center justify-center rounded-full border border-fg/50 bg-[#141414] light:bg-white transition-colors hover:bg-[#2a2a2a] light:hover:bg-[#ececec]">
      {children}
      {active && <span aria-hidden className="absolute top-0 right-0 size-3 rounded-full border-2 border-[#141414] light:border-white bg-sbb-red" />}
    </button>
  );
}
