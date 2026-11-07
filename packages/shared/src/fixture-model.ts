/** Fixture-only model helpers. No JSON imports here, so scripts/generate-fixtures.ts can use them before the fixtures exist. */
import type { FareCurve, FarePoint, JourneyOption, RecommendationQuery } from "./schemas";
import { addDays, daysBetween, utcToLondon } from "./time";

/** "Today" in the canned scenario: fixture fares are priced as if bought on this date. */
export const FIXTURE_BOOKING_DATE = "2026-11-07";

/** The hero scenario (contract.md §1.3). */
export const FIXTURE_QUERY: RecommendationQuery = {
  origin: "EUS",
  destination: "MAN",
  dateFrom: "2026-11-20",
  dateTo: "2026-11-22",
  earliest: "06:00",
  latest: "22:00",
  priority: 0.5,
  bookingDate: FIXTURE_BOOKING_DATE,
};

/** Advance fares cost more as travel approaches: multiplier on the on-sale price; null = sold out. */
export function advanceMultiplier(daysBefore: number): number | null {
  if (daysBefore >= 56) return 1;
  if (daysBefore >= 28) return 1.25;
  if (daysBefore >= 14) return 1.6;
  if (daysBefore >= 7) return 2.2;
  if (daysBefore >= 2) return 3;
  return null;
}

/** Plausible curve for a fixture journey: Advance on sale 12 weeks out, rising in steps, walk-up once sold out. */
export function fixtureFareCurve(journey: JourneyOption, bookingDate: string): FareCurve {
  const travelDate = utcToLondon(journey.departAt).date;
  const advance = journey.fares.find((f) => f.ticketType === "advance");
  const pricedAt = advanceMultiplier(daysBetween(FIXTURE_BOOKING_DATE, travelDate));
  const onSalePrice = advance && pricedAt ? advance.pricePence / pricedAt : null;
  const walkUp = journey.fares.filter((f) => f.flexible).sort((a, b) => a.pricePence - b.pricePence)[0] ?? journey.fares[0]!;

  const points: FarePoint[] = [];
  for (let d = 84; d >= 0; d -= d > 28 ? 7 : 1) {
    const multiplier = advanceMultiplier(d);
    const advancePrice = onSalePrice !== null && multiplier !== null ? Math.round(onSalePrice * multiplier) : null;
    const date = addDays(travelDate, -d);
    points.push(
      advancePrice !== null && advancePrice < walkUp.pricePence
        ? { date, daysBefore: d, pricePence: advancePrice, ticketType: "advance" }
        : { date, daysBefore: d, pricePence: walkUp.pricePence, ticketType: walkUp.ticketType },
    );
  }
  return { journeyId: journey.id, bookingDate, points, advanceOnSale: addDays(travelDate, -84) };
}
