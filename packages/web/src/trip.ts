import type { RecommendationResponse, ScoredOption } from "@tot/shared";
import { priceWithRailcard, type PricedFare, type Railcard } from "./railcards";

export interface Row {
  option: ScoredOption;
  price: PricedFare;
}

/**
 * One leg's options, priced for the chosen railcard. Only trains that run the requested way are kept: an API with
 * no data for a route may answer with another route's trains (the fixture engine does), and showing those under the
 * wrong stations, or linking to book them, would be wrong.
 */
export function legRows(response: RecommendationResponse, card: Railcard | null): Row[] {
  const { origin, destination } = response.query;
  return response.options
    .filter((o) => o.journey.origin === origin && o.journey.destination === destination)
    .map((option) => ({ option, price: priceWithRailcard(option.journey, card) }));
}

/** The response holds trains, but none for the requested route: we have no data for it (as opposed to no trains that day). */
export const noDataForRoute = (response: RecommendationResponse): boolean => response.options.length > 0 && legRows(response, null).length === 0;

/** Return trains you can actually catch: they leave after the outbound train arrives. */
export function catchableAfter(rows: Row[], outwardArriveAt: string | undefined): Row[] {
  if (!outwardArriveAt) return rows;
  const arrival = Date.parse(outwardArriveAt);
  return rows.filter((r) => Date.parse(r.option.journey.departAt) >= arrival);
}

/** Highest score; the earliest train wins ties (rows arrive sorted by departure). */
export function pickBest(rows: Row[]): Row | undefined {
  return rows.reduce<Row | undefined>((best, r) => (!best || r.option.score > best.option.score ? r : best), undefined);
}

export interface TripTotals {
  pricePence: number;
  /** Before any railcard. */
  fullPence: number;
  /** Chance both trains run without significant disruption. */
  reliability: number;
  applied: boolean;
}

/** A return trip priced as two single fares. */
export function tripTotals(outward: Row, back: Row): TripTotals {
  return {
    pricePence: outward.price.pricePence + back.price.pricePence,
    fullPence: outward.price.fullPence + back.price.fullPence,
    reliability: outward.option.reliability * back.option.reliability,
    applied: outward.price.applied || back.price.applied,
  };
}
