import { describe, expect, it } from "vitest";
import { RAILCARDS, RAILCARD_IDS, discountFares, oneThirdOff, parseRecommendationQuery, type Fare } from "../src/index";

const fares: Fare[] = [
  { ticketType: "advance", pricePence: 3840, flexible: false },
  { ticketType: "off_peak", pricePence: 10850, flexible: true },
  { ticketType: "anytime", pricePence: 21400, flexible: true },
];

describe("railcards", () => {
  it("has rules for every id the schema allows", () => {
    expect(RAILCARDS.map((c) => c.id).sort()).toEqual([...RAILCARD_IDS].sort());
  });

  it("takes a third off in integer pence", () => {
    expect([3840, 10, 0, 21400].map(oneThirdOff)).toEqual([2560, 7, 0, 14267]);
  });

  it("discounts every fare when the card is valid, keeping them cheapest first", () => {
    const out = discountFares(fares, "16-25", "2026-11-21T09:00:00Z");
    expect(out.map((f) => f.pricePence)).toEqual([2560, 7233, 14267]);
    expect(out.map((f) => f.ticketType)).toEqual(["advance", "off_peak", "anytime"]);
    expect(out[0]!.flexible).toBe(false);
  });

  it("leaves the fares alone when the card isn't valid: Senior on a weekday morning, valid at weekends", () => {
    expect(discountFares(fares, "senior", "2026-11-20T06:00:00Z")).toEqual(fares); // Friday 06:00
    expect(discountFares(fares, "senior", "2026-11-20T10:00:00Z")[0]!.pricePence).toBe(2560); // Friday 10:00
    expect(discountFares(fares, "senior", "2026-11-21T06:20:00Z")[0]!.pricePence).toBe(2560); // Saturday 06:20
  });

  it("accepts a railcard in the HTTP query, and rejects an unknown one", () => {
    const base = { origin: "EUS", destination: "MAN", dateFrom: "2026-11-21" };
    expect(parseRecommendationQuery({ ...base, railcard: "16-25" }).railcard).toBe("16-25");
    expect(parseRecommendationQuery(base).railcard).toBeUndefined();
    expect(() => parseRecommendationQuery({ ...base, railcard: "gold" })).toThrow();
  });
});
