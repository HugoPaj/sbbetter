/**
 * Properties the disruption forecast must keep whatever the model data
 * (src/lib/disruption-model.json, rebuilt by scripts/build-disruption-model.py).
 */
import { describe, expect, test } from "vitest";
import { causeCode, disruptionEnd, forecast } from "./disruption-forecast";

describe("causeCode", () => {
  test("the model's own labels, any case", () => {
    expect(causeCode("Signal box failure")).toBe("EG_010");
    expect(causeCode("accident involving a person")).toBe("EG_047");
  });

  test("the live feeds' wording", () => {
    expect(causeCode("a defect in the overhead line")).toBe("EG_008");
    expect(causeCode("urgent work on the line")).toBe("EG_158");
    expect(causeCode("damage to a level crossing barrier")).toBe("EG_001");
    expect(causeCode("a fallen tree")).toBe("EG_100");
  });

  test("anything else is all causes", () => {
    expect(causeCode("a cat on the roof")).toBe("ALL");
    expect(causeCode(null)).toBe("ALL");
    expect(causeCode("")).toBe("ALL");
  });

  test("a cause the model has too few cases of falls back to all causes", () => {
    // EG_046 is in the model, but without durations of its own.
    expect(causeCode("Persons reported near the tracks")).toBe("EG_046");
    expect(forecast("EG_046", 0).ownCause).toBe(false);
  });
});

describe("forecast", () => {
  const causes = ["ALL", "EG_008", "EG_010", "EG_047", "EG_014"];

  test("the line opens after now, and the 80 % time is no earlier than even odds", () => {
    for (const cause of causes) {
      for (const elapsed of [0, 10, 45, 120, 600]) {
        const f = forecast(cause, elapsed);
        expect(f.likelyMinutes).toBeGreaterThan(elapsed);
        expect(f.safeMinutes).toBeGreaterThanOrEqual(f.likelyMinutes);
      }
    }
  });

  test("the longer it has been running, the later it is likely over", () => {
    for (const cause of causes) {
      const ends = [0, 30, 60, 120, 240].map((m) => forecast(cause, m).likelyMinutes);
      expect(ends).toEqual([...ends].sort((a, b) => a - b));
    }
  });

  test("past every known case, it still answers", () => {
    const f = forecast("EG_010", 100_000);
    expect(f.likelyMinutes).toBeGreaterThan(100_000);
  });

  test("with SBB's estimate, it says how often such estimates ran over", () => {
    const f = forecast("EG_010", 0, 60);
    expect(f.overrunShare).toBeGreaterThanOrEqual(0);
    expect(f.overrunShare).toBeLessThanOrEqual(1);
    expect(forecast("EG_010", 0).overrunShare).toBeUndefined();
  });

  test("own cause or all causes", () => {
    expect(forecast("EG_010", 0)).toMatchObject({ ownCause: true, causeLabel: "Signal box failure" });
    expect(forecast("EG_999", 0)).toMatchObject({ ownCause: false });
  });
});

describe("disruptionEnd", () => {
  const now = Date.parse("2026-11-23T08:00:00Z");
  const started = (min: number) => new Date(now - min * 60_000).toISOString();

  test("an unplanned disruption under way: likely and safe ends after now", () => {
    const end = disruptionEnd({ reason: "Due to a signal box failure.", start: started(20) }, now)!;
    expect(end.likely).toBeGreaterThan(now);
    expect(end.safe).toBeGreaterThanOrEqual(end.likely);
    expect(end.sbb).toBeNull();
  });

  test("uses SBB's end when it is a real estimate, not a placeholder years away", () => {
    const sbb = new Date(now + 40 * 60_000).toISOString();
    expect(disruptionEnd({ start: started(20), end: sbb }, now)!.sbb).toBe(Date.parse(sbb));
    expect(disruptionEnd({ start: started(20), end: "2500-12-31T23:59:00Z" }, now)!.sbb).toBeNull();
  });

  test("trains running again (limited service): SBB's time only, no forecast of our own", () => {
    const sbb = new Date(now + 40 * 60_000).toISOString();
    expect(disruptionEnd({ start: started(200), end: sbb, limited: true }, now)).toEqual({ likely: Date.parse(sbb), safe: Date.parse(sbb), sbb: Date.parse(sbb) });
    expect(disruptionEnd({ start: started(200), limited: true }, now)).toBeNull();
  });

  test("nothing for planned works, a start still ahead, or no start", () => {
    expect(disruptionEnd({ start: started(20), planned: true }, now)).toBeNull();
    expect(disruptionEnd({ start: started(-30) }, now)).toBeNull();
    expect(disruptionEnd({}, now)).toBeNull();
    expect(disruptionEnd({ start: "not a date" }, now)).toBeNull();
  });
});
