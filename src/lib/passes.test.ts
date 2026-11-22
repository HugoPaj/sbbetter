import { describe, expect, test } from "vitest";
import { connection, zurich } from "@/test/factories";
import { coverageOf, cutConnection, inNightGaWindow, partRef, passCovering, uncovered, type Passes } from "./passes";
import type { LocalPass } from "./travelcards";

const none: Passes = { halfFare: false, ga: null, nightGa: false, local: [] };
const nightGa: Passes = { ...none, nightGa: true };

/** Lausanne → Renens → Morges → Yverdon, one train; a change at Yverdon onto a train to Neuchâtel. */
const trip = (times = ["18:40", "18:55", "19:05", "19:20"], onward = ["19:30", "19:50"]) =>
  connection([
    {
      line: "IR 15",
      stops: [
        ["8501120", "Lausanne", times[0]],
        ["8501118", "Renens VD", times[1]],
        ["8501037", "Morges", times[2]],
        ["8501118x", "Yverdon-les-Bains", times[3]],
      ],
    },
    { walk: [["8501118x", "Yverdon-les-Bains", times[3]], ["8501118x", "Yverdon-les-Bains", onward[0]]] },
    {
      line: "RE 2",
      stops: [
        ["8501118x", "Yverdon-les-Bains", onward[0]],
        ["8504221", "Neuchâtel", onward[1]],
      ],
    },
  ]);

/** A zone pass valid between the given stops (both ways). */
const zone = (name: string, ...edges: [string, string][]): LocalPass => ({
  name,
  covers: (a, b) => edges.some(([x, y]) => (a.station.id === x && b.station.id === y) || (a.station.id === y && b.station.id === x)),
  containsSpot: (lat) => lat > 46.5 && lat < 46.6,
});

const names = (parts: ReturnType<typeof coverageOf>["parts"]) => parts.map((p) => `${p.from.station.name} → ${p.to.station.name}`);

describe("what still needs a ticket", () => {
  test("without travelcards: the whole trip, one ticket across the change", () => {
    const c = coverageOf(trip(), none);
    expect(c.pass).toBeNull();
    expect(names(c.parts)).toEqual(["Lausanne → Neuchâtel"]);
    expect(c.parts[0].a).toEqual({ leg: 0, stop: 0 });
    expect(c.parts[0].b).toEqual({ leg: 1, stop: 1 });
  });

  test("a GA covers everything", () => {
    expect(coverageOf(trip(), { ...none, ga: "GA" })).toEqual({ pass: "GA", several: false, parts: [] });
  });

  test("Night GA: a train leaving before 19:00 needs a ticket to its first stop after 19:00", () => {
    const c = coverageOf(trip(), nightGa);
    expect(c.pass).toBe("Night GA");
    expect(names(c.parts)).toEqual(["Lausanne → Morges"]);
  });

  test("Night GA: valid until 05:00 on weekdays, 07:00 on weekend mornings", () => {
    const morning = (day: string) =>
      connection([
        {
          line: "IR 15",
          stops: [
            ["1", "A", `${day}T04:40`],
            ["2", "B", `${day}T04:55`],
            ["3", "C", `${day}T05:10`],
            ["4", "D", `${day}T06:50`],
            ["5", "E", `${day}T07:10`],
          ],
        },
      ]);
    // Monday: the morning window closes at 05:00.
    expect(names(coverageOf(morning("2026-11-23"), nightGa).parts)).toEqual(["B → E"]);
    // Sunday: at 07:00.
    expect(names(coverageOf(morning("2026-11-22"), nightGa).parts)).toEqual(["D → E"]);
  });

  test("a zone pass leaves only the stretch beyond its zones, from the last stop inside", () => {
    const mobilis = zone("Mobilis travelcard", ["8501120", "8501118"], ["8501118", "8501037"]);
    const c = coverageOf(trip(), { ...none, local: [mobilis] });
    expect(c.pass).toBe("Mobilis travelcard");
    expect(names(c.parts)).toEqual(["Morges → Neuchâtel"]);
    expect(c.parts[0].a).toEqual({ leg: 0, stop: 2 });
  });

  test("a gap between two covered stretches is its own ticket", () => {
    const local = zone("Local pass", ["8501120", "8501118"], ["8501118x", "8504221"]);
    const c = coverageOf(trip(), { ...none, local: [local] });
    expect(names(c.parts)).toEqual(["Renens VD → Yverdon-les-Bains"]);
  });

  test("only the cards actually needed are named", () => {
    // In the evening the Night GA covers all the zone pass does: only the Night GA is named.
    const evening = trip(["19:40", "19:55", "20:05", "20:20"], ["20:30", "20:50"]);
    const mobilis = zone("Mobilis travelcard", ["8501120", "8501118"]);
    expect(coverageOf(evening, { ...nightGa, local: [mobilis] })).toMatchObject({ pass: "Night GA", several: false, parts: [] });
    // Before 19:00 both are needed.
    const c = coverageOf(trip(), { ...nightGa, local: [mobilis] });
    expect(c).toMatchObject({ pass: "Night GA and Mobilis travelcard", several: true });
    expect(names(c.parts)).toEqual(["Renens VD → Morges"]);
  });

  test("the same connection and cards give the same answer object", () => {
    const c = trip();
    expect(coverageOf(c, nightGa)).toBe(coverageOf(c, nightGa));
  });
});

