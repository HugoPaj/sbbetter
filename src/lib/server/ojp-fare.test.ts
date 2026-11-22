import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Fare refs carry their trip, signed, so any server instance can price them
 * (see ojp-fare.ts). A fresh import of the module is a fresh instance: nothing
 * in memory.
 */
const freshInstance = async () => {
  vi.resetModules();
  return import("./ojp-fare");
};

const rawTrip = () => readFileSync(new URL("./__fixtures__/trip-lausanne-bern.xml", import.meta.url), "utf8").match(/<Trip>[\s\S]*?<\/Trip>/)![0];

beforeEach(() => {
  vi.stubEnv("OJP_API_KEY", "key-a");
  vi.stubEnv("OJP_FARE_API_KEY", "");
  vi.stubEnv("FARE_REF_SECRET", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("fare refs", () => {
  test("another instance can read a ref", async () => {
    const a = await freshInstance();
    const ref = a.rememberTrip(rawTrip(), new Map());
    const b = await freshInstance();
    const xml = b.tripXml(ref);
    expect(xml).toBe(a.tripXml(ref));
    expect(xml).toMatch(/^<Trip>[\s\S]*<\/Trip>$/);
  });

  test("real-time details are dropped and platforms become their stop", async () => {
    const { rememberTrip, tripXml } = await freshInstance();
    const raw = rawTrip();
    const platform = /<siri:StopPointRef>([^<]+)<\/siri:StopPointRef>/.exec(raw)![1];
    const xml = tripXml(rememberTrip(raw, new Map([[platform, "ch:1:sloid:1120"]])))!;
    expect(xml).not.toContain(`>${platform}<`);
    expect(xml).toContain("<siri:StopPointRef>ch:1:sloid:1120</siri:StopPointRef>");
    expect(xml).not.toMatch(/<EstimatedTime>|<SituationFullRefs>|<siri:ExpectedDepartureOccupancy>/);
  });

  test("a ref with a changed trip or signature is refused", async () => {
    const { rememberTrip } = await freshInstance();
    const ref = rememberTrip(rawTrip(), new Map());
    const [mac, blob] = ref.split(".");
    const { tripXml } = await freshInstance();
    expect(tripXml(`${mac}.${blob.slice(0, -4)}AAAA`)).toBeNull();
    expect(tripXml(`${"A".repeat(mac.length)}.${blob}`)).toBeNull();
    expect(tripXml(blob)).toBeNull();
    expect(tripXml("")).toBeNull();
  });

  test("a ref signed with another key is refused", async () => {
    const { rememberTrip } = await freshInstance();
    const ref = rememberTrip(rawTrip(), new Map());
    vi.stubEnv("OJP_API_KEY", "key-b");
    const { tripXml } = await freshInstance();
    expect(tripXml(ref)).toBeNull();
  });

  test("a stretch of a ref is the trip cut down to it", async () => {
    const { rememberTrip, tripXml } = await freshInstance();
    const ref = rememberTrip(rawTrip(), new Map());
    const whole = tripXml(ref)!;
    const calls = (whole.match(/<Leg(?:Board|Intermediate|Alight)>/g) ?? []).length;
    expect(calls).toBeGreaterThan(2);
    const part = tripXml(`${ref}~0.0-0.1`)!;
    expect(part.match(/<Leg(?:Board|Intermediate|Alight)>/g)).toEqual(["<LegBoard>", "<LegAlight>"]);
    expect(tripXml(`${ref}~0.1-0.1`)).toBeNull();
    expect(tripXml(`${ref}~0.0-0.99`)).toBeNull();
    expect(tripXml(`${ref}~nonsense`)).toBeNull();
  });
});

describe("cutTrip", () => {
  const call = (kind: string, name: string, dep = true, arr = true) =>
    `<${kind}><StopPointName><Text>${name}</Text></StopPointName>${arr ? `<ServiceArrival><TimetabledTime>a-${name}</TimetabledTime></ServiceArrival>` : ""}${dep ? `<ServiceDeparture><TimetabledTime>d-${name}</TimetabledTime></ServiceDeparture>` : ""}</${kind}>`;
  const timed = (stops: string[]) =>
    `<Leg><TimedLeg>${stops.map((s, i) => call(i === 0 ? "LegBoard" : i === stops.length - 1 ? "LegAlight" : "LegIntermediate", s, i < stops.length - 1, i > 0)).join("")}<Service>x</Service></TimedLeg></Leg>`;
  const walk = `<Leg><TransferLeg>walk</TransferLeg></Leg>`;
  const trip = `<Trip><Id>t</Id>${timed(["A", "B", "C"])}${walk}${timed(["D", "E", "F"])}</Trip>`;

  test("across a change of trains, keeping the walk between", async () => {
    const { cutTrip } = await freshInstance();
    const xml = cutTrip(trip, { leg: 0, stop: 1 }, { leg: 1, stop: 1 })!;
    expect(xml.match(/<Text>(\w)<\/Text>/g)!.map((t) => t[6])).toEqual(["B", "C", "D", "E"]);
    expect(xml).toContain("<TransferLeg>");
    // The first stop of a stretch is a boarding (no arrival), the last an alighting (no departure).
    expect(xml).toMatch(/<LegBoard><StopPointName><Text>B<\/Text><\/StopPointName><ServiceDeparture>/);
    expect(xml).toMatch(/<LegAlight><StopPointName><Text>E<\/Text><\/StopPointName><ServiceArrival>[^]*?<\/ServiceArrival><\/LegAlight>/);
    expect(xml.startsWith("<Trip><Id>t</Id>")).toBe(true);
  });

  test("within one ride, without the walk after it", async () => {
    const { cutTrip } = await freshInstance();
    const xml = cutTrip(trip, { leg: 0, stop: 0 }, { leg: 0, stop: 2 })!;
    expect(xml).not.toContain("<TransferLeg>");
    expect(xml).not.toContain("<Text>D</Text>");
  });

  test("a stretch that does not exist", async () => {
    const { cutTrip } = await freshInstance();
    expect(cutTrip(trip, { leg: 0, stop: 2 }, { leg: 0, stop: 1 })).toBeNull();
    expect(cutTrip(trip, { leg: 2, stop: 0 }, { leg: 2, stop: 1 })).toBeNull();
  });
});

describe("NOVA prices", () => {
  type P = { id?: string; name: string; cls: "first" | "second"; price: number };
  const result = (from: number, to: number, products: P[]) =>
    `<TripFareResult><FromTripLegIdRef>${from}</FromTripLegIdRef><ToTripLegIdRef>${to}</ToTripLegIdRef>${products
      .map(
        (p) =>
          `<FareProduct><FareProductId>${p.id ?? "125"}</FareProductId><FareProductName>${p.name}</FareProductName><Price><Amount>${p.price}</Amount></Price><TravelClass>${p.cls}</TravelClass></FareProduct>`,
      )
      .join("")}</TripFareResult>`;
  const delivery = (...results: string[]) => `<OJP><OJPResponse><ServiceDelivery><OJPFareDelivery>${results.join("")}</OJPFareDelivery></ServiceDelivery></OJPResponse></OJP>`;

  const price = async (xml: string, halfFare = false) => {
    const { parseFareDelivery } = await freshInstance();
    const { parseOjp } = await import("./ojp");
    return parseFareDelivery(parseOjp(xml), halfFare);
  };

  test("the cheapest ticket per class, and the regular price next to a Supersaver", async () => {
    const fare = await price(
      delivery(
        result(1, 2, [
          { name: "Billett", cls: "second", price: 44 },
          { id: "11520", name: "Sparbillett", cls: "second", price: 19.8 },
          { name: "Billett", cls: "first", price: 77.6 },
        ]),
      ),
    );
    expect(fare).toEqual({
      second: 19.8,
      first: 77.6,
      secondRegular: 44,
      firstRegular: 77.6,
      secondName: "Supersaver Ticket",
      firstName: "Point-to-point Ticket",
      halfFare: false,
    });
  });

  test("tickets for parts of the trip are added up when there is no through ticket", async () => {
    const fare = await price(delivery(result(1, 1, [{ name: "Billett", cls: "second", price: 3.5 }]), result(2, 3, [{ name: "Billett", cls: "second", price: 12.2 }])), true);
    expect(fare).toMatchObject({ second: 15.7, first: null, secondName: null, halfFare: true });
  });

  test("a discounted day pass is never taken for the ticket", async () => {
    const fare = await price(
      delivery(
        result(1, 2, [
          { id: "2361", name: "Tageskarte", cls: "second", price: 9 },
          { name: "Billett", cls: "second", price: 30 },
        ]),
      ),
    );
    expect(fare?.second).toBe(30);
  });

  test("no products means no price", async () => {
    expect(await price(delivery())).toBeNull();
    expect(await price(delivery(result(1, 2, [{ name: "Billett", cls: "second", price: 0 }])))).toBeNull();
  });
});
