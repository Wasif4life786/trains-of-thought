import { beforeAll, describe, expect, it } from "vitest";
import type { RecommendationResponse } from "@tot/shared";
import { FIXTURE_QUERY, createFixtureEngine } from "@tot/shared/fixtures";
import { RAILCARDS } from "./railcards";
import { catchableAfter, legRows, noDataForRoute, pickBest, tripTotals } from "./trip";

let there: RecommendationResponse;
let back: RecommendationResponse;

beforeAll(async () => {
  const engine = createFixtureEngine();
  there = await engine.recommend(FIXTURE_QUERY);
  back = await engine.recommend({ ...FIXTURE_QUERY, origin: "MAN", destination: "EUS" });
});

describe("legRows", () => {
  it("keeps every train for the requested direction", () => {
    expect(legRows(there, null)).toHaveLength(136);
    expect(legRows(back, null).every((r) => r.option.journey.origin === "MAN")).toBe(true);
  });

  it("drops trains that don't run the requested route (Edinburgh → Manchester gets the canned Euston trains)", async () => {
    const edinburgh = await createFixtureEngine().recommend({ ...FIXTURE_QUERY, origin: "EDB", destination: "MAN" });
    expect(edinburgh.options).toHaveLength(136);
    expect(legRows(edinburgh, null)).toHaveLength(0);
    expect(noDataForRoute(edinburgh)).toBe(true);
  });

  it("tells 'no data for this route' apart from a route that has trains", () => {
    expect(noDataForRoute(there)).toBe(false);
    expect(noDataForRoute(back)).toBe(false);
    expect(noDataForRoute({ ...there, options: [] })).toBe(false);
  });

  it("prices each row for the railcard", () => {
    const rows = legRows(there, RAILCARDS.find((c) => c.id === "16-25")!);
    expect(rows.every((r) => r.price.applied && r.price.pricePence < r.price.fullPence)).toBe(true);
  });
});

describe("catchableAfter", () => {
  it("only offers return trains that leave after the outbound train arrives", () => {
    const arrival = "2026-11-21T11:08:00Z";
    const catchable = catchableAfter(legRows(back, null), arrival);
    expect(catchable.length).toBeGreaterThan(0);
    expect(catchable.length).toBeLessThan(136);
    expect(catchable.every((r) => Date.parse(r.option.journey.departAt) >= Date.parse(arrival))).toBe(true);
  });

  it("offers everything while no outbound train is chosen", () => {
    expect(catchableAfter(legRows(back, null), undefined)).toHaveLength(136);
  });
});

describe("pickBest and tripTotals", () => {
  it("picks the engine's best train", () => {
    expect(pickBest(legRows(there, null))?.option.journey.id).toBe(there.best?.journey.id);
    expect(pickBest([])).toBeUndefined();
  });

  it("adds two single fares and multiplies reliabilities", () => {
    const out = pickBest(legRows(there, null))!;
    const ret = pickBest(legRows(back, null))!;
    const totals = tripTotals(out, ret);
    expect(totals.pricePence).toBe(out.price.pricePence + ret.price.pricePence);
    expect(totals.reliability).toBeCloseTo(out.option.reliability * ret.option.reliability);
    expect(totals.applied).toBe(false);
  });
});
