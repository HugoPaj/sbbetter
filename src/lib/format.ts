const TZ = "Europe/Zurich";

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

/** "Sat 21.11." */
export function formatShortDate(d: Date): string {
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: TZ }).format(d);
  const dm = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", timeZone: TZ }).format(d);
  return `${wd} ${dm}.`.replace("..", ".");
}

/** "Today", "Tomorrow", else "Sat 21.11." (Zurich days). */
export function formatDay(d: Date, nowMs: number = Date.now()): string {
  const day = (x: Date) => zurichDateTime(x).date;
  if (day(d) === day(new Date(nowMs))) return "Today";
  if (day(d) === day(new Date(nowMs + 86_400_000))) return "Tomorrow";
  return formatShortDate(d);
}

/** "Saturday 21.11.2026" */
export function formatLongDate(d: Date): string {
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: TZ }).format(d);
  const dmy = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ }).format(d);
  return `${wd} ${dmy}`;
}

/** "21.11.2026" */
export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ }).format(d);
}

/** API durations look like "00d01:23:00". */
export function parseApiDuration(d: string): number {
  const m = /(\d+)d(\d+):(\d+):(\d+)/.exec(d);
  if (!m) return 0;
  return (+m[1] * 24 + +m[2]) * 60 + +m[3];
}

/** 83 → "1 h 23 min" */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Local date/time strings in Zurich time for API params. */
export function zurichDateTime(d: Date = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Epoch seconds of a Zurich wall-clock date ("2026-11-21") and time ("18:50"). */
export function zurichEpoch(date: string, time: string): number | null {
  const guess = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(guess)) return null;
  const shown = zurichDateTime(new Date(guess));
  const offset = Date.parse(`${shown.date}T${shown.time}:00Z`) - guess;
  return (guess - offset) / 1000;
}

/**
 * End of the SBB service day containing `d`: 05:00 Zurich time the next morning
 * (or the same morning, for a moment before 05:00). Day tickets are valid until then.
 */
export function endOfServiceDay(d: Date): Date {
  const { date, time } = zurichDateTime(d);
  const day = new Date(`${date}T12:00:00Z`);
  if (time >= "05:00") day.setUTCDate(day.getUTCDate() + 1);
  const end = zurichEpoch(day.toISOString().slice(0, 10), "05:00");
  return end == null ? new Date(d.getTime() + 86_400_000) : new Date(end * 1000);
}

export function formatChf(amount: number): string {
  return amount.toFixed(2);
}

/** Great-circle distance in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Walking minutes for a distance in metres (~4.5 km/h, like the SBB app). */
export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round(metres / 75));
}
