import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connection, type StopSpec } from "@/test/factories";
import { disruptionEnd } from "./disruption-forecast";
import { closureOf, type LineMemory } from "./line-memory";
import type { Connection } from "./transport";
import { clockAt, decodeRun, encodeRun, hitSections, nextMove, notifySteps, shiftClock, snapshot, withReplay, type Replay } from "./replay";

const replays = (JSON.parse(readFileSync("public/replays.json", "utf8")) as { replays: Replay[] }).replays;
const memory = JSON.parse(readFileSync("public/line-memory.json", "utf8")) as LineMemory;
const byKey = (key: string) => replays.find((r) => r.key === key)!;

/** Real coordinates, so the geometry works like with live data. */
const COORD: Record<string, [number, number]> = {
  "8501008": [46.21021, 6.14245],
  "8501030": [46.38442, 6.23597],
  "8501037": [46.5111, 6.49397],
  "8501117": [46.54759, 6.55183],
  "8501118": [46.53704, 6.57894],
  "8501120": [46.51679, 6.62909],
  "8504100": [46.80315, 7.15105],
  "8504200": [46.78155, 6.64094],
  "8504221": [46.99673, 6.9357],
  "8504300": [47.1329, 7.24291],
  "8507000": [46.94883, 7.43913],
  "8504023": [46.69351, 6.91181],
  "8504014": [46.54276, 6.83788],
};
function withCoords(c: Connection): Connection {
  for (const s of c.sections)
    for (const p of [s.departure, s.arrival, ...(s.journey?.passList ?? [])]) {
      const xy = COORD[p.station.id ?? ""];
      if (xy) p.station.coordinate = { type: "WGS84", x: xy[0], y: xy[1] };
    }
  return c;
}
const trip = (line: string, stops: StopSpec[]) => withCoords(connection([{ line, stops }]));

const LAUSANNE: StopSpec = ["8501120", "Lausanne", "14:00"];
/** An IC that runs through Renens and Morges without stopping. */
const toGeneva = trip("IC 1", [LAUSANNE, ["8501030", "Nyon", "14:25"], ["8501008", "Genève", "14:36"]]);
const toYverdon = trip("RE 1", [LAUSANNE, ["8501117", "Bussigny", "14:08"], ["8504200", "Yverdon-les-Bains", "14:25"]]);
const toBern = trip("IC 1", [LAUSANNE, ["8504023", "Romont FR", "14:32"], ["8504100", "Fribourg/Freiburg", "14:46"], ["8507000", "Bern", "15:06"]]);
/** Stops at Palézieux, inside the closed Puidoux – Vauderens. */
const ir15 = trip("IR 15", [LAUSANNE, ["8504014", "Palézieux", "14:17"], ["8504023", "Romont FR", "14:33"], ["8504100", "Fribourg/Freiburg", "14:48"]]);
const viaBiel = trip("IC 5", [LAUSANNE, ["8504200", "Yverdon-les-Bains", "14:21"], ["8504221", "Neuchâtel", "14:42"], ["8504300", "Biel/Bienne", "15:00"]]);

const at = (r: Replay, minute: number, anchor = Date.parse("2026-11-23T14:00:00+01:00")) => snapshot(r, { key: r.key, step: r.updates.findLastIndex((u) => u.t <= minute), anchor });

describe("replay data", () => {
  it("has the three sources, in time order", () => {
    for (const r of replays) {
      expect(new Set(r.updates.map((u) => u.source))).toEqual(new Set(["timetable", "ticker", "message", "staff"]));
      expect(r.updates.map((u) => u.t)).toEqual([...r.updates.map((u) => u.t)].sort((a, b) => a - b));
      expect(r.states[0].t).toBeLessThanOrEqual(r.outcome.publicAt);
    }
  });

  it("run state round-trips through a setting", () => {
    expect(decodeRun(encodeRun({ key: "renens-morges", step: 4, anchor: 1700000000000 }))).toEqual({ key: "renens-morges", step: 4, anchor: 1700000000000 });
    expect(decodeRun("")).toBeNull();
  });
});

