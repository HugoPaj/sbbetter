/**
 * Zone and area passes from the real tariff data in public/passes/ (built by
 * scripts/build-passes.py). If a rebuild changes what a pass covers, these say so.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { checkpoint } from "@/test/factories";
import { areaPass, nationalPasses, travelcardNames, zonePass, type Catalog, type PassFile } from "./travelcards";

const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../public/passes/${path}`, import.meta.url), "utf8"));
const catalog = json<Catalog>("index.json");
const stop = (id: string) => checkpoint([id, id, "12:00"]);

describe("Mobilis (zone pass)", () => {
  const meta = catalog.zonePasses.find((p) => p.id === "zone-mobilis-mobilis-abo-abo")!;
  const file = json<PassFile>("zone-mobilis-mobilis-abo-abo.json");
  const LAUSANNE = "8501120";
  const RENENS = "8501118";
  const MORGES = "8501037";

  test("covers a hop whose edge runs only through the zones bought", () => {
    const pass = zonePass(meta, ["11", "12"], file);
    expect(pass.name).toBe("Mobilis travelcard");
    expect(pass.covers(stop(LAUSANNE), stop(RENENS))).toBe(true);
    expect(pass.covers(stop(RENENS), stop(LAUSANNE))).toBe(true);
  });

  test("not a hop that runs through a zone not bought", () => {
    // Lausanne – Morges runs through zones 11, 12, 30 and 33.
    expect(zonePass(meta, ["11", "12"], file).covers(stop(LAUSANNE), stop(MORGES))).toBe(false);
    expect(zonePass(meta, ["11", "12", "30", "33"], file).covers(stop(LAUSANNE), stop(MORGES))).toBe(true);
  });

  test("a hop without an edge (a train skipping stops) is judged by its two stops' zones", () => {
    const pass = zonePass(meta, ["11", "12", "30"], file);
    // Two stops in zones bought, with no edge between them in the data.
    const edges = file.edges as Record<string, string[]>;
    const inZone = (z: string) => Object.keys(file.stopZone!).filter((id) => file.stopZone![id] === z);
    const a = inZone("11")[0];
    const b = inZone("30").find((id) => !edges[`${a}-${id}`] && !edges[`${id}-${a}`])!;
    expect(b).toBeDefined();
    expect(pass.covers(stop(a), stop(b))).toBe(true);
    expect(zonePass(meta, ["11"], file).covers(stop(a), stop(b))).toBe(false);
  });

  test("stops it doesn't know, or without an id, are not covered", () => {
    const pass = zonePass(meta, ["11", "12"], file);
    expect(pass.covers(stop(LAUSANNE), stop("8507000"))).toBe(false);
    expect(pass.covers({ ...stop(LAUSANNE), station: { ...stop(LAUSANNE).station, id: null } }, stop(RENENS))).toBe(false);
  });

  test("a spot is inside when its nearest stop (within 600 m) is in a zone bought", () => {
    const pass = zonePass(meta, ["11"], file);
    const [lat, lon] = file.coords[LAUSANNE];
    expect(pass.containsSpot(lat + 0.001, lon)).toBe(true);
    // Bern is far from any Mobilis stop.
    expect(pass.containsSpot(46.949, 7.439)).toBe(false);
  });
});

describe("Berner Oberland Pass (area pass)", () => {
  const meta = catalog.areaPasses.find((p) => p.id === "area-t656-2-berner-oberland-pass")!;
  const file = json<PassFile>("area-t656-2-berner-oberland-pass.json");
  const pass = areaPass(meta.name, file);

  test("covers its edges, both ways, and nothing else", () => {
    const [a, b] = (file.edges as string[])[0].split("-");
    expect(pass.covers(stop(a), stop(b))).toBe(true);
    expect(pass.covers(stop(b), stop(a))).toBe(true);
    expect(pass.covers(stop("8501120"), stop("8501118"))).toBe(false);
  });
});

describe("national cards", () => {
  test("GA-style cards count as valid everywhere", () => {
    expect(nationalPasses({ national: ["ga2"], zones: [], areas: [] }).ga).toBe("GA");
    expect(nationalPasses({ national: ["sts"], zones: [], areas: [] }).ga).toBe("Swiss Travel Pass");
    expect(nationalPasses({ national: ["halfFare", "nightGa"], zones: [], areas: [] })).toMatchObject({ ga: null, halfFare: true, nightGa: true });
  });

  test("names for display", () => {
    expect(travelcardNames({ national: ["halfFare"], zones: [{ id: "zone-mobilis-mobilis-abo-abo", zones: ["11", "12"] }], areas: ["area-t656-2-berner-oberland-pass"] }, catalog)).toEqual([
      "Half Fare Travelcard",
      "Mobilis travelcard, zones 11 + 12",
      "Berner Oberland Pass",
    ]);
  });
});
