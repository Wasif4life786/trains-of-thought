import { describe, expect, it } from "vitest";
import { KIND_WEIGHT, assess, proximity, risk, scoreAll, touches, verdictFor } from "./model";
import { journey, signal } from "./testkit";

// The journey leaves EUS at 09:00Z and arrives MAN at 11:08Z; MKC is passed at about 09:43Z and SOT at about 10:26Z.
const name = (crs: string) => `Station ${crs}`;

describe("proximity", () => {
  it("is 1 at the destination while the train arrives, 0 once the signal is over", () => {
    expect(proximity(journey(), signal({ start: "2026-11-21T10:50:00Z", end: "2026-11-21T13:00:00Z" }))).toBe(1);
    expect(proximity(journey(), signal({ start: "2026-11-21T12:00:00Z", end: "2026-11-21T14:00:00Z" }))).toBe(0);
  });

  it("is 1 at the origin around departure", () => {
    expect(proximity(journey(), signal({ scope: { stations: ["EUS"], operators: [], nationwide: false }, start: "2026-11-21T08:40:00Z", end: "2026-11-21T09:10:00Z" }))).toBe(1);
  });

  it("is 0.6 at a calling point when the train passes it", () => {
    expect(proximity(journey(), signal({ scope: { stations: ["SOT"], operators: [], nationwide: false }, start: "2026-11-21T10:00:00Z", end: "2026-11-21T10:40:00Z" }))).toBe(0.6);
    expect(proximity(journey(), signal({ scope: { stations: ["SOT"], operators: [], nationwide: false }, start: "2026-11-21T14:00:00Z", end: "2026-11-21T15:00:00Z" }))).toBe(0);
  });

  it("ignores signals at stations off the route (Liverpool v Man Utd for EUS → MAN)", () => {
    expect(proximity(journey(), signal({ scope: { stations: ["LIV"], operators: [], nationwide: false } }))).toBe(0);
  });

  it("only applies operator-specific disruption to that operator", () => {
    const s = signal({ scope: { stations: ["MAN"], operators: ["GR"], nationwide: false } });
    expect(proximity(journey({ operator: "VT" }), s)).toBe(0);
    expect(proximity(journey({ operator: "GR" }), s)).toBe(1);
  });

  it("applies a nationwide signal to every train running while it lasts", () => {
    const strike = signal({ kind: "strike", scope: { stations: [], operators: [], nationwide: true }, start: "2026-11-21T00:00:00Z", end: "2026-11-21T23:59:00Z" });
    expect(proximity(journey(), strike)).toBe(1);
    expect(proximity(journey({ departAt: "2026-11-22T09:00:00Z", arriveAt: "2026-11-22T11:08:00Z" }), strike)).toBe(0);
  });

  it("handles a signal that spans midnight", () => {
    const late = signal({ start: "2026-11-21T22:00:00Z", end: "2026-11-22T04:00:00Z" });
    expect(proximity(journey({ departAt: "2026-11-21T21:00:00Z", arriveAt: "2026-11-21T23:08:00Z" }), late)).toBe(1);
    expect(proximity(journey({ departAt: "2026-11-22T01:00:00Z", arriveAt: "2026-11-22T03:08:00Z" }), late)).toBe(1);
  });
});

