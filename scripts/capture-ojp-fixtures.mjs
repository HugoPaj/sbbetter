#!/usr/bin/env node
/**
 * Saves real OJP 2.0 responses as test fixtures (src/lib/server/__fixtures__/),
 * for the parsing tests in src/lib/server/ojp.test.ts. Re-run it when OJP may
 * have changed its format, then run `pnpm test`: a failing test points at what
 * the parser no longer understands.
 *
 *   node --env-file=.env.local scripts/capture-ojp-fixtures.mjs
 *
 * The requests mirror the ones in src/lib/server/ojp.ts. Times are tomorrow
 * morning, so the trips are in the timetable; the tests do not depend on dates.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const key = process.env.OJP_API_KEY;
if (!key) {
  console.error("OJP_API_KEY is not set (try: node --env-file=.env.local scripts/capture-ojp-fixtures.mjs)");
  process.exit(1);
}
const out = (name) => fileURLToPath(new URL(`../src/lib/server/__fixtures__/${name}`, import.meta.url));

const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const at = `${tomorrow}T08:00:00+01:00`;
const LAUSANNE = "8501120";
const BERN = "8507000";
const stop = (id) => `<PlaceRef><StopPlaceRef>${id}</StopPlaceRef><Name><Text>${id}</Text></Name></PlaceRef>`;
// EPFL: a trip from a coordinate starts with a walk.
const here = `<PlaceRef><GeoPosition><siri:Longitude>6.5668</siri:Longitude><siri:Latitude>46.5191</siri:Latitude></GeoPosition><Name><Text>Current location</Text></Name></PlaceRef>`;

const trip = (origin, destination, n) => `<OJPTripRequest>
  <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
  <Origin>${origin}<DepArrTime>${at}</DepArrTime></Origin>
  <Destination>${destination}</Destination>
  <Params>
    <NumberOfResults>${n}</NumberOfResults>
    <IncludeIntermediateStops>true</IncludeIntermediateStops>
    <IncludeAllRestrictedLines>true</IncludeAllRestrictedLines>
    <UseRealtimeData>explanatory</UseRealtimeData>
  </Params>
</OJPTripRequest>`;

const requests = {
  "trip-lausanne-bern.xml": trip(stop(LAUSANNE), stop(BERN), 3),
  "trip-from-coordinate.xml": trip(here, stop(LAUSANNE), 2),
  "stop-event-bern.xml": `<OJPStopEventRequest>
  <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
  <Location>${stop(BERN)}<DepArrTime>${at}</DepArrTime></Location>
  <Params><NumberOfResults>5</NumberOfResults><StopEventType>departure</StopEventType><IncludeRealtimeData>true</IncludeRealtimeData></Params>
</OJPStopEventRequest>`,
  "locations-zurich.xml": `<OJPLocationInformationRequest>
  <siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>
  <InitialInput><Name>Zürich</Name></InitialInput>
  <Restrictions><Type>stop</Type><Type>address</Type><Type>poi</Type><NumberOfResults>6</NumberOfResults></Restrictions>
</OJPLocationInformationRequest>`,
};

for (const [name, body] of Object.entries(requests)) {
  const now = new Date().toISOString();
  const res = await fetch("https://api.opentransportdata.swiss/ojp20", {
    method: "POST",
    headers: { "Content-Type": "application/xml", Authorization: `Bearer ${key}`, "User-Agent": "sbb-travelers-hackathon" },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest><siri:ServiceRequest>
    <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
    <siri:ServiceRequestContext><siri:Language>en</siri:Language></siri:ServiceRequestContext>
    <siri:RequestorRef>sbb-travelers-hackathon_prod</siri:RequestorRef>
    ${body.replaceAll("__NOW__", now)}
  </siri:ServiceRequest></OJPRequest>
</OJP>`,
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  // Network-wide alerts list thousands of affected train runs (megabytes) that the parser never
  // reads: keep a few, so the fixture stays realistic but small.
  let kept = 0;
  const xml = (await res.text()).replace(/<siri:AffectedVehicleJourney>[\s\S]*?<\/siri:AffectedVehicleJourney>/g, (m) => (kept++ < 3 ? m : ""));
  writeFileSync(out(name), xml);
  console.log(`${name}: ${(xml.length / 1024).toFixed(0)} KB`);
}
