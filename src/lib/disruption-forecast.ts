import model from "./disruption-model.json";

/**
 * How long will this disruption last, and will there be replacement buses?
 *
 * Empirical model built by scripts/build-disruption-model.py from the SBB
 * hackathon export: past disruptions per cause (EG_xxx code) and how far the
 * first SBB estimate overran. Forecasts are quantiles of those past cases,
 * conditioned on how long the disruption has been running already.
 */

type CauseModel = {
  label: string;
  n: number;
  /** Past durations, minutes, sorted. */
  minutes: number[] | null;
  /** Past actual / first-announced duration, sorted. */
  overrun: number[] | null;
  busShare: number | null;
  /** Minutes from start until replacement buses were announced, sorted. */
  busMinutes: number[] | null;
};

export type Replay = {
  id: string;
  cause: string;
  causeLabel: string;
  summary: string;
  start: string;
  announcedMinutes: number | null;
  actualMinutes: number;
  lines: string;
  stops: string[];
  replacementBusAfter: number | null;
};

const causes = model.causes as Record<string, CauseModel>;
export const replays = model.replays as Replay[];
export const backtest = model.backtest;

const MIN_LEFT = 5; // fewer past cases still running → widen to a broader sample

const quantile = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const median = (xs: number[]) => quantile(xs, 0.5);
const share = (xs: number[], f: (x: number) => boolean) => xs.filter(f).length / xs.length;

function part<K extends "minutes" | "overrun" | "busMinutes">(cause: string, key: K): NonNullable<CauseModel[K]> {
  return (causes[cause]?.[key] ?? causes.ALL[key]) as NonNullable<CauseModel[K]>;
}

export type Forecast = {
  cause: string;
  causeLabel: string;
  /** Past cases the forecast is based on; `ownCause` false = too few of this cause, used all causes. */
  basedOn: number;
  ownCause: boolean;
  /** Minutes after the start: even odds the line is open again / 80 % sure. */
  likelyMinutes: number;
  safeMinutes: number;
  /** Share of past cases that ran past the first SBB estimate (only with an estimate). */
  overrunShare?: number;
  bus: { share: number; medianMinutes: number } | null;
};

/**
 * @param elapsed  minutes since the disruption started
 * @param announced  SBB's announced duration in minutes, if any
 */
export function forecast(cause: string, elapsed: number, announced?: number | null): Forecast {
  const own = cause === "ALL" ? undefined : causes[cause];
  // With an SBB estimate, scale it by how much such estimates overran in the past.
  const fromEstimate = announced ? part(cause, "overrun").map((r) => r * announced) : [];
  const fromHistory = part(cause, "minutes");
  // Only past cases that were still running at this point say anything about now.
  const candidates = [fromEstimate, fromHistory, causes.ALL.minutes!].map((xs) => xs.filter((m) => m > elapsed).sort((a, b) => a - b));
  const left = candidates.find((xs) => xs.length >= MIN_LEFT) ?? [elapsed + 30];

  const busMinutes = part(cause, "busMinutes");
  const busShare = own?.busShare ?? causes.ALL.busShare;
  return {
    cause,
    causeLabel: own?.label ?? cause,
    basedOn: own?.minutes ? own.n : causes.ALL.n,
    ownCause: !!own?.minutes,
    likelyMinutes: Math.round(median(left)),
    safeMinutes: Math.round(quantile(left, 0.8)),
    overrunShare: announced ? share(part(cause, "overrun"), (r) => (r - 1) * announced > 15) : undefined,
    bus: busShare && busMinutes.length ? { share: busShare, medianMinutes: median(busMinutes) } : null,
  };
}

// Live feeds word causes differently from the model's labels ("defect in the overhead line").
const CAUSE_WORDS: [RegExp, string][] = [
  [/overhead line|contact line/, "EG_008"],
  [/unscheduled construction|urgent work/, "EG_158"],
  [/signal|infrastructure|interlocking/, "EG_010"],
  [/track|rail damage/, "EG_006"],
  [/accident involving a person|person hit/, "EG_047"],
  [/blocking|vehicle fault|engine|technical difficult.*train/, "EG_014"],
  [/level crossing|barrier/, "EG_001"],
  [/obstacle|tree/, "EG_100"],
  [/fire/, "EG_110"],
  [/collision/, "EG_193"],
];

/** EG code for a cause given in words ("accident involving a person"), or "ALL". */
export function causeCode(label: string | null): string {
  const l = label?.toLowerCase() ?? "";
  const exact = Object.keys(causes).find((k) => k !== "ALL" && causes[k].label.toLowerCase() === l);
  const code = exact ?? CAUSE_WORDS.find(([re]) => re.test(l))?.[1];
  return code && causes[code] ? code : "ALL";
}

/**
 * When an unplanned disruption is likely over, as epoch ms: even odds (`likely`)
 * and 80 % sure (`safe`), next to SBB's own estimate (`sbb`). Null for planned
 * works, or when the start is unknown or still ahead.
 */
export function disruptionEnd(
  d: { reason?: string; start?: string; end?: string; planned?: boolean },
  now = Date.now(),
): { likely: number; safe: number; sbb: number | null } | null {
  const start = d.start ? Date.parse(d.start) : NaN;
  if (d.planned || Number.isNaN(start) || start > now) return null;
  const words = /(?:due to|reason:)\s*(?:an? |the )?([^.]+)/i.exec(d.reason ?? "")?.[1] ?? null;
  const end = d.end ? Date.parse(d.end) : NaN;
  // An end weeks away (feeds use the year 2500) means SBB doesn't know.
  const sbb = Number.isFinite(end) && end - start < 7 * 24 * 3600e3 ? end : null;
  const f = forecast(causeCode(words), (now - start) / 60000, sbb ? (sbb - start) / 60000 : null);
  return { likely: start + f.likelyMinutes * 60000, safe: start + f.safeMinutes * 60000, sbb };
}
