"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, LocateFixed, MapPin } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { nearbyStations, type Location } from "@/lib/transport";
import { usePosition, type Endpoint } from "@/lib/use-position";
import { MAP_STYLES } from "./journey-map";
import { PrimaryButton, toast, useEscape } from "../ui";

type LatLon = { lat: number; lon: number };

/**
 * Drag the map under a fixed centre pin to choose a place.
 * mode "point": returns the exact spot ("coord:lat,lon"), the timetable routes
 * to/from it with a walk. mode "stop": returns the stop nearest the pin.
 */
export function MapPicker({
  title,
  mode,
  onPick,
  onClose,
}: {
  title: string;
  mode: "point" | "stop";
  onPick: (e: Endpoint) => void;
  onClose: () => void;
}) {
  const pos = usePosition();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [center, setCenter] = useState<LatLon | null>(null);
  const [near, setNear] = useState<{ at: LatLon; stop: Location | null } | null>(null);
  const [moving, setMoving] = useState(false);
  const ref = useEscape(onClose);

  // Create the map once, at the latest known position (a fix can arrive while maplibre loads).
  const start = useRef(pos);
  useEffect(() => {
    start.current = pos;
  }, [pos]);
  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    (async () => {
      const ml = await import("maplibre-gl");
      ml.setWorkerUrl("/maplibre-gl-worker.mjs");
      if (cancelled || !container.current) return;
      const dark = document.documentElement.dataset.theme !== "light";
      map = new ml.Map({
        container: container.current,
        style: MAP_STYLES[dark ? "dark" : "light"].url,
        center: [start.current.lon, start.current.lat],
        zoom: 15,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      const ro = new ResizeObserver(() => map?.resize());
      ro.observe(container.current);
      map.once("remove", () => ro.disconnect());
      map.on("load", () => {
        const attrib = map!.getContainer().querySelector(".maplibregl-ctrl-attrib");
        attrib?.classList.remove("maplibregl-compact-show");
        attrib?.removeAttribute("open");
        const c = map!.getCenter();
        setCenter({ lat: c.lat, lon: c.lng });
      });
      map.on("movestart", () => setMoving(true));
      map.on("moveend", () => {
        setMoving(false);
        const c = map!.getCenter();
        setCenter({ lat: c.lat, lon: c.lng });
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Jump to the real position once geolocation answers (unless the user already moved).
  const touched = useRef(false);
  useEffect(() => {
    if (!pos.real || touched.current) return;
    mapRef.current?.jumpTo({ center: [pos.lon, pos.lat] });
  }, [pos.real, pos.lat, pos.lon]);

  // Nearest stop to the pin.
  useEffect(() => {
    if (!center) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      nearbyStations(center.lat, center.lon, ctrl.signal)
        .then((s) => setNear({ at: center, stop: s[0] ?? null }))
        .catch(() => !ctrl.signal.aborted && setNear({ at: center, stop: null }));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [center]);

  const loading = !!center && near?.at !== center;
  const n = near?.stop;
  const stop = n?.id && n.name ? { id: n.id, name: n.name } : null;
  const busy = moving || loading || !center;
  const distance = n?.distance != null ? (n.distance >= 1000 ? `${(n.distance / 1000).toFixed(1)} km` : `${Math.round(n.distance)} m`) : null;

  const pickPoint = () => {
    if (!center) return;
    onPick({ id: `coord:${center.lat.toFixed(5)},${center.lon.toFixed(5)}`, name: stop ? `Near ${stop.name}` : "Point on map" });
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}: choose on map`}
      className="fixed inset-0 z-[60] mx-auto flex max-w-[430px] flex-col bg-page animate-fade-in lg:max-w-none"
    >
      <div className="relative z-10 bg-sbb-red px-[8.5px] text-white pt-[max(calc(var(--safe-top)+var(--top-gap)),9px)] pb-2.5">
        <div className="relative flex h-10.25 items-center justify-center">
          <button aria-label="Back" onClick={onClose} className="absolute left-0 -ml-1.25 p-1.75">
            <ChevronLeft className="size-6" strokeWidth={1.75} />
          </button>
          <h1 className="text-[18.5px] font-light tracking-tight">{title}</h1>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* maplibre's CSS forces position:relative on the map element, so size it inside an absolute wrapper. */}
        <div className="absolute inset-0" onPointerDown={() => (touched.current = true)} onWheel={() => (touched.current = true)}>
          <div ref={container} className="h-full w-full" />
        </div>
        {/* Fixed centre pin: its tip marks the map centre. */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
          <MapPin
            className={`size-10 fill-sbb-red text-white drop-shadow-lg transition-transform duration-150 ${moving ? "-translate-y-2" : ""}`}
            strokeWidth={1.5}
          />
        </div>
        <div className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40" />
        <button
          aria-label="Go to my location"
          onClick={() => (pos.real ? mapRef.current?.easeTo({ center: [pos.lon, pos.lat], zoom: Math.max(mapRef.current.getZoom(), 15) }) : toast(pos.settled ? "Your location isn't available." : "Finding your location…"))}
          className="absolute right-3 bottom-3 grid size-11 place-items-center rounded-full bg-surface text-fg shadow-lg shadow-black/40"
        >
          <LocateFixed className="size-5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="border-t border-line bg-page px-[15px] pt-3.5 pb-[max(env(safe-area-inset-bottom),14px)]">
        <p className="min-h-[42px] text-[15px] leading-tight font-light tracking-tight">
          {busy && !stop ? (
            <span className="text-muted">Finding the nearest stop…</span>
          ) : stop ? (
            <>
              <span className="text-muted">{mode === "point" ? "Nearest stop" : "Stop"}</span>
              <br />
              <span className={busy ? "opacity-50" : ""}>
                {stop.name}
                {distance && <span className="text-muted"> · {distance}</span>}
              </span>
            </>
          ) : (
            <span className="text-muted">No stop nearby. Move the map closer to a stop.</span>
          )}
        </p>
        {mode === "point" ? (
          <div className="mt-3 flex flex-col gap-2">
            <PrimaryButton onClick={pickPoint} disabled={!center || moving}>
              Use this point
            </PrimaryButton>
            {stop && (
              <button onClick={() => onPick(stop)} disabled={busy} className="h-10 text-[15px] font-light tracking-tight text-fg/80 underline-offset-2 hover:underline disabled:opacity-50">
                Use {stop.name} instead
              </button>
            )}
          </div>
        ) : (
          <PrimaryButton className="mt-3" onClick={() => stop && onPick(stop)} disabled={!stop || busy}>
            {stop ? `Choose ${stop.name}` : "Choose stop"}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
