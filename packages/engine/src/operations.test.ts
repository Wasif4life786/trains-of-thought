// The operator model (contract.md §5.6): delay bands, Delay Repay 15 cost, attribution and mitigations.
import { describe, expect, it } from "vitest";
import { DELAY_BANDS, InputsResponseSchema, NetworkResponseSchema, OperationsResponseSchema } from "@tot/shared";
import { FIXTURE_QUERY, createFixtureRailProvider, createFixtureSignalProvider } from "@tot/shared/fixtures";
import { createEngine } from "./index";
import { touches } from "./model";
import { assessService, bandShares, forecastDelay, riskLevelFor } from "./operations";
import { journey, signal } from "./testkit";

const name = (crs: string) => crs;
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("delay forecast", () => {
  it("band shares of an exponential tail add up to 1", () => {
    for (const tail of [10, 20, 60]) expect(sum(bandShares(tail))).toBeCloseTo(1, 6);
  });

  it("on time + cancelled + every band = 1", () => {
    const j = journey();
    const d = forecastDelay(j, touches(j, [signal({ kind: "strike", start: "2026-11-21T08:00:00Z", end: "2026-11-21T12:00:00Z", scope: { stations: ["EUS"], operators: [], nationwide: false } })]));
    expect(d.onTimeProb + d.cancelProb + sum(d.bands)).toBeCloseTo(1, 2);
  });

  it("a strike cancels more and runs later than a football match of the same severity", () => {
    const j = journey({ arriveAt: "2026-11-21T11:08:00Z" });
    const at = { start: "2026-11-21T10:00:00Z", end: "2026-11-21T13:00:00Z", severity: 0.8, confidence: 0.9 };
    const strike = forecastDelay(j, touches(j, [signal({ ...at, kind: "strike" })]));
    const match = forecastDelay(j, touches(j, [signal({ ...at, kind: "football" })]));
    expect(strike.cancelProb).toBeGreaterThan(match.cancelProb);
    expect(strike.expectedDelayMin).toBeGreaterThan(match.expectedDelayMin);
  });

  it("risk levels rise with the share of disrupted trains", () => {
    const at = (onTimeProb: number) => riskLevelFor({ onTimeProb, cancelProb: 0, bands: { "15_29": 1 - onTimeProb, "30_59": 0, "60_119": 0, "120_plus": 0 }, expectedDelayMin: 0 });
    expect([0.9, 0.78, 0.65, 0.5].map(at)).toEqual(["low", "elevated", "high", "severe"]);
  });
});

describe("one service", () => {
  const j = journey();
  const match = signal();

  it("costs more with a signal than without, and attributes the extra to it", () => {
    const s = assessService({ journey: j, touching: touches(j, [match]) }, name);
    expect(s.compensation.expectedCostPence).toBeGreaterThan(s.compensation.baselineCostPence);
    const reason = s.reasons.find((r) => r.signalId === match.id);
    expect(reason?.compensationPence).toBeGreaterThan(0);
  });

  it("only lists mitigations that pay for themselves, best first", () => {
    const busy = journey({ baseline: { ...j.baseline, crowding: 0.9, onTimeProb: 0.8 } });
    const s = assessService({ journey: busy, touching: touches(busy, [signal({ severity: 1, confidence: 1 })]) }, name);
    expect(s.mitigations.length).toBeGreaterThan(0);
    for (const m of s.mitigations) expect(m.netPence).toBe(m.savingPence - m.costPence);
    expect(s.mitigations.every((m) => m.netPence > 0)).toBe(true);
    const nets = s.mitigations.map((m) => m.netPence);
    expect(nets).toEqual([...nets].sort((a, b) => b - a));
  });

  it("drops consumer-only reasons (price, peak)", () => {
    const s = assessService({ journey: journey({ baseline: { ...j.baseline, peak: true } }), touching: [] }, name);
    expect(s.reasons.some((r) => r.kind === "price" || r.kind === "peak")).toBe(false);
  });

  it("has one probability per Delay Repay band", () => {
    expect(Object.keys(assessService({ journey: j, touching: [] }, name).delay.bands).sort()).toEqual([...DELAY_BANDS].sort());
  });
});

describe("engine operator endpoints on the fixture providers", () => {
  const engine = createEngine({ signals: createFixtureSignalProvider(), rail: createFixtureRailProvider(), now: () => new Date("2026-11-07T12:00:00Z") });
  const dates = { dateFrom: FIXTURE_QUERY.dateFrom, dateTo: FIXTURE_QUERY.dateTo };

  it("operations: valid, sorted, totals add up, one heatmap cell per date × hour", async () => {
    const r = OperationsResponseSchema.parse(await engine.operations({ origin: "EUS", destination: "MAN", ...dates, earliest: "05:00", latest: "23:30" }));
    const departs = r.services.map((s) => s.journey.departAt);
    expect(departs).toEqual([...departs].sort());
    expect(r.totals.expectedCostPence).toBe(r.services.reduce((n, s) => n + s.compensation.expectedCostPence, 0));
    expect(r.heatmap).toHaveLength(3 * 19);
    expect(r.signals.map((s) => s.id)).not.toContain("openfootball:2026-11-21:liverpool-v-manchester-united");
  });

  it("inputs: corridors on the map, every hour of the window, and exposure that adds up", async () => {
    const r = InputsResponseSchema.parse(await engine.inputs(dates));
    expect(r.timeline).toHaveLength(3 * 24);
    expect(r.corridors).toHaveLength(1);
    const [c] = r.corridors;
    expect(c!.stops[0]).toBe("EUS");
    expect(c!.stops.at(-1)).toBe("MAN");
    expect(c!.exposureByHour).toHaveLength(r.timeline.length);
    const network = await engine.network(dates);
    expect(r.timeline.reduce((n, p) => n + p.expectedCostPence, 0)).toBe(network.totals.expectedCostPence);
    const placed = new Set(r.stations.map((s) => s.crs));
    for (const crs of c!.stops) expect(placed.has(crs)).toBe(true);
    expect(r.signals.map((s) => s.signal.id)).not.toContain("openfootball:2026-11-21:liverpool-v-manchester-united");
  });

  it("network: alerts biggest cost first, each with the routes it touches", async () => {
    const r = NetworkResponseSchema.parse(await engine.network(dates));
    expect(r.alerts.length).toBeGreaterThan(0);
    const costs = r.alerts.map((a) => a.expectedCostPence);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));
    for (const a of r.alerts) expect(a.routes.length).toBeGreaterThan(0);
  });
});