describe("Renens VD – Morges, 17 September 2026", () => {
  const r = byKey("renens-morges");

  it("moves clock times to today", () => {
    const s = at(r, 30);
    // The update at minute 30 happens "now" (14:00); the start was 30 min ago.
    expect(clockAt(s, 30)).toBe("14:00");
    // "until approx. 18:30" (68 min after the 17:22 start) → 14:38.
    expect(shiftClock("The restriction lasts until approx. 18:30.", s)).toBe("The restriction lasts until approx. 14:38.");
  });

  it("hits the IC to Genève running through without stopping, not Lausanne – Yverdon", () => {
    const s = at(r, 30);
    expect(hitSections(toGeneva, s.state!)).toEqual([0]);
    expect(hitSections(toYverdon, s.state!)).toEqual([]);
    expect(hitSections(toBern, s.state!)).toEqual([]);
  });

  it("puts the alert on the connection, with SBB's end moved to today", () => {
    const s = at(r, 30);
    const c = withReplay(toGeneva, s);
    expect(c.disruptions?.[0]).toMatchObject({ summary: "Interrupted service: Renens VD - Morges", causeCode: "EG_011", replay: "renens-morges" });
    expect(Date.parse(c.disruptions![0].end!) - s.start).toBe(68 * 60000);
    expect(withReplay(toGeneva, s)).toBe(c);
    expect(withReplay(toYverdon, s)).toBe(toYverdon);
  });

  it("extends to Lausanne – Yverdon when Bussigny closes too", () => {
    expect(hitSections(toYverdon, at(r, 86).state!)).toEqual([0]);
  });

  it("forecasts the end past SBB's first estimate", () => {
    const s = at(r, 30);
    const d = withReplay(toGeneva, s).disruptions![0];
    const end = disruptionEnd(d, s.start + 30 * 60000)!;
    expect(end.sbb).toBe(s.start + 68 * 60000);
    expect(end.likely).toBeGreaterThan(end.sbb!);
  });

  it("tells the Genève traveller what changes for them, and nothing else", () => {
    const moves = r.updates.map((_, step) => nextMove(snapshot(r, { key: r.key, step, anchor: 0 }), toGeneva)?.headline ?? null);
    const said = moves.filter((m, i) => m !== moves[i - 1]);
    expect(said).toEqual([
      "Your IC 1 can't get through",
      "Line closed. Replacement buses are on the way",
      "Replacement bus Morges – Renens VD",
      "Trains are about to run again",
      "Trains run again, not all of them",
      "Trains are running again",
    ]);
    // Advice for Lausanne – Neuchâtel and Lausanne – Yverdon is not for this traveller.
    expect(moves.some((m) => m?.includes("via"))).toBe(false);
    expect(notifySteps(r, toGeneva).size).toBe(said.length);
  });
});

describe("Puidoux – Vauderens, 25 September 2026", () => {
  const r = byKey("puidoux-vauderens");

  it("hits Lausanne – Bern from the first timetable entry (a closed station)", () => {
    expect(at(r, 4).state!.segments).toHaveLength(1);
    expect(hitSections(toBern, at(r, 4).state!)).toEqual([0]);
    expect(hitSections(viaBiel, at(r, 4).state!)).toEqual([]);
  });

  it("hits a train that stops inside the closed stretch", () => {
    expect(hitSections(ir15, at(r, 28).state!)).toEqual([0]);
  });

  it("finds the remembered stretch, so line memory's detour is there before SBB's", () => {
    const s = at(r, 4);
    const d = withReplay(toBern, s).disruptions![0];
    // Without the route: the most disrupted stretch at Palézieux (the Payerne line).
    expect(closureOf([d], memory, s.start + 4 * 60000)?.stretch).toBe("ecublens rue | palezieux");
    // The journey's own stretch wins (the detail page passes the stretches the route runs over).
    const route = memory.stretches.filter((x) => x.key === "palezieux | puidoux");
    const closure = closureOf([d], memory, s.start + 4 * 60000, route);
    expect(closure?.stretch).toBe("palezieux | puidoux");
    expect(memory.stretches.find((x) => x.key === closure!.stretch)!.detours.map((x) => x.via)).toContain("Biel/Bienne");
  });

  it("passes on SBB's advice for Bern once the ticker has it", () => {
    expect(nextMove(at(r, 20), toBern)?.headline).toBe("Your IC 1 can't get through");
    const m = nextMove(at(r, 28), toBern);
    expect(m).toMatchObject({ tone: "act", headline: "Travel via Biel/Bienne" });
    expect(m!.via?.id).toBe("8504300");
  });
});

describe("Wädenswil – Pfäffikon SZ, 10 September 2026", () => {
  const r = byKey("wadenswil-pfaffikon");
  const zurichChur = connection([
    {
      line: "IC 3",
      stops: [
        ["8503000", "Zürich HB", "14:00"],
        ["8503202", "Thalwil", "14:08"],
        ["8503209", "Pfäffikon SZ", "14:21"],
        ["8509411", "Sargans", "14:54"],
        ["8509000", "Chur", "15:15"],
      ],
    },
  ]);
  for (const [id, xy] of Object.entries({ "8503000": [47.37818, 8.54021], "8503202": [47.29598, 8.56477], "8503209": [47.203, 8.77813], "8509411": [47.04482, 9.44626], "8509000": [46.85308, 9.52894] }))
    for (const p of zurichChur.sections[0].journey!.passList) if (p.station.id === id) p.station.coordinate = { type: "WGS84", x: xy[0], y: xy[1] };

  it("sends Zürich – Chur via St. Gallen, and keeps it once SBB clears its advice with the line still closed", () => {
    expect(nextMove(at(r, 66), zurichChur)?.headline).toBe("Travel via St. Gallen");
    // 10:35: "Some advice withdrawn", all of it, while the line stays closed until 10:53.
    const later = nextMove(at(r, 292), zurichChur)!;
    expect(later).toMatchObject({ tone: "act", headline: "Travel via St. Gallen" });
    expect(later.detail).toContain("taken it off the ticker");
    expect(nextMove(at(r, 311), zurichChur)?.headline).toBe("Trains run again, not all of them");
    // No alert for SBB tidying its ticker.
    const steps = [...notifySteps(r, zurichChur)];
    expect(steps.filter((i) => r.updates[i].t >= 292 && r.updates[i].t < 311)).toEqual([]);
  });
});
