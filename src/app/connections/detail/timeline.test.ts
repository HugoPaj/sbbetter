/**
 * The connection timeline's model: how legs become stops and segments, when
 * each runs (live progress), and the demo's progress moments.
 */
import { describe, expect, test } from "vitest";
import { checkpoint, connection, zurich } from "@/test/factories";
import type { LegStatus } from "@/lib/disruption";
import { buildItems, moments, platformLabel, schedule, transitionNames, type Leg } from "./timeline";

/** Lausanne → Bern by IC 1, changing to the IC 8 to Zürich. */
const trip = connection([
  { line: "IC 1", stops: [["8501120", "Lausanne", "08:00"], ["8504100", "Fribourg/Freiburg", "08:40"], ["8507000", "Bern", "09:10"]] },
  { line: "IC 8", stops: [["8507000", "Bern", "09:30"], ["8503000", "Zürich HB", "10:26"]] },
]);
const [ic1, ic8] = trip.sections;

const legs = (status?: [LegStatus | undefined, LegStatus | undefined]): Leg[] => [
  { kind: "ride", section: ic1, status: status?.[0] },
  { kind: "change", minutes: 20, t0: ic1.arrival.arrivalTimestamp!, at: ic1.arrival },
  { kind: "ride", section: ic8, status: status?.[1] },
];

const checkpointOf = (id: string, name: string) => checkpoint([id, name, "09:15"]);
const nodes = (ls: Leg[]) => buildItems(ls).flatMap((i) => (i.type === "node" ? [i.node] : []));

describe("buildItems", () => {
  test("stops and segments alternate; a change sits between the arrival and the next departure", () => {
    const items = buildItems(legs());
    expect(items.map((i) => (i.type === "node" ? i.node.name : i.leg.kind))).toEqual(["Lausanne", "ride", "Bern", "change", "Bern", "ride", "Zürich HB"]);
    const [, arrival, departure] = nodes(legs());
    expect(arrival).toMatchObject({ arr: "09:10", arrPl: null });
    expect(arrival.dep).toBeUndefined();
    expect(departure).toMatchObject({ dep: "09:30" });
  });

  test("straight from a walk onto a train, the stop is one node", () => {
    const walk: Leg = { kind: "walk", minutes: 5, t0: zurich("2026-11-23T09:15"), from: checkpointOf("8507000x", "Bern Bahnhof"), to: ic8.departure, onOpen: () => {} };
    const items = buildItems([walk, legs()[2]]);
    expect(items.map((i) => (i.type === "node" ? `${i.node.name}${i.node.dep ? ` ${i.node.dep}` : ""}` : i.leg.kind))).toEqual(["Bern Bahnhof", "walk", "Bern 09:30", "ride", "Zürich HB"]);
  });

  test("a late train shows its new arrival in red, with a pill", () => {
    const bern = nodes(legs([{ kind: "late", minutes: 7 }, undefined]))[1];
    expect(bern).toMatchObject({ arr: "09:10", arrLate: "09:17", delayed: true, pill: "+7 min late" });
    // The planned arrival's live delay isn't shown next to a simulated one.
    expect(bern.arrCp).toBeUndefined();
  });

  test("a missed train: its departure is gone, with a pill", () => {
    const bern = nodes(legs([undefined, { kind: "missed" }]))[2];
    expect(bern).toMatchObject({ name: "Bern", dep: "09:30", depGone: true, pill: "Missed" });
  });

  test("a walk from the user's location starts at a named place, not a stop", () => {
    const walk: Leg = { kind: "walk", minutes: 8, t0: zurich("2026-11-23T07:52"), start: { name: "Your chosen location", time: "07:52" }, onOpen: () => {} };
    const [first, second] = nodes([walk, ...legs()]);
    expect(first).toMatchObject({ key: "origin", name: "Your chosen location", dep: "07:52" });
    expect(second.name).toBe("Lausanne");
  });

  test("a zero-minute walk within one stop is left out", () => {
    const nothing: Leg = { kind: "walk", minutes: 0, from: ic1.arrival, to: ic8.departure, onOpen: () => {} };
    expect(buildItems([legs()[0], nothing, legs()[2]]).filter((i) => i.type === "leg")).toHaveLength(2);
  });
});

describe("schedule (live progress)", () => {
  const spans = (ls: Leg[]) => schedule(buildItems(ls)).filter((s) => s !== null);

  test("each leg runs from its departure to its arrival", () => {
    expect(spans(legs())).toEqual([
      { t0: zurich("2026-11-23T08:00"), t1: zurich("2026-11-23T09:10"), off: false },
      { t0: zurich("2026-11-23T09:10"), t1: zurich("2026-11-23T09:30"), off: false },
      { t0: zurich("2026-11-23T09:30"), t1: zurich("2026-11-23T10:26"), off: false },
    ]);
  });

  test("a delay eats into the change; the next train still leaves on time", () => {
    const [ride, change, next] = spans(legs([{ kind: "late", minutes: 7 }, undefined]));
    expect(ride.t1).toBe(zurich("2026-11-23T09:17"));
    expect(change).toMatchObject({ t0: zurich("2026-11-23T09:17"), t1: zurich("2026-11-23T09:30") });
    expect(next.t0).toBe(zurich("2026-11-23T09:30"));
  });

  test("a leg that no longer works, and everything after it, is never travelled", () => {
    expect(spans(legs([{ kind: "cancelled" }, undefined])).map((s) => s.off)).toEqual([true, true, true]);
    expect(spans(legs([undefined, { kind: "missed" }])).map((s) => s.off)).toEqual([false, false, true]);
  });
});

describe("moments (demo progress)", () => {
  test("before, on each leg, at each stop between, and arrived", () => {
    expect(moments(buildItems(legs())).map((m) => m.label)).toEqual(["Before departure", "On the IC 1", "Changing at Bern", "On the IC 8", "Arrived"]);
    const at = moments(buildItems(legs())).map((m) => m.at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  test("stop at the stop where the trip breaks", () => {
    expect(moments(buildItems(legs([{ kind: "cancelled" }, undefined]))).map((m) => m.label)).toEqual(["Before departure", "At Lausanne"]);
  });
});

test("view-transition names are unique, also for a stop visited twice", () => {
  const roundTrip: Leg[] = [...legs(), { kind: "ride", section: ic1 }];
  const names = transitionNames(buildItems(roundTrip));
  expect(new Set(names).size).toBe(names.length);
  for (const n of names) expect(n).toMatch(/^tl-[\w-]+$/);
});

test("platform labels: bays for buses and trams, none for the metro", () => {
  expect(platformLabel("7", "IC")).toBe("Pl. 7");
  expect(platformLabel("C", "B")).toBe("Stop C");
  expect(platformLabel("1", "M")).toBeNull();
  expect(platformLabel(null, "IC")).toBeNull();
});
