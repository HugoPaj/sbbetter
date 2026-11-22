import { describe, expect, test } from "vitest";
import { connection } from "@/test/factories";
import { connectionKey, queryForConnection, rerouteFromSearchParams, rerouteParams, stitch, uniqueConnections, type Reroute } from "./connection-key";
import type { JourneyQuery } from "./journey-query";

const viaBern = () =>
  connection([
    { line: "IC 1", stops: [["8501120", "Lausanne", "08:00"], ["8507000", "Bern", "09:10"]] },
    { line: "IC 8", stops: [["8507000", "Bern", "09:30"], ["8503000", "Zürich HB", "10:26"]] },
  ]);

describe("connectionKey", () => {
  test("the same trip gives the same key", () => {
    expect(connectionKey(viaBern())).toBe(connectionKey(viaBern()));
  });

  test("the same trains changed at another station are another trip", () => {
    const viaOlten = connection([
      { line: "IC 1", stops: [["8501120", "Lausanne", "08:00"], ["8500218", "Olten", "09:10"]] },
      { line: "IC 8", stops: [["8500218", "Olten", "09:30"], ["8503000", "Zürich HB", "10:26"]] },
    ]);
    expect(connectionKey(viaOlten)).not.toBe(connectionKey(viaBern()));
  });

  test("walks don't count, only the rides", () => {
    const walked = viaBern();
    walked.sections.splice(1, 0, { journey: null, walk: { duration: 120 }, departure: walked.sections[0].arrival, arrival: walked.sections[1].departure });
    expect(connectionKey(walked)).toBe(connectionKey(viaBern()));
  });

  test("duplicates are dropped, the first one kept", () => {
    const a = viaBern();
    const list = uniqueConnections([a, viaBern(), connection([{ line: "IR 15", stops: [["8501120", "Lausanne", "08:20"], ["8507000", "Bern", "09:36"]] }])]);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(a);
  });
});

describe("re-routed trips", () => {
  const r: Reroute = { from: "8507000", date: "2026-11-23", time: "09:40", key: "k", at: 0, late: 12, via: "8500218" };

  test("survive a round trip through the URL", () => {
    expect(rerouteFromSearchParams(new URLSearchParams(rerouteParams(r)))).toEqual(r);
    const plain: Reroute = { ...r, via: undefined };
    expect(rerouteFromSearchParams(new URLSearchParams(rerouteParams(plain)))).toEqual({ ...plain, via: undefined });
  });

  test("need all of from, key, date and time", () => {
    const sp = new URLSearchParams(rerouteParams(r));
    sp.delete("rtime");
    expect(rerouteFromSearchParams(sp)).toBeNull();
  });

  test("keep the planned legs up to the change, then the new ones", () => {
    const planned = viaBern();
    const onward = connection([{ line: "IR 37", stops: [["8507000", "Bern", "09:40"], ["8503000", "Zürich HB", "10:58"]] }], { disruptions: [{ summary: "Late" }] });
    const trip = stitch({ ...planned, fareRef: "x.y", disruptions: [{ summary: "Broken" }] }, onward, 0);
    expect(trip.products).toEqual(["IC 1", "IR 37"]);
    expect(trip.from).toBe(planned.from);
    expect(trip.to).toBe(onward.to);
    expect(trip.transfers).toBe(1);
    // 08:00 → 10:58
    expect(trip.duration).toBe("00d02:58:00");
    expect(trip.disruptions?.map((d) => d.summary)).toEqual(["Broken", "Late"]);
    // The stitched trip was never one OJP trip: it can't be priced as one.
    expect(trip.fareRef).toBeUndefined();
  });
});

test("a re-search starts when the walk from a coordinate starts, Zurich time", () => {
  const q = { from: "coord:46.5,6.6", to: "8507000", date: "2026-11-20", time: "07:00", isArrivalTime: true } as JourneyQuery;
  const c = connection([{ line: "IC 1", stops: [["8501120", "Lausanne", "08:00"], ["8507000", "Bern", "09:10"]] }], { accessWalk: { minutes: 12, metres: 900 } });
  expect(queryForConnection(q, c)).toMatchObject({ date: "2026-11-23", time: "07:48", isArrivalTime: false, to: "8507000" });
});
