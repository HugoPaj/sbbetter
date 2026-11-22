import { formatDate, formatTime } from "@/lib/format";
import type { Connection } from "@/lib/transport";
import { toast } from "@/components/ui";
import type { LonLat } from "./trip-map";

/** Sharing a connection and adding it to a calendar (More sheet). */

/** "coord:lat,lon" → [lon, lat] */
export function coordOf(id: string): LonLat | null {
  const m = /^coord:(-?[\d.]+),(-?[\d.]+)$/.exec(id);
  return m ? [Number(m[2]), Number(m[1])] : null;
}

export function icsOf(conn: Connection, title: string, description: string): string {
  const stamp = (ts: number) => new Date(ts * 1000).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const start = conn.from.departureTimestamp ?? 0;
  const end = conn.to.arrivalTimestamp ?? start;
  const esc = (v: string) => v.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//sbb-travelers//prototype//EN",
    "BEGIN:VEVENT",
    `UID:${start}-${end}@sbb-travelers`,
    `DTSTAMP:${stamp(start)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(conn.from.station.name ?? "")}`,
    `DESCRIPTION:${esc(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** One line per ride: "08:00 Lausanne – IC 1 – 09:10 Bern". */
export const legsText = (c: Connection) =>
  c.sections
    .filter((s) => s.journey)
    .map((s) => `${formatTime(s.departure.departure)} ${s.departure.station.name} – ${s.journey!.category} ${s.journey!.number} – ${formatTime(s.arrival.arrival)} ${s.arrival.station.name}`)
    .join("\n");

/** The share sheet, or the clipboard where there is none. */
export async function shareConnection(conn: Connection | null | undefined, title: string) {
  const url = window.location.href;
  const text = conn ? `${title}\n${formatDate(new Date((conn.from.departureTimestamp ?? 0) * 1000))}, ${formatTime(conn.from.departure)} – ${formatTime(conn.to.arrival)}\n${legsText(conn)}` : title;
  try {
    if (navigator.share) await navigator.share({ title, text, url });
    else {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("Connection copied to the clipboard.");
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast("Sharing is not available in this browser.");
  }
}

/** Downloads the connection as a calendar entry (.ics). */
export function downloadCalendarEntry(conn: Connection, title: string) {
  const url = URL.createObjectURL(new Blob([icsOf(conn, title, legsText(conn))], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "connection.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Calendar entry downloaded.");
}
