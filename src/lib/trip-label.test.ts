import { describe, expect, it } from "vitest";
import { lineText, linesOf, startLabel } from "./trip-label";
import { formatDay } from "./format";

describe("trip labels", () => {
  it("drops a category the number already spells", () => {
    expect(linesOf("M m1 → IC 5").map(lineText)).toEqual(["m1", "IC 5"]);
    expect(lineText({ category: "B", number: "701" })).toBe("B 701");
    expect(lineText({ category: "RE", number: "" })).toBe("RE");
  });

  it("shows the boarded stop instead of Current location", () => {
    expect(startLabel("Current location", "Lausanne-Flon")).toBe("Lausanne-Flon");
    expect(startLabel("Current location", undefined)).toBe("Current location");
    expect(startLabel("Bern", "Bern, Bahnhof")).toBe("Bern");
  });

  it("names today and tomorrow", () => {
    const now = Date.parse("2026-11-22T08:00:00Z");
    expect(formatDay(new Date("2026-11-22T08:27:00Z"), now)).toBe("Today");
    expect(formatDay(new Date("2026-11-23T08:27:00Z"), now)).toBe("Tomorrow");
    expect(formatDay(new Date("2026-11-25T08:27:00Z"), now)).toBe("Wed 25.11.");
  });
});
