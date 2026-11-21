import { zurichDateTime } from "./format";
import type { Checkpoint, Connection, Section } from "./transport";

/**
 * Hand a connection over to SBB to buy the ticket: the SBB Mobile app when it is
 * installed, sbb.ch otherwise.
 *
 * Why not just an sbb.ch link: www.sbb.ch is not registered as an app link of SBB
 * Mobile (no apple-app-site-association / assetlinks.json), and links opened
 * from an installed web app stay in its in-app browser anyway. The app has its
 * own scheme instead, `sbbmobile://` (also reachable as https://app.sbbmobile.ch/…,
 * which is how its web fallback page maps them).
 *
 * The app's timetable link (parameters read by SBB Mobile's deep-link handler):
 *   sbbmobile://timetable?from=<place>&to=<place>&time=<epoch seconds>&timemode=departure
 * It opens the connection list for that search; starting at our first train's
 * departure puts this connection on top.
 *
 * Better: the ticket offer of this exact connection,
 *   sbbmobile://tripoffer?recon=<reconstruction context>&date=…&class=1|2&travel=oneway|return
 * The app reads only `date`, `class` and `travel` there (no Supersaver, travellers…).
 * We build the reconstruction context ourselves (see `recon`), checked on a phone.
 */

const ANDROID_PACKAGE = "ch.sbb.mobile.android.b2c";

function endpoints(conn: Connection) {
  const rides = conn.sections.filter((s) => s.journey);
  return { from: rides[0]?.departure ?? conn.from, to: rides.at(-1)?.arrival ?? conn.to };
}

/** sbb.ch, in the URL format sbb.ch itself uses today (checked Nov 2026); `trip=0_0` opens this connection. */
export function sbbWebLink(conn: Connection, lang: "de" | "fr" | "it" | "en" = "en"): string {
  const { from, to } = endpoints(conn);
  // "Zürich HB" → "Z%C3%BCrich+HB"; "_" and "~" separate fields, so keep them out of names.
  const stop = (c: Checkpoint) => `${encodeURIComponent((c.station.name ?? "").replace(/[_~]/g, " ")).replace(/%20/g, "+")}_I${c.station.id ?? ""}`;
  const { date, time } = zurichDateTime(new Date((from.departureTimestamp ?? Date.now() / 1000) * 1000));
  return `https://www.sbb.ch/${lang}?stops=${stop(from)}~${stop(to)}&day=${date}&time=${time.replace(":", "_")}&moment=dep&trip=0_0`;
}

// --- Reconstruction context ("recon") ----------------------------------------
// Format, read from a share link of SBB Mobile: "3HA.<trip>.<search>", each part
// zlib + base64url. <trip> is a protobuf whose field 1.2 holds the classic HAFAS
// route text ("¶HKI¶T$A=1@O=…@L=<stop id>@a=128@$…$<dep>$<arr>$<train>$$1$$$$$$§…");
// the app accepts it without SBB's checksum blocks and per-stop details.
// <search> is the timetable query as JSON.

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Protobuf length-delimited field. */
function field(tag: number, payload: Uint8Array): Uint8Array {
  const len: number[] = [];
  for (let n = payload.length; ; n >>>= 7) {
    if (n < 0x80) {
      len.push(n);
      break;
    }
    len.push((n & 0x7f) | 0x80);
  }
  return Uint8Array.from([(tag << 3) | 2, ...len, ...payload]);
}

/** zlib stream with stored (uncompressed) blocks: valid for any inflater, synchronous, no dependency. */
function zlib(data: Uint8Array): Uint8Array {
  const out = [0x78, 0x01];
  for (let i = 0; i === 0 || i < data.length; i += 0xffff) {
    const block = data.subarray(i, i + 0xffff);
    const last = i + 0xffff >= data.length ? 1 : 0;
    out.push(last, block.length & 0xff, block.length >> 8, ~block.length & 0xff, (~block.length >> 8) & 0xff, ...block);
  }
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  out.push(b >> 8, b & 0xff, a >> 8, a & 0xff);
  return Uint8Array.from(out);
}

const base64url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (c) => String.fromCharCode(c)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** "202611211832" in Zurich time. */
function hafasTime(iso: string | null): string {
  const { date, time } = zurichDateTime(new Date(iso ?? Date.now()));
  return date.replaceAll("-", "") + time.replace(":", "");
}

