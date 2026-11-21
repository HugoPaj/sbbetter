"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLES } from "./journey-map";

export type RouteLine = { coords: [number, number][]; walk?: boolean }; // [lon, lat]
export type RoutePoint = { lon: number; lat: number; name: string; major?: boolean };

/** Small static-ish map that fits a route: solid lines for rides, dashed for walks. */
export function RouteMap({ lines, points, className }: { lines: RouteLine[]; points: RoutePoint[]; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const data = useRef({ lines, points });

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    (async () => {
      const ml = await import("maplibre-gl");
      ml.setWorkerUrl("/maplibre-gl-worker.mjs");
      if (cancelled || !container.current) return;
      const { lines, points } = data.current;
      const all = [...lines.flatMap((l) => l.coords), ...points.map((p) => [p.lon, p.lat] as [number, number])];
      if (all.length === 0) return;
      // The theme when the sheet opens; the map lives only as long as the sheet.
      const dark = document.documentElement.dataset.theme !== "light";
      const bounds = all.reduce((b, c) => b.extend(c), new ml.LngLatBounds(all[0], all[0]));
      map = new ml.Map({
        container: container.current,
        style: MAP_STYLES[dark ? "dark" : "light"].url,
        bounds,
        fitBoundsOptions: { padding: 48, maxZoom: 16 },
        attributionControl: { compact: true },
      });
      const ro = new ResizeObserver(() => map?.resize());
      ro.observe(container.current);
      map.once("remove", () => ro.disconnect());
      map.on("load", () => {
        const attrib = map!.getContainer().querySelector(".maplibregl-ctrl-attrib");
        attrib?.classList.remove("maplibregl-compact-show");
        attrib?.removeAttribute("open");
        map!.addSource("route", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: lines
              .filter((l) => l.coords.length > 1)
              .map((l) => ({ type: "Feature" as const, properties: { walk: !!l.walk }, geometry: { type: "LineString" as const, coordinates: l.coords } })),
          },
        });
        map!.addLayer({
          id: "ride",
          type: "line",
          source: "route",
          filter: ["!", ["get", "walk"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#eb0000", "line-width": 4 },
        });
        map!.addLayer({
          id: "walk",
          type: "line",
          source: "route",
          filter: ["get", "walk"],
          paint: { "line-color": "#2f8cff", "line-width": 3, "line-dasharray": [1, 1.6] },
        });
        map!.addSource("points", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: points.map((p) => ({ type: "Feature" as const, properties: { name: p.name, major: !!p.major }, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } })),
          },
        });
        map!.addLayer({
          id: "points",
          type: "circle",
          source: "points",
          paint: {
            "circle-radius": ["case", ["get", "major"], 6, 3.5],
            "circle-color": "#fff",
            "circle-stroke-color": ["case", ["get", "major"], "#eb0000", "#000"],
            "circle-stroke-width": ["case", ["get", "major"], 3, 1],
          },
        });
        map!.addLayer({
          id: "point-labels",
          type: "symbol",
          source: "points",
          filter: ["get", "major"],
          layout: {
            "text-field": ["get", "name"],
            "text-size": 13,
            "text-offset": [0, -1.2],
            "text-anchor": "bottom",
            "text-max-width": 9,
            "text-font": ["Montserrat Medium", "Open Sans Regular", "Noto Sans Regular", "Noto Sans CJK JP Regular"],
          },
          paint: { "text-color": dark ? "#fff" : "#111", "text-halo-color": dark ? "#000" : "#fff", "text-halo-width": 1.4 },
        });
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return (
    <div className={`route-map relative overflow-hidden rounded-[19px] bg-surface ${className ?? ""}`}>
      <div ref={container} className="size-full" />
    </div>
  );
}
