import { estimate, loadDelayModel, weatherAt } from "./delay-model";
import type { Connection, Section } from "./transport";

/**
 * The delay we show for a ride, in whole minutes: the delay model's 80th
 * percentile, so "~+3′" reads "likely no more than 3 min late". Typical trains
 * land on 0–1 min; only the risky ones reach 3 and more.
 */
export async function forecastDelay(section: Section): Promise<number> {
  const model = await loadDelayModel();
  const e = estimate(model, section, await weatherAt(section.arrival.station.coordinate, section.arrival.arrival));
  return Math.max(0, Math.round(e.p80));
}

/** Forecast for every ride of a connection, keyed by index into `connection.sections`. */
export async function forecastConnection(conn: Connection): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  await Promise.all(conn.sections.map(async (s, i) => s.journey && (out[i] = await forecastDelay(s))));
  return out;
}
