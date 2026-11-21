<img src="assets/icon.svg" width="64" height="64" alt="">

# SBB Travelers

Hackathon prototype: a mobile-first web replica of the SBB Mobile app (Next.js 16 + Tailwind v4), used as a base to build new features on top of.

## Run

```bash
pnpm install      # also copies MapLibre's worker into public/
cp .env.example .env.local   # optional: add your OJP_API_KEY (see below)
pnpm dev          # http://localhost:3000  (use phone width / devtools device mode)
pnpm build && pnpm start
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

## Layout

```
src/app/
  plan/                 Timetable (map + search) and Touch timetable
  connections/          Connection list  (?from&to&date&time… in the URL)
  connections/detail/   Single connection (&key=…)
  offers/               Offers + mock purchase → adds a ticket
  trips/ easyride/ tickets/ shop/ profile/
  api/transport/        Proxy to the timetable API (swap upstream here)
src/components/
  ui.tsx                Header, Segmented, Card, Sheet, Toggle, buttons…
  journey.tsx           ModeBadge, LineLabel, Timeline, ConnectionCard, Capacity
  journey-search-card   From/To/date + Advanced search sheet
  plan/                 Map, location picker, departure board, touch timetable
src/lib/                API client + types, URL journey state, formatting, store
```

Journey state lives in the URL (`src/lib/journey-query.ts`), so every screen is reload-safe and shareable.

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

### Fares (OJP Fare / NOVA)

Every OJP connection carries a `fareRef` that points to its raw `<Trip>` XML, held in server memory for
30 minutes. The client calls `/api/transport/fares?refs=…&hta=1`. The server swaps platform refs for
their stop place, drops real-time fields and sends an `OJPFareRequest` to
`https://api.opentransportdata.swiss/ojpfare/`. From the result it takes the cheapest product per
class. Gotchas:
- The `Traveller` must contain an `<EntitlementProducts>` element. Leave it empty for full fare, or
  put `HTA` in it for Half Fare. Without it the service returns a 500.
- OJP Fare is a separate API product with its own subscription and key (`OJP_FARE_API_KEY`).
- It is an integration test system that prices only future trips, and only within Switzerland.

Note: in the opendata shape `coordinate.x` is **latitude** and `y` is **longitude**.

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
