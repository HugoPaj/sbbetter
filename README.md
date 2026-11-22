<img src="assets/icon.svg" width="64" height="64" alt="">

# SBB Travelers

Hackathon prototype: a mobile-first web replica of the SBB Mobile app (Next.js 16 + Tailwind v4), used as a base to build new features on top of.

## Run

```bash
pnpm install      # also copies MapLibre's worker into public/
cp .env.example .env.local   # optional: add your OJP_API_KEY (see below)
pnpm dev          # http://localhost:3000  (use phone width / devtools device mode)
pnpm build && pnpm start
pnpm test         # unit tests (Vitest); pnpm test:watch while working
```

## What's real vs. mocked

| Area | Source |
| --- | --- |
| Stop search, connections, departure boards, map stops | **Live** — official [OJP 2.0](https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp-landing-page/) API when `OJP_API_KEY` is set, otherwise (or on any OJP error) [transport.opendata.ch](https://transport.opendata.ch). See "Timetable data" below |
| Real-time delays, platforms, occupancy, disruptions | **Live** via OJP (delays/occupancy also via opendata) |
| "Current location" routing | Browser geolocation (EPFL fallback). OJP routes from the exact coordinate incl. the walk to the first stop; without OJP it snaps to the nearest stop |
| Map | MapLibre + CARTO dark vector tiles |
| Prices / offers | **Live** NOVA prices (cheapest ticket, e.g. Supersaver, full fare or Half Fare) via the OJP Fare API when `OJP_FARE_API_KEY` is set — `src/lib/server/ojp-fare.ts`, `src/lib/fares.ts`. Otherwise a **mock** estimate by distance — `src/lib/pricing.ts`. Class upgrades and City add-ons are always modelled |
| User, travelcards, favourites | **Mock** — `src/lib/mock-data.ts` |
| Disruption verdict card | **Simulated** disruption (Connection → ⋮ → "Simulate a disruption"), **live** recommended alternative — `src/lib/disruption.ts` |
| Line memory | **Real history** from the SBB hackathon export: every disruption of a stretch since March 2024, the detour staff recommended, the usual order of events — `public/line-memory.json`, `src/lib/line-memory.ts`. The way round is a **live** connection. See "Line memory" below |
| Purchased tickets, saved trips | `localStorage` — `src/lib/store.ts` (Profile → "Reset demo data") |
| Commute alerts | **Real** web push before each commute (Profile → Notifications → Commuter route). Other notification switches are demo only. See "Commute alerts" below |

## Layout

```
src/app/
  plan/                 Timetable search + home (commute, Upcoming, recents, Other tickets sheet) and EasyRide
  connections/          Connection list  (?from&to&date&time… in the URL)
  connections/detail/   Single connection (&key=…): detail-view.tsx wires up timeline.ts (the model),
                        itinerary.tsx, alerts.tsx, reroute.tsx, sheets.tsx and share.ts
  offers/               Offers + mock purchase → adds a ticket
  tickets/              Tickets you show: SwissPass, valid tickets, running EasyRide, past purchases
  profile/              Profile and settings sheets
  api/transport/        Proxy to the timetable API (swap upstream here)
src/components/
  ui.tsx                Header, Segmented, Card, Sheet, Toggle, buttons…
  journey.tsx           ModeBadge, LineLabel, Timeline, ConnectionCard, Capacity
  journey-search-card   From/To/date + Advanced search sheet
  plan/                 Map, location picker, departure board
src/lib/                API client + types, URL journey state, formatting, store
```

Journey state lives in the URL (`src/lib/journey-query.ts`), so every screen is reload-safe and shareable.

## Tests

`pnpm test` runs the unit tests next to the code they cover (`*.test.ts`). They cover the logic that is
easy to get subtly wrong: OJP parsing, fare refs and NOVA price parsing, travelcard coverage (Night GA
hours, zone and area passes from `public/passes/`), connection keys and re-routes, the disruption
forecast, line memory (against the real `public/line-memory.json`), the connection timeline and the
request cache. Test builders for connections are in `src/test/factories.ts`.

The OJP parsing tests read real responses saved in `src/lib/server/__fixtures__/`. When OJP may have
changed its format, capture fresh ones and run the tests:

```bash
node --env-file=.env.local scripts/capture-ojp-fixtures.mjs && pnpm test
```

## Timetable data

The browser only ever talks to `/api/transport/{locations,connections,stationboard}` using
transport.opendata.ch's query parameters and JSON shape (`src/lib/transport.ts`). The route
handler decides the upstream:

- **OJP 2.0** (`src/lib/server/ojp.ts`) when `OJP_API_KEY` is set. It builds the SIRI/XML
  requests (LocationInformation, Trip, StopEvent), parses them and converts them to the opendata
  shape. It also adds `accessWalk` (walk from a `coord:lat,lon` origin) and `disruptions` (OJP
  situations) to connections. Stop ids are converted from `ch:1:sloid:N` to UIC (`8500000 + N`).
- **transport.opendata.ch** as the fallback, and for features not mapped to OJP yet (product
  filters from Advanced search). `via` goes to OJP as a `<Via><ViaPoint>`.

The `X-Data-Source: ojp | opendata` response header shows which one answered. To get a key, sign up at
[api-manager.opentransportdata.swiss](https://api-manager.opentransportdata.swiss), subscribe to
the OJP 2.0 API and put the token in `.env.local`. The free tier allows 50 req/min and 20k/day.
Identical timetable requests share one upstream call, and its answer is reused for a few seconds
(`src/lib/server/upstream-cache.ts`).

### Fares (OJP Fare / NOVA)

Every OJP connection carries a `fareRef` that holds its raw `<Trip>` XML itself, deflated and signed
with a key derived from the API key (or `FARE_REF_SECRET`), so any server instance can price it. The
client sends `POST /api/transport/fares` with `{"refs": […], "hta": true}`. The server swaps platform refs for
their stop place, drops real-time fields and sends an `OJPFareRequest` to
`https://api.opentransportdata.swiss/ojpfare/`. From the result it takes the cheapest product per
class. Gotchas:
- The `Traveller` must contain an `<EntitlementProducts>` element. Leave it empty for full fare, or
  put `HTA` in it for Half Fare. Without it the service returns a 500.
- OJP Fare is a separate API product with its own subscription and key (`OJP_FARE_API_KEY`).
- It is an integration test system that prices only future trips, and only within Switzerland.

Note: in the opendata shape `coordinate.x` is **latitude** and `y` is **longitude**.

## Commute alerts

Profile → Notifications → **Commuter route** subscribes the device to push notifications. In the hour
before each usual departure (weekdays), the server looks at the first train at or after that time and
sends one notification when something is wrong:

- **Line closed** (a live service message on a stretch line memory knows): the Plan B, searched live,
  e.g. "Plan B: RE 2 via Neuchâtel at 07:41, arriving 08:43 (17 min later)". Tapping opens it.
- **Change won't work**, **late** (live data, from 3 min) or **likely late** (delay forecast, from 5 min),
  with where staff sent people the last times the line closed.
- Any other service alert on the way.

Each piece of news is sent once; it is sent again only when it changes (a delay growing by 5 minutes, a
closure). "Check my commute now" sends the next leg's state straight away, "runs on time" included.
Logic: `src/lib/commute-alert.ts` (what to say), `src/lib/server/commute-alerts.ts` (who, when, sending),
`src/app/api/push/` (subscribe, cron, check now), `src/lib/push.ts` (browser), `public/sw.js` (showing it).

Setup: put a VAPID key pair in `.env.local` (see `.env.example`). Then:

- **Self-hosted** (`pnpm build && pnpm start`): the server checks every 5 minutes by itself
  (`src/instrumentation.ts`); subscriptions are kept in `.data/commute-alerts.json`.
- **Serverless (Vercel)**: there is no long-running process and no lasting disk. Add Upstash Redis
  (Vercel KV) and set `UPSTASH_REDIS_REST_URL`/`_TOKEN` (or `KV_REST_API_URL`/`_TOKEN`), set
  `CRON_SECRET`, and call `GET /api/push/check` with `Authorization: Bearer $CRON_SECRET` every
  5 minutes. Vercel Cron does that on Pro; on Hobby it runs at most daily, so use an external
  scheduler (a GitHub Actions schedule, cron-job.org…).

On iPhone, web push only works in the app added to the Home Screen (iOS 16.4+); the switch says so.
Push needs the service worker, which only runs in a production build.

## Buying in the SBB app

**Hackathon demo mode is on by default** (`src/lib/flags.ts`): "Buy" adds a demo ticket with a fake
QR code right away. Set `NEXT_PUBLIC_DEMO_TICKETS=0` and rebuild to use the real flow below.

Tickets are bought in SBB Mobile (deep link from Offers). The SBB app can't call back or report a
purchase, so Offers saves a *pending purchase* (`store.ts`) and `components/purchase-return.tsx` asks
"Did you buy the ticket?" when the traveller comes back. That happens when the page is shown again, or
on a later launch within 24 h. "Yes" adds the ticket (and the trip, if set to be saved), marked
`source: "sbb-app"`. Those tickets show no code here: they link to the SBB app, which holds the real,
signed ticket.

## Offline tickets

The Tickets page opens with no signal (tunnel, abroad without data), even if it was never opened
before: the service worker saves it with its scripts, styles and travelcard data when it installs,
and refreshes that copy while online (`public/sw.js`). The tickets themselves are in `localStorage`.
On a weak signal a saved page is shown after 3.5 s instead of waiting for the network.

## Line memory

Disruptions repeat, and so does the advice: when Biel/Bienne – Reuchenette-Péry broke, staff wrote
"travel via Neuchâtel" four times out of six, on average over an hour in. Line memory gives that
advice at minute zero.

```bash
python3 scripts/build-line-memory.py path/to/Daten   # → public/line-memory.json (~100 KB)
```

The script reads the hackathon export (public live ticker incidents and staff messages, the control
centre's KULT log) and writes, per stretch: every past disruption with cause and duration, the
detours staff recommended ("via …") with a quote and how late the advice came, replacement buses,
and where tickets were also valid. Per cause it writes the usual order of events. Station names are
matched to the official stop list (`scripts/train-stops.json`, from data.sbb.ch).

In the app (`src/components/line-memory.tsx`):

It never gets a row of its own; it sits where it applies:

- **Connection page, normal day**: one muted line under the train it concerns, "If this line closes:
  Plan B via Biel/Bienne". It opens a short sheet: that Plan B searched live for this journey, then three
  or four facts about the stretch (how often, how long, buses, tickets), with the dated history folded away. Only shown when staff advised a way round before; counts and durations stay in the sheet.
- **Connection page, during a disruption** (a live service message, or ⋮ → "Simulate a disruption" →
  "Line closed"): inside the alert. The way round as a real connection sits directly under
  "Likely over around …"; expanding the alert adds what usually happens next, with clock times.
- **Plan → Commuting**: a slim last line of the commute card, "Plan B ready: via Neuchâtel".

A connection is matched to a stretch by its stops, and for trains that run through without stopping
by the path travelled (OJP leg projection). Without OJP only stops count, so fast trains match less.
A detour is only offered when the connection found does not run over the closed stretch after all.
