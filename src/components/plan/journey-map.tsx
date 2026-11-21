"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap } from "maplibre-gl";
import { nearbyStations, type Location } from "@/lib/transport";

export const MAP_STYLES = {
  dark: { label: "Dark", url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", dark: true },
  light: { label: "Light", url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json", dark: false },
  streets: { label: "Streets", url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json", dark: false },
} as const;
export type MapStyleId = keyof typeof MAP_STYLES;

/** Stop kinds as reported by the API's `icon` field. */
export const STOP_MODES = [
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
  { value: "tram", label: "Tramway/Underground" },
  { value: "ship", label: "Ship" },
  { value: "cableway", label: "Funicular/Cog railway" },
] as const;

type Overlay = { styleId: MapStyleId; hidden: ReadonlySet<string>; showStops: boolean };

/**
 * Dark vector map with nearby stops. Tap a stop to open its departure board.
 * MapLibre is imported lazily so it never runs during SSR.
 */
export function JourneyMap({
  center,
  showSelf,
  recenterKey,
  onStopClick,
  onCenterChange,
  styleId = "dark",
  hiddenModes = NONE,
  showStops = true,
}: {
  center: { lat: number; lon: number };
  showSelf: boolean;
  recenterKey: number;
  onStopClick: (stop: { id: string; name: string }) => void;
  /** Reports the map centre after every move (used by "pick on map"). */
  onCenterChange?: (c: { lat: number; lon: number }) => void;
  styleId?: MapStyleId;
  /** Stop kinds (see STOP_MODES) to hide. */
  hiddenModes?: ReadonlySet<string>;
  showStops?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onStopRef = useRef(onStopClick);
  const onCenterRef = useRef(onCenterChange);
  const selfRef = useRef({ center, showSelf });
  const overlayRef = useRef<Overlay>({ styleId, hidden: hiddenModes, showStops });
  useEffect(() => {
    onStopRef.current = onStopClick;
    onCenterRef.current = onCenterChange;
    selfRef.current = { center, showSelf };
    overlayRef.current = { styleId, hidden: hiddenModes, showStops };
  });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const ml = await import("maplibre-gl");
      ml.setWorkerUrl("/maplibre-gl-worker.mjs");
      if (cancelled || !container.current) return;
      map = new ml.Map({
        container: container.current,
        style: MAP_STYLES[overlayRef.current.styleId].url,
        center: [center.lon, center.lat],
        zoom: 15,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      // Keep the canvas sized to its container (layout can settle after init).
      const ro = new ResizeObserver(() => map?.resize());
      ro.observe(container.current);
      map.once("remove", () => ro.disconnect());

      map.on("load", () => {
        // Start with the attribution collapsed to its "i" button so it does not cover the map controls.
        const attrib = map!.getContainer().querySelector(".maplibregl-ctrl-attrib");
        attrib?.classList.remove("maplibregl-compact-show");
        attrib?.removeAttribute("open");
        map!.on("click", "stops", (e) => {
          const f = e.features?.[0];
          if (f?.properties) onStopRef.current({ id: String(f.properties.id), name: String(f.properties.name) });
        });
        map!.on("mouseenter", "stops", () => (map!.getCanvas().style.cursor = "pointer"));
        map!.on("mouseleave", "stops", () => (map!.getCanvas().style.cursor = ""));
        map!.on("moveend", () => {
          const c = map!.getCenter();
          onCenterRef.current?.({ lat: c.lat, lon: c.lng });
          loadStops(map!, overlayRef.current);
        });
        // The position may have arrived before the map finished loading.
        map!.jumpTo({ center: [selfRef.current.center.lon, selfRef.current.center.lat] });
      });
      // Fires for the first style and after every style switch (which drops custom layers).
      map.on("style.load", () => {
        addOverlays(map!, MAP_STYLES[overlayRef.current.styleId].dark);
        setSelf(map!, selfRef.current.center, selfRef.current.showSelf);
        applyStops(map!, overlayRef.current);
        loadStops(map!, overlayRef.current);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow position updates / recenter button.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), 15) });
    setSelf(map, { lat: center.lat, lon: center.lon }, showSelf);
  }, [center.lat, center.lon, showSelf, recenterKey]);

  // Base-map style.
  const appliedStyle = useRef(styleId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyle.current === styleId) return;
    appliedStyle.current = styleId;
    map.setStyle(MAP_STYLES[styleId].url);
  }, [styleId]);

  // Stop filter.
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyStops(map, { styleId, hidden: hiddenModes, showStops });
  }, [styleId, hiddenModes, showStops]);

  // maplibre-gl.css forces `position: relative` on the map element, so position a wrapper instead.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="size-full" />
    </div>
  );
}

