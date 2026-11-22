import { appUrl } from "./app-url";
import type { Section } from "./transport";

/**
 * Best-effort delay estimate for one leg: gradient-boosted trees (LightGBM)
 * trained on SBB actual-times data (Ist-Daten), exported by
 * ../sbb-data/train.py to public/delay-model.json and evaluated here.
 *
 * Inputs are whatever is known now: the train's live delay (OJP prognosis),
 * the station, line, train type and operator, time of day, and the weather
 * forecast at the arrival station.
 */

/** A leaf value, or [feature, threshold, left, right, missing, defaultLeft] (see train.py). */
type Node = number | [number, number, number, number, 0 | 1 | 2, 0 | 1];
type Model = { objective: "binary" | "quantile"; trees: Node[][] };

export type DelayModel = {
  features: string[];
  /**
   * `q80` (80th percentile of the arrival delay) is the one the app shows and the only one shipped:
   * scripts/trim-delay-model.mjs drops the rest of the training export (p3, p6, p10, q50).
   */
  models: { q80: Model } & Partial<Record<"p3" | "p6" | "p10" | "q50", Model>>;
  encodings: Record<"stop" | "line" | "cat" | "op", Record<string, [number, number]>>;
  defaults: { mean: number; p3: number };
  operators: Record<string, string>;
  trainedOn: { samples: number; days: number; from: string; to: string };
};

export type Weather = { rain: number; snow: number; temp: number; gust: number };

export type DelayEstimate = {
  /** Pessimistic (80th percentile) arrival delay, minutes. */
  p80: number;
  /** The live delay the estimate started from, if the train reported one. */
  liveDelay: number | null;
};

function walk(nodes: Node[], x: number[]): number {
  let n = nodes[0];
  while (typeof n !== "number") {
    const [f, threshold, left, right, missing, defaultLeft] = n;
    let v = x[f];
    const isMissing = Number.isNaN(v);
    if (missing === 0 && isMissing) v = 0;
    const toDefault = (missing === 2 && isMissing) || (missing === 1 && (isMissing || v === 0));
    n = nodes[toDefault ? (defaultLeft ? left : right) : v <= threshold ? left : right];
  }
  return n;
}

export function predict(m: Model, x: number[]): number {
  const raw = m.trees.reduce((sum, t) => sum + walk(t, x), 0);
  return m.objective === "binary" ? 1 / (1 + Math.exp(-raw)) : raw;
}

const minutesBetween = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? (Date.parse(a) - Date.parse(b)) / 60000 : NaN;

const ZH = { timeZone: "Europe/Zurich" } as const;
const FOREIGN = new Set(["ICE", "EC", "TGV", "RJX", "RJ", "NJ", "EN"]);

/** Features for the arrival of `section`, as the model expects them. */
export function features(model: DelayModel, section: Section, weather: Weather | null): number[] {
  const j = section.journey!;
  const dep = section.departure;
  const arr = section.arrival;
  const planned = new Date(arr.arrival ?? dep.departure ?? Date.now());
  const hour = Number(new Intl.DateTimeFormat("en-GB", { ...ZH, hour: "numeric", hourCycle: "h23" }).format(planned));
  const minute = planned.getUTCMinutes();
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(new Intl.DateTimeFormat("en-GB", { ...ZH, weekday: "short" }).format(planned));
  const stops = Math.max(1, j.passList.length - 1);
  const enc = (col: keyof DelayModel["encodings"], key: string | undefined) => (key && model.encodings[col][key]) || [model.defaults.mean, model.defaults.p3];
  const [stopMean, stopP3] = enc("stop", arr.station.id ?? undefined);
  const [lineMean, lineP3] = enc("line", `${j.category}${j.number}`);
  const [catMean, catP3] = enc("cat", j.category);
  const [opMean, opP3] = enc("op", model.operators[j.operator]);

  const f: Record<string, number> = {
    delay_now: minutesBetween(dep.prognosis?.departure, dep.departure),
    delay_prev: NaN,
    mins_ahead: minutesBetween(arr.arrival, dep.departure),
    stops_ahead: stops,
    // We only see the part of the run we ride on; treat it as the whole run.
    frac_trip: 1,
    n_stops: stops + 1,
    foreign_origin: FOREIGN.has(j.category) ? 1 : 0,
    border_delay: NaN,
    extra: 0,
    hour: hour + minute / 60,
    weekday,
    holiday: weekday === 6 ? 1 : 0,
    rain: weather?.rain ?? NaN,
    snow: weather?.snow ?? NaN,
    temp: weather?.temp ?? NaN,
    gust: weather?.gust ?? NaN,
    stop_mean: stopMean,
    stop_p3: stopP3,
    line_mean: lineMean,
    line_p3: lineP3,
    cat_mean: catMean,
    cat_p3: catP3,
    op_mean: opMean,
    op_p3: opP3,
  };
  return model.features.map((name) => f[name] ?? NaN);
}

export function estimate(model: DelayModel, section: Section, weather: Weather | null): DelayEstimate {
  const x = features(model, section, weather);
  const live = x[model.features.indexOf("delay_now")];
  return {
    p80: Math.max(0, predict(model.models.q80, x)),
    liveDelay: Number.isNaN(live) ? null : live,
  };
}

let loading: Promise<DelayModel> | null = null;
/** The model is ~1 MB, so it is fetched once, lazily, from /public. */
export function loadDelayModel(): Promise<DelayModel> {
  loading ??= fetch(appUrl("/delay-model.json"))
    .then((r) => {
      if (!r.ok) throw new Error(`delay model: HTTP ${r.status}`);
      return r.json() as Promise<DelayModel>;
    })
    .catch((e) => {
      // Forget the failure (e.g. briefly offline) so the next forecast tries again.
      loading = null;
      throw e;
    });
  return loading;
}

const forecasts = new Map<string, Promise<Record<string, Weather>>>();
/**
 * Hourly weather forecast (Open-Meteo, no key) for the 0.25° cell around a
 * station — the same grid the model was trained on. Null if unavailable.
 */
export async function weatherAt(coordinate: { x: number | null; y: number | null } | undefined, iso: string | null): Promise<Weather | null> {
  if (!coordinate?.x || !coordinate.y || !iso) return null;
  // transport.opendata.ch-style coordinates: x = latitude, y = longitude
  const lat = Math.round(coordinate.x * 4) / 4;
  const lon = Math.round(coordinate.y * 4) / 4;
  const key = `${lat},${lon}`;
  if (!forecasts.has(key)) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,snowfall,temperature_2m,wind_gusts_10m&forecast_days=3&timezone=Europe%2FZurich`;
    forecasts.set(
      key,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`weather: HTTP ${r.status}`);
          return r.json();
        })
        .then(({ hourly: h }) =>
          Object.fromEntries(
            (h.time as string[]).map((t, i) => [t, { rain: h.precipitation[i], snow: h.snowfall[i], temp: h.temperature_2m[i], gust: h.wind_gusts_10m[i] }]),
          ),
        )
        .catch(() => {
          // No weather this time; ask again on the next forecast.
          forecasts.delete(key);
          return {};
        }),
    );
  }
  const hour = new Intl.DateTimeFormat("sv-SE", { ...ZH, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .format(new Date(iso))
    .replace(" ", "T");
  return (await forecasts.get(key)!)[`${hour}:00`] ?? null;
}
