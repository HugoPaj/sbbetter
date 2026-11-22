/**
 * OJP responses → opendata shape, against real responses saved in __fixtures__
 * (refresh them with scripts/capture-ojp-fixtures.mjs). When OJP changes its
 * format, these tests say which part the parser no longer understands.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import type { Connection } from "../transport";
import { parseCoord, parseLocationResponse, parseStopEventResponse, parseTripResponse, sloidToUic, zurichIso } from "./ojp";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

beforeAll(() => {
  // Fare refs are signed with a key derived from this.
  process.env.OJP_API_KEY ??= "test-key";
});

/** Invariants every parsed connection must hold, whatever the trip. */
function expectWellFormed(c: Connection) {
  expect(c.sections.length).toBeGreaterThan(0);
  expect(c.from).toBe(c.sections[0].departure);
  expect(c.to).toBe(c.sections.at(-1)!.arrival);
  const rides = c.sections.filter((s) => s.journey);
  expect(rides.length).toBeGreaterThan(0);
  expect(c.transfers).toBe(rides.length - 1);
  expect(c.products).toEqual(rides.map((s) => `${s.journey!.category} ${s.journey!.number}`.trim()));
  // "00d01:09:00" and the timestamps agree.
  const [, d, h, m] = /^(\d\d)d(\d\d):(\d\d):00$/.exec(c.duration)!.map(Number);
  expect((d * 24 + h) * 60 + m).toBe(Math.round(((c.to.arrivalTimestamp ?? 0) - (c.from.departureTimestamp ?? 0)) / 60));
  for (const s of c.sections) {
    if (s.journey) {
      expect(s.journey.passList.length).toBeGreaterThanOrEqual(2);
      expect(s.departure).toBe(s.journey.passList[0]);
      expect(s.arrival).toBe(s.journey.passList.at(-1));
      expect(s.journey.category).toMatch(/\S/);
    } else {
      expect(s.walk?.duration).toBeGreaterThan(0);
    }
    for (const p of [s.departure, s.arrival]) {
      expect(p.station.name).toMatch(/\S/);
      // UIC ids, as transport.opendata.ch uses them.
      if (p.station.id) expect(p.station.id).toMatch(/^85\d{5}$/);
    }
    // Timestamps are the ISO times, in seconds.
    if (s.departure.departure) expect(s.departure.departureTimestamp).toBe(Date.parse(s.departure.departure) / 1000);
    if (s.arrival.arrival) expect(s.arrival.arrivalTimestamp).toBe(Date.parse(s.arrival.arrival) / 1000);
    // In this shape coordinate.x is the latitude.
    const { x, y } = s.departure.station.coordinate;
    if (x !== null && y !== null) {
      expect(x).toBeGreaterThan(45.5);
      expect(x).toBeLessThan(48);
      expect(y).toBeGreaterThan(5.5);
      expect(y).toBeLessThan(11);
    }
  }
  // Rides and walks follow each other in time.
  for (let i = 1; i < c.sections.length; i++) {
    expect(c.sections[i].departure.departureTimestamp!).toBeGreaterThanOrEqual(c.sections[i - 1].arrival.arrivalTimestamp! - 60);
  }
}

describe("trips between stops", () => {
  const connections = parseTripResponse(fixture("trip-lausanne-bern.xml"), "8501120");

  test("every trip is read, earliest first", () => {
    expect(connections).toHaveLength(3);
    const deps = connections.map((c) => c.from.departureTimestamp!);
    expect(deps).toEqual([...deps].sort((a, b) => a - b));
    connections.forEach(expectWellFormed);
  });

  test("a direct train", () => {
    const [ic] = connections;
    expect(ic.from.station).toMatchObject({ id: "8501120", name: "Lausanne" });
    expect(ic.to.station).toMatchObject({ id: "8507000", name: "Bern" });
    expect(ic.products).toEqual(["IC 1"]);
    expect(ic.duration).toBe("00d01:09:00");
    expect(ic.from.platform).toBe("1");
    expect(ic.capacity2nd).toBe(2);
    expect(ic.accessWalk).toBeUndefined();
  });

  test("a change of trains", () => {
    const change = connections.find((c) => c.transfers === 1)!;
    expect(change.products).toEqual(["S 40", "RE 2"]);
    const [s40, re2] = change.sections;
    expect(s40.arrival.station.name).toBe("Romont FR");
    expect(re2.departure.station.name).toBe("Romont FR");
    // Intermediate stops are kept.
    expect(s40.journey!.passList.length).toBeGreaterThan(2);
  });

  test("service alerts are attached to the trips they touch", () => {
    const change = connections.find((c) => c.transfers === 1)!;
    expect(change.disruptions?.map((d) => d.summary)).toEqual(["Limited train service between Palézieux and Romont FR."]);
    const [d] = change.disruptions!;
    expect(Number.isNaN(Date.parse(d.start!))).toBe(false);
    expect(connections[0].disruptions).toEqual([]);
  });

  test("every trip can be priced", () => {
    for (const c of connections) expect(c.fareRef).toMatch(/^[\w-]+\.[\w-]+$/);
  });
});

