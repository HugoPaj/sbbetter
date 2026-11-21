import { passesFromTravelcards } from "./passes";

/**
 * Mock account data for the prototype. Replace with your own demo persona.
 * (Kept generic on purpose: don't commit real personal data.)
 */
export const USER = {
  firstName: "Max",
  lastName: "Muster",
  email: "max.muster@example.ch",
  birthDate: "01.01.2000",
  gender: "M",
  halfFare: true,
  travelcards: ["Half Fare Travelcard", "Night GA Travelcard", "Mobilis Travelcard, zones 11 + 12"],
};

/** What the demo traveller's travelcards entitle them to (see src/lib/passes.ts). */
export const USER_PASSES = passesFromTravelcards(USER.travelcards);

export const fullName = `${USER.firstName} ${USER.lastName}`;

/** Fallback position when geolocation is unavailable: EPFL, Ecublens. */
export const DEFAULT_POSITION = { lat: 46.5191, lon: 6.5668 };

/** Touch-timetable tiles. `id` is any value the API's `from`/`to` accept. */
export const FAVOURITES: { id: string; line1: string; line2: string }[] = [
  { id: "Ecublens VD, EPFL", line1: "Ecublens VD", line2: "EPFL" },
  { id: "Lausanne", line1: "Lausanne", line2: "gare" },
  { id: "Renens VD", line1: "Renens VD", line2: "gare" },
  { id: "Lausanne-Flon", line1: "", line2: "Lausanne-Flon" },
  { id: "Morges", line1: "", line2: "Morges" },
  { id: "Evian-les-Bains", line1: "", line2: "Evian-les-Bains" },
  { id: "Genève", line1: "Genève", line2: "Cornavin" },
  { id: "Genève-Aéroport", line1: "", line2: "Genève-Aéroport" },
  { id: "Bern", line1: "", line2: "Bern" },
  { id: "Zürich HB", line1: "Zürich", line2: "HB" },
];

/** Seed for the "Expired" ticket list. Dates are relative to today. */
export function seedExpiredTickets() {
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const mk = (daysAgo: number, from: string, to: string, hh: number, mm: number) => {
    const start = new Date(now - daysAgo * day);
    start.setHours(hh, mm, 0, 0);
    return {
      id: `seed-${daysAgo}-${hh}${mm}`,
      product: "Mobilis Individual Ticket",
      from,
      to,
      via: "direct",
      validFrom: start.toISOString(),
      validTo: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
      price: 2.3,
      travelClass: 2 as const,
    };
  };
  return [
    mk(1, "Ecublens VD, EPFL", "Chavannes-R., Crochy", 18, 31),
    mk(2, "Ecublens VD, EPFL", "Chavannes-R., Crochy", 15, 31),
    mk(2, "Chavannes-R., Crochy", "Ecublens VD, EPFL", 8, 7),
    mk(4, "Chavannes-R., Crochy", "Ecublens VD, EPFL", 9, 28),
  ];
}