describe("risk and assess", () => {
  it("is severity × confidence × kind weight × proximity", () => {
    expect(risk(signal({ kind: "football", severity: 0.8, confidence: 0.6 }), 1)).toBeCloseTo(0.8 * 0.6 * KIND_WEIGHT.football);
    expect(risk(signal({ kind: "weather", severity: 1, confidence: 1 }), 0.6)).toBeCloseTo(0.5 * 0.6);
  });

  it("multiplies reliability by (1 − risk) for each signal touching the train", () => {
    const j = journey();
    const a = signal({ id: "a", kind: "weather", severity: 0.6, confidence: 1 });
    const b = signal({ id: "b", kind: "strike", severity: 1, confidence: 0.5 });
    const expected = 0.9 * (1 - 0.6 * 1 * 0.5) * (1 - 1 * 0.5 * 0.9);
    expect(assess(j, touches(j, [a, b]), name).reliability).toBeCloseTo(expected, 3);
  });

  it("leaves a train nobody touches at its baseline", () => {
    const j = journey();
    expect(assess(j, [], name)).toMatchObject({ reliability: 0.9, crowding: 0.4 });
  });

  it("adds crowding for match and event days but not for weather", () => {
    const j = journey();
    expect(assess(j, touches(j, [signal({ kind: "football", severity: 1 })]), name).crowding).toBeCloseTo(0.8);
    expect(assess(j, touches(j, [signal({ kind: "weather", severity: 1 })]), name).crowding).toBe(0.4);
  });

  it("explains each signal, with the loss in reliability and where it bites", () => {
    const j = journey();
    const { reasons } = assess(j, touches(j, [signal()]), name);
    const r = reasons.find((x) => x.signalId === "test:1")!;
    expect(r).toMatchObject({ kind: "football", effect: "bad" });
    expect(r.text).toContain("Man City v Fulham");
    expect(r.text).toContain("Station MAN");
    expect(r.reliabilityDelta).toBeLessThan(0);
  });

  it("says why a price is good or bad, and flags peak trains and a poor record", () => {
    const j = journey({ baseline: { onTimeProb: 0.8, cancelProb: 0.02, avgDelayMin: 9, crowding: 0.8, peak: true, sampleSize: 12 } });
    const kinds = assess(j, [], name).reasons.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["price", "peak", "history", "crowding"]));
    const soldOut = journey({ fares: [{ ticketType: "anytime", pricePence: 21400, flexible: true }] });
    expect(assess(soldOut, [], name).reasons.some((r) => r.kind === "price" && r.effect === "bad")).toBe(true);
  });
});

describe("scoreAll", () => {
  const cheapButShaky = journey({ id: "A", fares: [{ ticketType: "advance", pricePence: 2000, flexible: false }], baseline: { onTimeProb: 0.7, cancelProb: 0.05, avgDelayMin: 12, crowding: 0.4, peak: false, sampleSize: 9 } });
  const dearButSolid = journey({ id: "B", departAt: "2026-11-21T10:00:00Z", fares: [{ ticketType: "anytime", pricePence: 6000, flexible: true }], baseline: { onTimeProb: 0.95, cancelProb: 0.005, avgDelayMin: 2, crowding: 0.4, peak: false, sampleSize: 9 } });
  const assessments = [cheapButShaky, dearButSolid].map((j) => assess(j, [], name));
  const best = (priority: number) => scoreAll([cheapButShaky, dearButSolid], assessments, priority).find((o) => o.verdict === "best")!.journey.id;

  it("lets the slider swap the best pick: cheapest at 0, most reliable at 1", () => {
    expect(best(0)).toBe("A");
    expect(best(1)).toBe("B");
  });

  it("gives exactly one best, with the top score, and keeps 0–100", () => {
    const options = scoreAll([cheapButShaky, dearButSolid], assessments, 0.5);
    expect(options.filter((o) => o.verdict === "best")).toHaveLength(1);
    expect(options.every((o) => o.score >= 0 && o.score <= 100)).toBe(true);
  });

  it("scores the cheapest train 100 on price alone", () => {
    expect(scoreAll([cheapButShaky, dearButSolid], assessments, 0)[0]!.score).toBe(100);
  });

  it("gives the earliest train the best pick when scores tie", () => {
    const twin = { ...cheapButShaky, id: "A2", departAt: "2026-11-21T12:00:00Z" };
    const options = scoreAll([cheapButShaky, twin], [assess(cheapButShaky, [], name), assess(twin, [], name)], 0.5);
    expect(options.find((o) => o.verdict === "best")?.journey.id).toBe("A");
  });

  it("maps scores to verdicts", () => {
    expect([100, 70, 69, 55, 54, 40, 39, 0].map(verdictFor)).toEqual(["great", "great", "good", "good", "risky", "risky", "avoid", "avoid"]);
  });
});