describe("trips from a coordinate", () => {
  const from = "coord:46.5191,6.5668";
  const connections = parseTripResponse(fixture("trip-from-coordinate.xml"), from);

  test("the walk to the first stop is separate, and the trip starts at the stop", () => {
    expect(connections.length).toBeGreaterThan(0);
    for (const c of connections) {
      expectWellFormed(c);
      expect(c.accessWalk?.minutes).toBeGreaterThan(0);
      expect(c.sections[0].journey).not.toBeNull();
      expect(c.to.station.name).toMatch(/^Lausanne/);
    }
  });

  test("walks between stops are sections, a change within one stop is not", () => {
    const walks = connections.flatMap((c) => c.sections.filter((s) => s.walk));
    expect(walks.length).toBeGreaterThan(0);
    for (const walk of walks) {
      // The fixture has a change between two platforms of one stop (ch:1:sloid:91818): not a walk.
      expect(walk.departure.station.id).not.toBe(walk.arrival.station.id);
      expect(walk.departure.station.name).not.toBe(walk.arrival.station.name);
      expect(walk.arrival.arrivalTimestamp! - walk.departure.departureTimestamp!).toBe(walk.walk!.duration);
    }
  });

  test("the same response from a stop has no access walk", () => {
    const [c] = parseTripResponse(fixture("trip-from-coordinate.xml"), "8501214");
    expect(c.accessWalk).toBeUndefined();
  });
});

describe("departure board", () => {
  const board = parseStopEventResponse(fixture("stop-event-bern.xml"), "8507000");

  test("the station", () => {
    expect(board.station).toMatchObject({ id: "8507000", name: "Bern" });
    expect(board.station.coordinate.x).toBeCloseTo(46.949, 2);
  });

  test("departures with line, destination, time and platform", () => {
    expect(board.stationboard).toHaveLength(5);
    const [first] = board.stationboard;
    expect(first).toMatchObject({ category: "IR", number: "15", to: "Luzern" });
    expect(first.stop.platform).toBe("10");
    for (const e of board.stationboard) {
      expect(e.stop.departureTimestamp).toBe(Date.parse(e.stop.departure!) / 1000);
      expect(e.to).toMatch(/\S/);
    }
  });
});

describe("stop search", () => {
  const locations = parseLocationResponse(fixture("locations-zurich.xml"));

  test("stops first, with UIC ids and coordinates", () => {
    expect(locations[0]).toMatchObject({ id: "8503000", name: "Zürich HB", icon: "train" });
    const firstWithoutIcon = locations.findIndex((l) => !l.icon);
    if (firstWithoutIcon >= 0) expect(locations.slice(firstWithoutIcon).every((l) => !l.icon)).toBe(true);
    for (const l of locations.filter((l) => l.icon)) {
      expect(l.id).toMatch(/^85\d{5}$/);
      expect(l.coordinate.x).toBeGreaterThan(47);
    }
  });
});

test("an empty or broken response is an error, not an empty list", () => {
  expect(() => parseTripResponse("<OJP/>", "8501120")).toThrow(/empty response/);
  expect(() => parseStopEventResponse("not xml at all", "8507000")).toThrow();
});

describe("ids, coordinates, times", () => {
  test("sloids become UIC numbers", () => {
    expect(sloidToUic("ch:1:sloid:7000:4:7")).toBe("8507000");
    expect(sloidToUic("ch:1:sloid:1214")).toBe("8501214");
    expect(sloidToUic("8507000")).toBe("8507000");
    expect(sloidToUic("Bern")).toBeNull();
    expect(sloidToUic(undefined)).toBeNull();
  });

  test("coordinates", () => {
    expect(parseCoord("coord:46.5191,6.5668")).toEqual({ lat: 46.5191, lon: 6.5668 });
    expect(parseCoord(" 46.5, 6.6 ")).toEqual({ lat: 46.5, lon: 6.6 });
    expect(parseCoord("Lausanne")).toBeNull();
  });

  test("Zurich local time has the right offset in winter and summer", () => {
    expect(zurichIso("2026-11-23", "08:15")).toBe("2026-11-23T08:15:00+01:00");
    expect(zurichIso("2026-07-01", "08:15")).toBe("2026-07-01T08:15:00+02:00");
    expect(zurichIso("2026-07-01")).toBe("2026-07-01T00:00:00+02:00");
  });
});
