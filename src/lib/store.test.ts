import { expect, test } from "vitest";
import { sanitize } from "./store";

test("a damaged save falls back field by field instead of crashing", () => {
  const s = sanitize({ tickets: null, trips: [null, 3], settings: null, travelcards: ["Half Fare Travelcard"], recentStops: "x", commute: {}, plates: [1, "VD 123"] });
  expect(Array.isArray(s.tickets)).toBe(true);
  expect(s.trips).toEqual([]);
  expect(s.settings).toEqual({});
  expect(Array.isArray(s.travelcards.national)).toBe(true);
  expect(s.recentStops).toEqual([]);
  expect(s.commute).toBeNull();
  expect(s.plates).toEqual(["VD 123"]);
});

test("tickets with unreadable dates are dropped, good ones kept", () => {
  const good = { id: "a", validFrom: "2026-11-22T10:00:00Z", validTo: "2026-11-23T04:00:00Z" };
  expect(sanitize({ tickets: [good, { id: "b", validFrom: "nope", validTo: "2026-11-23T04:00:00Z" }, null] }).tickets).toEqual([good]);
});

test("not an object at all: a fresh state", () => {
  expect(sanitize([]).trips).toEqual([]);
  expect(sanitize("x").settings).toEqual({});
});