function hafasStop(c: Checkpoint): string {
  const { x: lat, y: lon } = c.station.coordinate ?? {};
  const xy = lat && lon ? `@X=${Math.round(lon * 1e6)}@Y=${Math.round(lat * 1e6)}` : "";
  return `A=1@O=${(c.station.name ?? "").replace(/[@$§¶]/g, " ")}${xy}@L=${c.station.id}@a=128@`;
}

/** "IC 5 535" (category, line, train number); urban lines without a number ("M m1"). */
function hafasTrain(s: Section): string {
  const j = s.journey!;
  const train = /^ch:1:sjyid:\d+:(\d+)-\d+$/.exec(j.name)?.[1];
  return [j.category, j.number, train].filter(Boolean).join(" ");
}

/** SBB Mobile's reconstruction context for this connection, or null if it can't be described. */
export function recon(conn: Connection): string | null {
  const first = conn.sections.findIndex((s) => s.journey);
  const last = conn.sections.findLastIndex((s) => s.journey);
  if (first < 0) return null;
  const legs = conn.sections.slice(first, last + 1);
  if (legs.some((s) => !s.departure.station.id || !s.arrival.station.id)) return null;
  const route = legs
    .map((s, i) => {
      // Walks between trains carry no times of their own: they run from the last arrival to the next departure.
      const dep = s.journey ? s.departure.departure : (legs[i - 1]?.arrival.arrival ?? s.departure.departure);
      const arr = s.journey ? s.arrival.arrival : (legs[i + 1]?.departure.departure ?? s.arrival.arrival);
      return `${s.journey ? "T" : "W"}$${hafasStop(s.departure)}$${hafasStop(s.arrival)}$${hafasTime(dep)}$${hafasTime(arr)}$${s.journey ? hafasTrain(s) : ""}$$1$$$$$$`;
    })
    .join("§");
  const from = legs[0].departure;
  const { date, time } = zurichDateTime(new Date((from.departureTimestamp ?? Date.now() / 1000) * 1000));
  const search = {
    vias: [],
    viasNot: [],
    viasNoTransfer: [],
    excludeDatedVehicleJourneys: [],
    O: from.station.id,
    D: legs.at(-1)!.arrival.station.id,
    d: date,
    t: time,
    a: "N",
    l: "A",
    n: null,
    m: [],
  };
  const trip = field(1, field(2, utf8(`¶HKI¶${route}`)));
  return `3HA.${base64url(zlib(trip))}.${base64url(zlib(utf8(JSON.stringify(search))))}`;
}

/** The SBB Mobile link path for this connection, without the scheme: its ticket offer, else the timetable search. */
function appPath(conn: Connection, ticket: { travelClass: 1 | 2; returnTrip: boolean }): string {
  const { from, to } = endpoints(conn);
  const r = recon(conn);
  if (r) {
    const { date } = zurichDateTime(new Date((from.departureTimestamp ?? Date.now() / 1000) * 1000));
    return `tripoffer?${new URLSearchParams({ recon: r, date, class: String(ticket.travelClass), travel: ticket.returnTrip ? "return" : "oneway" })}`;
  }
  const params = new URLSearchParams({
    from: from.station.name ?? "",
    to: to.station.name ?? "",
    time: String(from.departureTimestamp ?? Math.round(Date.now() / 1000)),
    timemode: "departure",
  });
  return `timetable?${params}`;
}

/**
 * Opens the connection in SBB Mobile, falling back to sbb.ch. Call from a click handler.
 * Android: an intent with the web link as fallback. iOS: the app scheme, then sbb.ch
 * if the page is still showing (no app installed). Elsewhere: sbb.ch in a new tab.
 */
export function openInSbb(conn: Connection, ticket: { travelClass: 1 | 2; returnTrip: boolean }): void {
  const web = sbbWebLink(conn);
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    window.location.href = `intent://${appPath(conn, ticket)}#Intent;scheme=sbbmobile;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(web)};end`;
  } else if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    const fallback = setTimeout(() => {
      if (document.visibilityState === "visible") window.location.href = web;
    }, 1500);
    document.addEventListener("visibilitychange", () => clearTimeout(fallback), { once: true });
    window.location.href = `sbbmobile://${appPath(conn, ticket)}`;
  } else {
    window.open(web, "_blank", "noopener");
  }
}
