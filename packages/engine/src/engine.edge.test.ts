import { describe, expect, it } from "vitest";
import { RecommendationResponseSchema, type FareCurve, type ScoredOption } from "@tot/shared";
import { adviseBooking, createEngine } from "./index";
import { journey, query, signal, stubRail, stubSignals } from "./testkit";

const NOW = () => new Date("2026-11-07T10:00:00Z");
const recommend = (journeys: ReturnType<typeof journey>[], signals: ReturnType<typeof signal>[], q = query(), failSignals = false, curve: FareCurve | null = null) =>
  createEngine({ rail: stubRail(journeys, curve), signals: stubSignals(signals, failSignals), now: NOW }).recommend(q);

const early = journey({ id: "EUS-MAN-2026-11-21T06:00:00Z", departAt: "2026-11-21T06:00:00Z", arriveAt: "2026-11-21T08:08:00Z" });
const late = journey({ id: "EUS-MAN-2026-11-21T10:00:00Z", departAt: "2026-11-21T10:00:00Z", arriveAt: "2026-11-21T12:08:00Z" });
const match = signal({ start: "2026-11-21T11:30:00Z", end: "2026-11-21T18:00:00Z" });

describe("recommend: world signals", () => {
  it("marks down only the trains the match touches, and cites only what it uses", async () => {
    const r = RecommendationResponseSchema.parse(await recommend([early, late], [match]));
    const [a, b] = r.options;
    expect(a!.reliability).toBeGreaterThan(b!.reliability);
    expect(a!.reasons.some((x) => x.signalId)).toBe(false);
    expect(b!.reasons.some((x) => x.signalId === match.id)).toBe(true);
    expect(r.signals.map((s) => s.id)).toEqual([match.id]);
  });

  it("lets a nationwide strike hit every train that day", async () => {
    const strike = signal({ id: "s", kind: "strike", title: "RMT strike", severity: 1, confidence: 0.9, scope: { stations: [], operators: [], nationwide: true }, start: "2026-11-21T00:00:00Z", end: "2026-11-21T23:59:00Z" });
    const r = await recommend([early, late], [strike]);
    expect(r.options.every((o) => o.reasons.some((x) => x.signalId === "s"))).toBe(true);
  });

  it("still answers when the signal source is down, and says so", async () => {
    const r = await recommend([early, late], [match], query(), true);
    expect(r.options).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/unavailable/);
  });
});

describe("recommend: the slider and edge cases", () => {
  const cheap = journey({ id: "EUS-MAN-2026-11-21T07:00:00Z", departAt: "2026-11-21T07:00:00Z", fares: [{ ticketType: "advance", pricePence: 2000, flexible: false }], baseline: { onTimeProb: 0.7, cancelProb: 0.05, avgDelayMin: 12, crowding: 0.4, peak: false, sampleSize: 9 } });
  const solid = journey({ id: "EUS-MAN-2026-11-21T08:00:00Z", departAt: "2026-11-21T08:00:00Z", fares: [{ ticketType: "anytime", pricePence: 6000, flexible: true }], baseline: { onTimeProb: 0.95, cancelProb: 0.005, avgDelayMin: 2, crowding: 0.4, peak: false, sampleSize: 9 } });

  it("changes the best pick as priority moves from price to reliability", async () => {
    expect((await recommend([cheap, solid], [], query({ priority: 0 }))).best?.journey.id).toBe(cheap.id);
    expect((await recommend([cheap, solid], [], query({ priority: 1 }))).best?.journey.id).toBe(solid.id);
  });

  it("returns a full empty heatmap and a warning when there are no trains", async () => {
    const r = RecommendationResponseSchema.parse(await recommend([], [], query({ dateFrom: "2026-11-21", dateTo: "2026-11-22" })));
    expect(r.best).toBeNull();
    expect(r.options).toEqual([]);
    expect(r.heatmap).toHaveLength(2 * 17);
    expect(r.heatmap.every((c) => c.score === null)).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/No trains found/);
  });

  it("buckets trains by London hour in summer (BST), not UTC", async () => {
    const summer = journey({ id: "EUS-MAN-2026-07-01T08:00:00Z", departAt: "2026-07-01T08:00:00Z", arriveAt: "2026-07-01T10:08:00Z" });
    const r = await recommend([summer], [], query({ dateFrom: "2026-07-01", dateTo: "2026-07-01", bookingDate: "2026-06-20" }));
    const cell = r.heatmap.find((c) => c.optionIds.includes(summer.id))!;
    expect(cell).toMatchObject({ date: "2026-07-01", hour: 9 });
  });

  it("defaults the booking date to today in London, and passes it to the rail lane", async () => {
    const rail = stubRail([early]);
    const r = await createEngine({ rail, signals: stubSignals([]), now: () => new Date("2026-11-07T23:30:00Z") }).recommend(query({ bookingDate: undefined }));
    expect(r.query.bookingDate).toBe("2026-11-07");
    expect(rail.lastQuery?.bookingDate).toBe("2026-11-07");
  });

  it("warns when the dates are beyond the weather forecast", async () => {
    const r = await recommend([early], [], query({ dateFrom: "2026-12-10", dateTo: "2026-12-12" }));
    expect(r.warnings.join(" ")).toMatch(/16 days/);
  });
});

describe("adviseBooking", () => {
  const curve = (today: number, inAWeek: number, ticketType: "advance" | "anytime" = "advance"): FareCurve => ({
    journeyId: "EUS-MAN-2026-11-21T09:00:00Z",
    bookingDate: "2026-11-07",
    advanceOnSale: "2026-08-29",
    points: [
      { date: "2026-11-07", daysBefore: 14, pricePence: today, ticketType },
      { date: "2026-11-10", daysBefore: 11, pricePence: today, ticketType },
      { date: "2026-11-14", daysBefore: 7, pricePence: inAWeek, ticketType },
      { date: "2026-11-21", daysBefore: 0, pricePence: 21400, ticketType: "anytime" },
    ],
  });
  const best = (ticketType: "advance" | "anytime" = "advance", price = 3000): ScoredOption => ({
    journey: journey(),
    pricePence: price,
    ticketType,
    reliability: 0.9,
    crowding: 0.4,
    score: 90,
    verdict: "best",
    reasons: [],
  });

  it("says book now when the fare is about to jump, and by when", () => {
    const advice = adviseBooking({ ...best() }, curve(3000, 4800), "2026-11-07");
    expect(advice).toMatchObject({ action: "book_now", expectedPricePence: 4800, bookBy: "2026-11-13" });
    expect(advice.headline).toContain("£48.00");
  });

  it("says there's no rush when the fare stays put", () => {
    expect(adviseBooking({ ...best() }, curve(3000, 3100), "2026-11-07").action).toBe("wait");
  });

  it("says there's no rush when Advance has sold out and walk-up fares don't move", () => {
    expect(adviseBooking({ ...best("anytime", 21400) }, curve(21400, 21400, "anytime"), "2026-11-07")).toMatchObject({ action: "wait", expectedPricePence: 21400 });
  });

  it("says Advance isn't on sale yet for trains more than 12 weeks away", () => {
    const far = { ...best(), journey: journey({ departAt: "2027-02-20T09:00:00Z", arriveAt: "2027-02-20T11:08:00Z" }) };
    expect(adviseBooking(far, curve(3000, 3000), "2026-11-07").action).toBe("not_on_sale_yet");
  });
});
