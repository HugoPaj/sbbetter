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
  filters from Advanced search, `via`).

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
