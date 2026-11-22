/** Which rides a simulated line closure rules out when looking for another way. */
import { expect, test } from "vitest";
import { ride } from "@/test/factories";
import { ridesClosed } from "./disruption";

const m1 = ride({ line: "M m1", stops: [["8591980", "Ecublens VD, EPFL", "18:33"], ["8592080", "Chavannes-R., UNIL-Mouline", "18:35"]] });

test("the closed metro itself, later on", () => {
  expect(ridesClosed(ride({ line: "M m1", stops: [["8591980", "Ecublens VD, EPFL", "18:43"], ["8592080", "Chavannes-R., UNIL-Mouline", "18:45"]] }), m1)).toBe(true);
});

test("a bus between the same stops is a way round", () => {
  expect(ridesClosed(ride({ line: "B 701", stops: [["8591980", "Ecublens VD, EPFL", "18:36"], ["8592080", "Chavannes-R., UNIL-Mouline", "18:40"]] }), m1)).toBe(false);
});

const rail = ride({ line: "IR 15", stops: [["8501120", "Lausanne", "08:00"], ["8504100", "Fribourg/Freiburg", "08:45"], ["8507000", "Bern", "09:06"]] });

test("another train over the closed railway shares its track", () => {
  expect(ridesClosed(ride({ line: "IC 1", stops: [["8501120", "Lausanne", "08:20"], ["8504100", "Fribourg/Freiburg", "09:03"]] }), rail)).toBe(true);
});

test("a train touching only one of its stations keeps off it", () => {
  expect(ridesClosed(ride({ line: "S 2", stops: [["8504100", "Fribourg/Freiburg", "08:50"], ["8504200", "Romont FR", "09:10"]] }), rail)).toBe(false);
});