test("a stretch's fare ref names its first and last stop", () => {
  const [part] = coverageOf(trip(), nightGa).parts;
  expect(partRef("abc.def", part)).toBe("abc.def~0.0-0.2");
});

describe("cutConnection", () => {
  test("keeps the stretch and the walk between its rides", () => {
    const cut = cutConnection(trip(), { leg: 0, stop: 2 }, { leg: 1, stop: 1 });
    expect(cut.from.station.name).toBe("Morges");
    expect(cut.to.station.name).toBe("Neuchâtel");
    expect(cut.sections.map((s) => (s.journey ? s.journey.name : "walk"))).toEqual(["IR 15", "walk", "RE 2"]);
    expect(cut.sections[0].journey!.passList.map((p) => p.station.name)).toEqual(["Morges", "Yverdon-les-Bains"]);
    expect(cut.transfers).toBe(1);
    expect(cut.fareRef).toBeUndefined();
  });

  test("within one ride, drops what comes after", () => {
    const cut = cutConnection(trip(), { leg: 0, stop: 0 }, { leg: 0, stop: 1 });
    expect(cut.sections).toHaveLength(1);
    expect(cut.products).toEqual(["IR 15"]);
    expect(cut.transfers).toBe(0);
  });
});

describe("travel without a timetable (EasyRide)", () => {
  const t = (local: string) => zurich(local) * 1000;

  test("the Night GA window in Zurich time, also across the clock change", () => {
    expect(inNightGaWindow(zurich("2026-11-23T19:00"))).toBe(true);
    expect(inNightGaWindow(zurich("2026-11-23T18:59"))).toBe(false);
    expect(inNightGaWindow(zurich("2026-11-24T04:59"))).toBe(true);
    expect(inNightGaWindow(zurich("2026-11-24T05:00"))).toBe(false);
    // Summer time (+02:00): 18:30 local is 16:30 UTC.
    expect(inNightGaWindow(zurich("2026-07-01T18:30:00+02:00"))).toBe(false);
    expect(inNightGaWindow(zurich("2026-07-01T19:30:00+02:00"))).toBe(true);
  });

  test("minutes no card covers", () => {
    expect(uncovered(none, t("2026-11-23T18:50"), t("2026-11-23T19:20"))).toEqual({ minutes: 30, pass: null });
    expect(uncovered(nightGa, t("2026-11-23T18:50"), t("2026-11-23T19:20"))).toEqual({ minutes: 10, pass: "Night GA" });
    expect(uncovered(nightGa, t("2026-11-23T12:00"), t("2026-11-23T12:30"))).toEqual({ minutes: 30, pass: null });
    expect(uncovered({ ...none, ga: "GA" }, t("2026-11-23T12:00"), t("2026-11-23T12:30"))).toEqual({ minutes: 0, pass: "GA" });
  });

  test("a trip that starts and ends inside a zone pass is covered", () => {
    const local = { ...none, local: [zone("Mobilis travelcard")] };
    const inside = { lat: 46.52, lon: 6.6 };
    const outside = { lat: 46.9, lon: 7.4 };
    expect(uncovered(local, t("2026-11-23T12:00"), t("2026-11-23T12:30"), { from: inside, to: inside })).toEqual({ minutes: 0, pass: "Mobilis travelcard" });
    expect(uncovered(local, t("2026-11-23T12:00"), t("2026-11-23T12:30"), { from: inside, to: outside }).minutes).toBe(30);
  });

  test("the card that makes a ticket pointless", () => {
    expect(passCovering(nightGa, t("2026-11-23T20:00"), t("2026-11-23T21:00"))).toBe("Night GA");
    expect(passCovering(nightGa, t("2026-11-23T18:00"), t("2026-11-23T21:00"))).toBeNull();
    expect(passCovering({ ...none, local: [zone("Mobilis travelcard")] }, 0, 1, { lat: 46.52, lon: 6.6 })).toBe("Mobilis travelcard");
  });
});
