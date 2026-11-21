"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { MAP_STYLES, type MapStyleId } from "./journey-map";

export type LonLat = [number, number];

/** One trip section on the map: a ride along its stops, or a walk between two points. */
export type MapPart = {
  coords: LonLat[];
  walk?: boolean;
  stops: { at: LonLat; name: string; end?: boolean }[];
};

export type MapPadding = { top: number; bottom: number; /** Desktop: the floating panel on the left and the map buttons on the right. */ left?: number; right?: number };

const LINE = "#2d327d";
const BOLD = ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular", "Noto Sans CJK JP Regular"];

/**
 * Full-bleed dark map of a connection (SBB "map" view of a connection). The
 * active section is drawn on top at full strength and the camera follows it;
 * the other sections stay visible but dimmed.
 */
export function ConnectionMap({
  parts,
  active,
  self,
  recenterKey,
  styleId = "dark",
  padding,
}: {
  parts: MapPart[];
  active: number;
  self: { lat: number; lon: number } | null;
  recenterKey: number;
  styleId?: MapStyleId;
  /** Space covered by the floating card (top) and the bottom sheet (bottom), in px. */
  padding: MapPadding;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef({ parts, active, self, padding, styleId });
  useEffect(() => {
    latest.current = { parts, active, self, padding, styleId };
  });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const ml = await import("maplibre-gl");
      ml.setWorkerUrl("/maplibre-gl-worker.mjs");
      if (cancelled || !container.current) return;
      const { styleId } = latest.current;
      const bounds = boundsOf(ml, latest.current.parts, latest.current.active);
      map = new ml.Map({
        container: container.current,
        style: MAP_STYLES[styleId].url,
        ...(bounds ? { bounds, fitBoundsOptions: { padding: pad(latest.current.padding), maxZoom: 16 } } : { center: [7.44, 46.95], zoom: 7 }),
        attributionControl: false,
      });
      map.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;
      const ro = new ResizeObserver(() => map?.resize());
      ro.observe(container.current);
      map.once("remove", () => ro.disconnect());
      map.on("load", () => {
        const attrib = map!.getContainer().querySelector(".maplibregl-ctrl-attrib");
        attrib?.classList.remove("maplibregl-compact-show");
        attrib?.removeAttribute("open");
      });
      // Fires for the first style and after every style switch (which drops custom layers).
      map.on("style.load", () => {
        addLayers(map!, MAP_STYLES[latest.current.styleId].dark);
        sync(map!, latest.current);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Route data and highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getSource("route")) sync(map, { parts, active, self });
  }, [parts, active, self]);

  // Follow the active section (and re-fit when the sheet changes height).
  const { top, bottom, left, right } = padding;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (async () => {
      const ml = await import("maplibre-gl");
      const bounds = boundsOf(ml, latest.current.parts, active);
      if (bounds) map.fitBounds(bounds, { padding: pad({ top, bottom, left, right }), maxZoom: 16, duration: 600 });
    })();
    // `parts` is only read through `latest` so a re-render doesn't move the camera.
  }, [active, top, bottom, left, right]);

  // "Locate me".
  useEffect(() => {
    const map = mapRef.current;
    const s = latest.current.self;
    if (!map || !s || recenterKey === 0) return;
    map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15), padding: pad(latest.current.padding), duration: 600 });
  }, [recenterKey]);

  // Base-map style.
  const appliedStyle = useRef(styleId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyle.current === styleId) return;
    appliedStyle.current = styleId;
    map.setStyle(MAP_STYLES[styleId].url);
  }, [styleId]);

  return (
    <div className="connection-map absolute inset-0" style={{ ["--map-bottom" as string]: `${padding.bottom}px` }}>
      <div ref={container} className="size-full" />
    </div>
  );
}

const pad = (p: MapPadding) => ({ top: p.top + 24, bottom: p.bottom + 44, left: (p.left ?? 0) + 48, right: (p.right ?? 0) + 48 });

function boundsOf(ml: typeof import("maplibre-gl"), parts: MapPart[], active: number) {
  const coords = parts[active]?.coords.length ? parts[active].coords : parts.flatMap((p) => p.coords);
  if (coords.length === 0) return null;
  return coords.reduce((b, c) => b.extend(c), new ml.LngLatBounds(coords[0], coords[0]));
}

