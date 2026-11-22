import { describe, expect, test } from "vitest";
import { composeAlert, dueLeg, legQuery, type Facts } from "./commute-alert";
import type { Commute } from "./store";

const commute: Commute = { from: "8504221", fromName: "Neuchâtel", to: "8504300", toName: "Biel/Bienne", outTime: "07:30", backTime: "17:30" };
/** Zurich wall clock, winter (+01:00). 2026-11-23 is a Monday. */
const at = (local: string) => new Date(`${local}:00+01:00`);

describe("dueLeg", () => {
  test("from an hour before the usual departure until it leaves", () => {
    expect(dueLeg(commute, at("2026-11-23T06:29"))).toBeNull();
    expect(dueLeg(commute, at("2026-11-23T06:30"))).toEqual({ back: false, date: "2026-11-23", time: "07:30" });
    expect(dueLeg(commute, at("2026-11-23T07:30"))).toEqual({ back: false, date: "2026-11-23", time: "07:30" });
    expect(dueLeg(commute, at("2026-11-23T07:31"))).toBeNull();
    expect(dueLeg(commute, at("2026-11-23T17:00"))).toEqual({ back: true, date: "2026-11-23", time: "17:30" });
  });

  test("not at weekends", () => {
    expect(dueLeg(commute, at("2026-11-22T07:00"))).toBeNull();
  });

  test("Check now: the next leg whatever the time, also at weekends and tomorrow", () => {
    expect(dueLeg(commute, at("2026-11-22T03:00"), true)).toEqual({ back: false, date: "2026-11-22", time: "07:30" });
    expect(dueLeg(commute, at("2026-11-23T12:00"), true)).toEqual({ back: true, date: "2026-11-23", time: "17:30" });
    expect(dueLeg(commute, at("2026-11-23T21:00"), true)).toEqual({ back: false, date: "2026-11-24", time: "07:30" });
  });

  test("the way back runs from work to home", () => {
    expect(legQuery(commute, { back: true, date: "2026-11-23", time: "17:30" })).toMatchObject({ from: "8504300", toName: "Neuchâtel", time: "17:30" });
  });
});

describe("composeAlert", () => {
  const facts = (f: Partial<Facts> = {}): Facts => ({
    train: { time: "07:32", line: "IC 5", to: "Biel/Bienne" },
    liveDeparture: 0,
    liveArrival: 0,
    missedChange: null,
    forecast: 0,
    closure: null,
    notice: null,
    planBVia: null,
    url: "/connections/detail?key=usual",
    ...f,
  });

  test("on time (only sent by Check now)", () => {
    expect(composeAlert(facts())).toMatchObject({ kind: "ok", title: "07:32 IC 5 to Biel/Bienne runs on time" });
  });

  test("a closed line: the live Plan B, and tapping opens it", () => {
    const a = composeAlert(
      facts({
        closure: { stretch: "Biel/Bienne – Reuchenette-Péry", advisedVia: "Neuchâtel", planB: { via: "Neuchâtel", time: "07:41", line: "RE 2", arrival: "08:43", extraMinutes: 17, url: "/connections/detail?key=planb" } },
        liveDeparture: 12,
      }),
    );
    expect(a).toMatchObject({ kind: "closed", title: "Line closed on your way to Biel/Bienne", url: "/connections/detail?key=planb" });
    expect(a.body).toBe("Biel/Bienne – Reuchenette-Péry is closed. Plan B: RE 2 via Neuchâtel at 07:41, arriving 08:43 (17 min later).");
  });

  test("a closed line without a live Plan B still says where staff send people", () => {
    const a = composeAlert(facts({ closure: { stretch: "Biel/Bienne – Reuchenette-Péry", advisedVia: "Moutier", planB: null } }));
    expect(a.body).toBe("Biel/Bienne – Reuchenette-Péry is closed. Staff usually send travellers via Moutier: check the way round.");
    expect(a.url).toBe("/connections/detail?key=usual");
  });

  test("a broken change comes before a plain delay", () => {
    expect(composeAlert(facts({ missedChange: "Bern", liveArrival: 9 }))).toMatchObject({ kind: "missed", title: "Your change at Bern won’t work" });
  });

  test("live delays from 3 minutes, with the Plan B in case the line closes", () => {
    expect(composeAlert(facts({ liveDeparture: 2 })).kind).toBe("ok");
    const a = composeAlert(facts({ liveDeparture: 6, planBVia: "Neuchâtel" }));
    expect(a).toMatchObject({ kind: "late", title: "07:32 IC 5 to Biel/Bienne: 6 min late" });
    expect(a.body).toBe("Expected to leave 6 min late. Plan B if the line closes: via Neuchâtel.");
  });

  test("the forecast from 5 minutes", () => {
    expect(composeAlert(facts({ forecast: 4 })).kind).toBe("ok");
    expect(composeAlert(facts({ forecast: 7 }))).toMatchObject({ kind: "forecast", body: "Our delay forecast says up to 7 min late at Biel/Bienne." });
  });

  test("the same news is the same signature; a delay growing by 5 minutes is new", () => {
    const s = (m: number) => composeAlert(facts({ liveDeparture: m })).signature;
    expect(s(6)).toBe(s(8));
    expect(s(6)).not.toBe(s(11));
  });
});
