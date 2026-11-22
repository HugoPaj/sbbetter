import type { Connection } from "./transport";

/** What a search from the user's position is called (see use-position's Endpoint). */
const HERE = "Current location";

/** The first stop boarded: what "Current location" turned out to be. */
export function boardingStop(c: Connection): string | undefined {
  return c.sections.find((s) => s.journey)?.departure.station.name ?? undefined;
}

/**
 * Where a saved trip or ticket starts, for showing later. "Current location" only means
 * something while searching; afterwards the stop actually boarded does.
 */
export function startLabel(fromName: string, stop: string | undefined): string {
  return fromName === HERE && stop ? stop : fromName;
}

export type LineRef = { category: string; number: string };

/** A saved trip's summary ("M m1 → IC 5") back as its lines. */
export function linesOf(summary: string): LineRef[] {
  return summary
    .split(" → ")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(" ");
      return i < 0 ? { category: s, number: "" } : { category: s.slice(0, i), number: s.slice(i + 1) };
    });
}

/** "IC 5", "S 3", but "m1" for the metro and "B 701" → "701" never: only drop a category the number already spells ("M m1"). */
export function lineText({ category, number }: LineRef): string {
  if (!number) return category;
  if (number.toLowerCase().startsWith(category.toLowerCase())) return number;
  return `${category} ${number}`;
}
