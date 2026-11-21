import { zurichDateTime } from "./format";
import type { Checkpoint, Connection } from "./transport";

/**
 * Deep link into sbb.ch (SBB "Deep Linking" guide): opens this connection,
 * ready to buy, in the SBB Mobile app when it is installed (sbb.ch links open
 * the app) or in the sbb.ch webshop otherwise.
 *
 * The search starts at the first train's departure, so SBB's first result is
 * this connection and `selected_trip=0` opens it directly. All values are
 * quoted JSON and URL-encoded, as the guide requires.
 */
export function sbbDeepLink(conn: Connection, lang: "de" | "fr" | "it" | "en" = "en"): string {
  const rides = conn.sections.filter((s) => s.journey);
  const from = rides[0]?.departure ?? conn.from;
  const to = rides.at(-1)?.arrival ?? conn.to;
  const stop = (c: Checkpoint) => ({ value: c.station.id ?? "", type: "ID", label: c.station.name ?? "" });
  const { date, time } = zurichDateTime(new Date((from.departureTimestamp ?? Date.now() / 1000) * 1000));
  const params: Record<string, string> = {
    stops: JSON.stringify([stop(from), stop(to)]),
    date: JSON.stringify(date),
    time: JSON.stringify(time),
    moment: JSON.stringify("DEPARTURE"),
    selected_trip: "0",
  };
  return `https://www.sbb.ch/${lang}?${Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;
}
