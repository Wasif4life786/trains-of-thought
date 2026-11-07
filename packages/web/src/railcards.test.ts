import { describe, expect, it } from "vitest";
import { loadFixtures } from "@tot/shared/fixtures";
import { RAILCARDS, oneThirdOff, priceWithRailcard } from "./railcards";

const journey = (id: string) => loadFixtures().journeyOptions.find((j) => j.id === id)!;
const card = (id: string) => RAILCARDS.find((c) => c.id === id)!;

const FRIDAY_6AM = journey("EUS-MAN-2026-11-20T06:00:00Z");
const SATURDAY_9AM = journey("EUS-MAN-2026-11-21T09:00:00Z");
const cheapest = (j: typeof SATURDAY_9AM) => Math.min(...j.fares.map((f) => f.pricePence));

describe("oneThirdOff", () => {
  it("takes a third off in integer pence", () => {
    expect(oneThirdOff(3840)).toBe(2560);
    expect(oneThirdOff(10)).toBe(7);
    expect(oneThirdOff(0)).toBe(0);
  });
});

describe("priceWithRailcard", () => {
  it("leaves the price alone with no railcard", () => {
    expect(priceWithRailcard(SATURDAY_9AM, null)).toMatchObject({ pricePence: cheapest(SATURDAY_9AM), applied: false, blocked: false });
  });

  it("takes a third off the cheapest fare when the card is valid", () => {
    const priced = priceWithRailcard(SATURDAY_9AM, card("16-25"));
    expect(priced).toMatchObject({ applied: true, blocked: false, fullPence: cheapest(SATURDAY_9AM), pricePence: oneThirdOff(cheapest(SATURDAY_9AM)) });
  });

  it("blocks Senior and Two Together on weekday trains before 09:30, at full price", () => {
    for (const id of ["senior", "two-together"]) {
      expect(priceWithRailcard(FRIDAY_6AM, card(id))).toMatchObject({ applied: false, blocked: true, pricePence: cheapest(FRIDAY_6AM) });
    }
  });

  it("allows Senior at weekends before 09:30", () => {
    expect(priceWithRailcard(journey("EUS-MAN-2026-11-21T06:20:00Z"), card("senior")).applied).toBe(true);
  });

  it("never picks a railcard price above the normal one", () => {
    for (const j of loadFixtures().journeyOptions) {
      for (const c of RAILCARDS) expect(priceWithRailcard(j, c).pricePence).toBeLessThanOrEqual(cheapest(j));
    }
  });
});
