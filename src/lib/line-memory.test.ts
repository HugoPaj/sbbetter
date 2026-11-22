/**
 * Line memory against the real history in public/line-memory.json (built by
 * scripts/build-line-memory.py), using Biel/Bienne – Reuchenette-Péry, the
 * README's example: staff sent travellers via Neuchâtel most often.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { connection } from "@/test/factories";
import type { Disruption } from "./transport";
import { advisedDetour, closureOf, countIncidents, normName, overWithin, scriptFor, stretchOf, stretchesOn, type LineMemory, type Stretch } from "./line-memory";

const memory: LineMemory = JSON.parse(readFileSync(new URL("../../public/line-memory.json", import.meta.url), "utf8"));
const BIEL_REUCHENETTE = "biel bienne | reuchenette pery";
const stretch = memory.stretches.find((s) => s.key === BIEL_REUCHENETTE)!;

test("the example stretch is in the data", () => {
  expect(stretch).toBeDefined();
  expect(stretch.ends.map((e) => e.id)).toEqual(["8504300", "8504302"]);
});

test("names fold like the build script's", () => {
  expect(normName("Biel/Bienne")).toBe("biel bienne");
  expect(normName("Reuchenette-Péry")).toBe("reuchenette pery");
  expect(normName("  Zürich   HB ")).toBe("zurich hb");
  expect(normName("Murten/Morat")).toBe("murten morat");
});

describe("which stretches a connection runs over", () => {
  test("a train stopping at both ends", () => {
    const c = connection([
      {
        line: "R 7",
        stops: [
          ["8504300", "Biel/Bienne", "08:00"],
          ["8504301", "Frinvillier-Taubenloch", "08:05"],
          ["8504302", "Reuchenette-Péry", "08:09"],
          ["8500105", "Moutier", "08:25"],
        ],
      },
    ]);
    const hits = stretchesOn(c, memory);
    expect(hits.map((h) => h.stretch.key)).toContain(BIEL_REUCHENETTE);
    expect(hits.find((h) => h.stretch.key === BIEL_REUCHENETTE)!.section).toBe(0);
  });

  test("matched by name when the id differs", () => {
    const c = connection([
      {
        line: "R 7",
        stops: [
          ["x1", "Biel/Bienne", "08:00"],
          ["x2", "Reuchenette-Péry", "08:09"],
        ],
      },
    ]);
    expect(stretchesOn(c, memory).map((h) => h.stretch.key)).toContain(BIEL_REUCHENETTE);
  });

  test("a train running through without stopping: only with the path it travels", () => {
    const fast = (track?: [number, number][]) =>
      connection([
        {
          line: "IC 51",
          stops: [
            ["8504300", "Biel/Bienne", "08:00"],
            ["8500105", "Moutier", "08:15"],
          ],
          track,
        },
      ]);
    // Biel – Reuchenette – north towards Moutier, as [lon, lat], running ~100 m east of both stations.
    const track: [number, number][] = [
      [7.2442, 47.1329],
      [7.246, 47.16],
      [7.2483, 47.18974],
      [7.37, 47.28],
    ];
    expect(stretchesOn(fast(track), memory).map((h) => h.stretch.key)).toContain(BIEL_REUCHENETTE);
    expect(stretchesOn(fast(), memory).map((h) => h.stretch.key)).not.toContain(BIEL_REUCHENETTE);
    // A parallel line 2 km away is another line.
    const elsewhere = track.map(([lon, lat]): [number, number] => [lon + 0.027, lat]);
    expect(stretchesOn(fast(elsewhere), memory).map((h) => h.stretch.key)).not.toContain(BIEL_REUCHENETTE);
  });

  test("not a train that only touches one end", () => {
    const c = connection([
      {
        line: "IC 5",
        stops: [
          ["8504300", "Biel/Bienne", "08:00"],
          ["8504221", "Neuchâtel", "08:15"],
        ],
      },
    ]);
    expect(stretchesOn(c, memory).map((h) => h.stretch.key)).not.toContain(BIEL_REUCHENETTE);
  });

  test("most disrupted first", () => {
    const c = connection([
      {
        line: "RE",
        stops: [
          ["8504132", "Estavayer-le-Lac", "08:00"],
          ["8504134", "Payerne", "08:10"],
          ["8504138", "Grolley", "08:25"],
        ],
      },
    ]);
    const ns = stretchesOn(c, memory).map((h) => h.stretch.n);
    expect(ns.length).toBeGreaterThanOrEqual(2);
    expect(ns).toEqual([...ns].sort((a, b) => b - a));
  });
});

describe("the advised way round", () => {
  test("the detour staff advised most often", () => {
    expect(advisedDetour([stretch])).toMatchObject({ detour: { via: "Neuchâtel" }, stretch: { key: BIEL_REUCHENETTE } });
  });

  test("not via a station the journey starts or ends at anyway", () => {
    expect(advisedDetour([stretch], ["8504221"])?.detour.via).toBe("Moutier");
  });

  test("counted over all stretches", () => {
    const fake = (key: string, detours: [string, number][]): Stretch => ({ ...stretch, key, detours: detours.map(([id, n]) => ({ ...stretch.detours[0], via: id, id, n, staff: false })) });
    const best = advisedDetour([fake("a", [["X", 3], ["Y", 2]]), fake("b", [["Y", 2]])]);
    expect(best).toMatchObject({ detour: { id: "Y" }, n: 4 });
  });

  test("none without advice", () => {
    expect(advisedDetour([{ ...stretch, detours: [] }])).toBeNull();
  });
});

describe("live service messages", () => {
  const now = Date.parse("2026-11-23T08:00:00Z");
  const msg = (summary: string, extra: Partial<Disruption> = {}): Disruption => ({
    summary,
    reason: "Due to a signal box failure.",
    start: new Date(now - 20 * 60_000).toISOString(),
    ...extra,
  });

  test("the stretch a message is about", () => {
    expect(stretchOf(msg("Interrupted service: Biel/Bienne - Reuchenette-Péry"), memory)?.key).toBe(BIEL_REUCHENETTE);
    expect(stretchOf(msg("Interrupted service: Reuchenette-Péry – Biel/Bienne"), memory)?.key).toBe(BIEL_REUCHENETTE);
    expect(stretchOf(msg("Interrupted service: Somewhere - Nowhere"), memory)).toBeNull();
  });

  test("a running interruption becomes a closure, with its cause", () => {
    const end = new Date(now + 40 * 60_000).toISOString();
    expect(closureOf([msg("Interrupted service: Biel/Bienne - Reuchenette-Péry", { end })], memory, now)).toEqual({
      stretch: BIEL_REUCHENETTE,
      cause: "EG_010",
      start: new Date(now - 20 * 60_000).toISOString(),
      end,
    });
  });

  test("an interruption on a stretch we don't remember still counts", () => {
    expect(closureOf([msg("Interrupted service: Somewhere - Nowhere")], memory, now)).toMatchObject({ stretch: null, cause: "EG_010" });
  });

  test("not planned works, old or future messages, or messages that aren't about the line", () => {
    expect(closureOf([msg("Interrupted service: Biel/Bienne - Reuchenette-Péry", { planned: true })], memory, now)).toBeNull();
    expect(closureOf([msg("Interrupted service: Biel/Bienne - Reuchenette-Péry", { start: new Date(now - 13 * 3600e3).toISOString() })], memory, now)).toBeNull();
    expect(closureOf([msg("Interrupted service: Biel/Bienne - Reuchenette-Péry", { start: new Date(now + 60_000).toISOString() })], memory, now)).toBeNull();
    expect(closureOf([msg("Lift out of order at Bern station")], memory, now)).toBeNull();
    expect(closureOf(undefined, memory, now)).toBeNull();
  });

  test("an end years away is no estimate", () => {
    expect(closureOf([msg("Interrupted service: Biel/Bienne - Reuchenette-Péry", { end: "2500-01-01T00:00:00Z" })], memory, now)?.end).toBeUndefined();
  });
});

describe("history", () => {
  const withIncidents = (...xs: [i: number, m: number | null][]): Stretch => ({ ...stretch, incidents: xs.map(([i, m]) => ({ i, d: "2026-01-01", c: "EG_010", m, via: null })) });

  test("a disruption on two stretches (at a junction) counts once", () => {
    expect(countIncidents([withIncidents([1, 30], [2, 60]), withIncidents([2, 60], [3, 90])])).toBe(3);
  });

  test("how long they lasted: two in three over within, from five cases on", () => {
    expect(overWithin([withIncidents([1, 30], [2, 60], [3, 90])])).toEqual({ most: null, low: 30, high: 90 });
    expect(overWithin([withIncidents([1, 10], [2, 20], [3, 30], [4, 40], [5, 50], [6, 600])])).toEqual({ most: 40, low: 10, high: 600 });
    expect(overWithin([withIncidents([1, null])])).toBeNull();
  });
});

describe("what usually happens next", () => {
  test("ends with the line likely open again, after the steps behind us", () => {
    for (const elapsed of [0, 30, 90]) {
      const steps = scriptFor(memory, "EG_010", elapsed);
      const end = steps.at(-1)!;
      expect(end.key).toBe("end");
      expect(end.minutes).toBeGreaterThan(elapsed);
      const upcoming = steps.filter((s) => !s.done && s.key !== "end");
      // Nothing is announced for after the line is likely open again.
      for (const s of upcoming) expect(s.minutes).toBeLessThanOrEqual(end.minutes);
      // Steps behind us come first.
      const firstUpcoming = steps.findIndex((s) => !s.done);
      expect(steps.slice(firstUpcoming).every((s) => !s.done)).toBe(true);
    }
  });
});