function setSelf(map: MapLibreMap, center: { lat: number; lon: number }, show: boolean) {
  const src = map.getSource("self") as import("maplibre-gl").GeoJSONSource | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: show ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [center.lon, center.lat] } }] : [],
  });
}

const NONE: ReadonlySet<string> = new Set();

/** Stops are only loaded and shown from this zoom in; further out they would pile up into a clump. */
const STOPS_MIN_ZOOM = 13.5;
/** Fades the stops out over the half zoom level before they are hidden. */
const STOPS_FADE = ["interpolate", ["linear"], ["zoom"], STOPS_MIN_ZOOM - 0.5, 0, STOPS_MIN_ZOOM, 1] as ["interpolate", ["linear"], ["zoom"], ...number[]];

function addOverlays(map: MapLibreMap, dark: boolean) {
  if (map.getSource("stops")) return;
  map.addSource("stops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "stops",
    type: "circle",
    source: "stops",
    minzoom: STOPS_MIN_ZOOM - 0.5,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], STOPS_MIN_ZOOM, 3.5, 15, 5],
      "circle-color": dark ? "#dcdcdc" : "#222",
      "circle-stroke-color": dark ? "#000" : "#fff",
      "circle-stroke-width": 1.5,
      "circle-opacity": STOPS_FADE,
      "circle-stroke-opacity": STOPS_FADE,
    },
  });
  map.addLayer({
    id: "stop-labels",
    type: "symbol",
    source: "stops",
    minzoom: STOPS_MIN_ZOOM - 0.5,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 13,
      "text-offset": [0, -1.4],
      "text-anchor": "bottom",
      "text-max-width": 9,
      "text-font": ["Montserrat Medium", "Open Sans Regular", "Noto Sans Regular", "Noto Sans CJK JP Regular"],
    },
    paint: { "text-color": dark ? "#e6e6e6" : "#1a1a1a", "text-halo-color": dark ? "#000" : "#fff", "text-halo-width": 1.2, "text-opacity": STOPS_FADE },
  });
  map.addSource("self", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "self",
    type: "circle",
    source: "self",
    paint: { "circle-radius": 9, "circle-color": "#2f8cff", "circle-stroke-color": "#fff", "circle-stroke-width": 3 },
  });
}

let inflight: AbortController | null = null;
let lastStations: Location[] = [];

/** Push the last loaded stops to the map, minus the filtered-out kinds. */
function applyStops(map: MapLibreMap, o: Overlay) {
  const src = map.getSource("stops") as import("maplibre-gl").GeoJSONSource | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: !o.showStops
      ? []
      : lastStations
          .filter((s) => s.coordinate.x && s.coordinate.y && !(s.icon && o.hidden.has(s.icon)))
          .map((s) => ({
            type: "Feature" as const,
            properties: { id: s.id, name: s.name },
            geometry: { type: "Point" as const, coordinates: [s.coordinate.y!, s.coordinate.x!] },
          })),
  });
}

async function loadStops(map: MapLibreMap, o: Overlay) {
  if (map.getZoom() < STOPS_MIN_ZOOM) return;
  inflight?.abort();
  inflight = new AbortController();
  const c = map.getCenter();
  try {
    lastStations = await nearbyStations(c.lat, c.lng, inflight.signal);
    applyStops(map, o);
  } catch {
    /* aborted or offline */
  }
}