function addLayers(map: MapLibreMap, dark: boolean) {
  if (map.getSource("route")) return;
  const fc = { type: "FeatureCollection" as const, features: [] };
  map.addSource("route", { type: "geojson", data: fc });
  map.addSource("stops", { type: "geojson", data: fc });
  map.addSource("self", { type: "geojson", data: fc });

  const dim = ["case", ["get", "active"], 1, 0.4] as const;
  map.addLayer({
    id: "walk",
    type: "line",
    source: "route",
    filter: ["get", "walk"],
    layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["case", ["get", "active"], 1, 0] },
    paint: { "line-color": dark ? "#d0d0d0" : "#555", "line-width": 3.5, "line-dasharray": [0.1, 2], "line-opacity": dim as never },
  });
  map.addLayer({
    id: "ride-casing",
    type: "line",
    source: "route",
    filter: ["!", ["get", "walk"]],
    layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["case", ["get", "active"], 1, 0] },
    paint: { "line-color": dark ? "#c9cce9" : "#fff", "line-width": 7.5, "line-opacity": dim as never },
  });
  map.addLayer({
    id: "ride",
    type: "line",
    source: "route",
    filter: ["!", ["get", "walk"]],
    layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["case", ["get", "active"], 1, 0] },
    paint: { "line-color": LINE, "line-width": 4.5, "line-opacity": dim as never },
  });
  map.addLayer({
    id: "stops-minor",
    type: "circle",
    source: "stops",
    filter: ["!", ["get", "end"]],
    paint: {
      "circle-radius": 3.5,
      "circle-color": "#fff",
      "circle-stroke-color": LINE,
      "circle-stroke-width": 1.5,
      "circle-opacity": dim as never,
      "circle-stroke-opacity": dim as never,
    },
  });
  map.addLayer({
    id: "stops-major",
    type: "circle",
    source: "stops",
    filter: ["get", "end"],
    paint: { "circle-radius": 7, "circle-color": "#000", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 },
  });
  map.addLayer({
    id: "stop-labels",
    type: "symbol",
    source: "stops",
    filter: ["any", ["get", "active"], ["get", "end"]],
    layout: {
      "text-field": ["get", "name"],
      "text-size": ["case", ["get", "active"], 15, 13],
      "text-font": BOLD,
      "text-variable-anchor": ["left", "right", "bottom", "top"],
      "text-radial-offset": 0.9,
      "text-justify": "auto",
      "text-max-width": 9,
      "symbol-sort-key": ["case", ["all", ["get", "active"], ["get", "end"]], 0, ["get", "active"], 1, 2],
    },
    paint: { "text-color": dark ? "#fff" : "#111", "text-halo-color": dark ? "#000" : "#fff", "text-halo-width": 1.4 },
  });
  map.addLayer({
    id: "self-halo",
    type: "circle",
    source: "self",
    paint: { "circle-radius": 16, "circle-color": "#2f8cff", "circle-opacity": 0.18 },
  });
  map.addLayer({
    id: "self",
    type: "circle",
    source: "self",
    paint: { "circle-radius": 8, "circle-color": "#2f8cff", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 },
  });
}

function sync(map: MapLibreMap, { parts, active, self }: { parts: MapPart[]; active: number; self: { lat: number; lon: number } | null }) {
  (map.getSource("route") as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: parts
      .filter((p) => p.coords.length > 1)
      .map((p) => ({
        type: "Feature" as const,
        properties: { walk: !!p.walk, active: parts.indexOf(p) === active },
        geometry: { type: "LineString" as const, coordinates: p.coords },
      })),
  });
  // A transfer stop ends one section and starts the next: draw (and label) it once.
  const stops = new Map<string, { name: string; at: LonLat; end: boolean; active: boolean }>();
  parts.forEach((p, i) =>
    p.stops.forEach((s) => {
      const key = `${s.name}@${s.at.join()}`;
      const prev = stops.get(key);
      stops.set(key, { name: s.name, at: s.at, end: !!s.end || !!prev?.end, active: i === active || !!prev?.active });
    }),
  );
  (map.getSource("stops") as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: [...stops.values()].map((s) => ({
      type: "Feature" as const,
      properties: { name: s.name, end: s.end, active: s.active },
      geometry: { type: "Point" as const, coordinates: s.at },
    })),
  });
  (map.getSource("self") as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: self ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [self.lon, self.lat] } }] : [],
  });
}
