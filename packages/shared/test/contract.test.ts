import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, RecommendationResponseSchema } from "../src/index";
import { FIXTURE_QUERY, createFixtureEngine, createFixtureRailProvider, createFixtureSignalProvider, loadFixtures } from "../src/fixtures";

describe("the contract itself", () => {
  it("contract.md and CONTRACT_VERSION agree (bump both together, contract.md §8)", () => {
    const firstLine = readFileSync(new URL("../../../contract.md", import.meta.url), "utf8").split("\n")[0];
    expect(firstLine).toContain(`contract v${CONTRACT_VERSION}`);
  });

  it("every fixture validates against its schema", () => {
    expect(() => loadFixtures()).not.toThrow();
  });
});

describe("the fixture recommendation is internally consistent (the bar for A3's engine)", () => {
  const r = loadFixtures().recommendation;

  it("cites only signals it includes", () => {
    const ids = new Set(r.signals.map((s) => s.id));
    for (const o of r.options) for (const reason of o.reasons) if (reason.signalId) expect(ids.has(reason.signalId)).toBe(true);
  });

  it("has exactly one best pick, with the top score", () => {
    expect(r.options.filter((o) => o.verdict === "best")).toHaveLength(1);
    expect(r.best?.score).toBe(Math.max(...r.options.map((o) => o.score)));
  });

  it("has one heatmap cell per date × hour of the window", () => {
    expect(r.heatmap).toHaveLength(3 * 17);
    const ids = new Set(r.options.map((o) => o.journey.id));
    for (const cell of r.heatmap) for (const id of cell.optionIds) expect(ids.has(id)).toBe(true);
  });

  it("ignores Liverpool v Man United, which doesn't touch EUS → MAN", () => {
    expect(r.signals.map((s) => s.id)).not.toContain("openfootball:2026-11-21:liverpool-v-manchester-united");
  });
});

describe("fake providers", () => {
  it("fake A1 filters by window and station, sorted by start", async () => {
    const signals = await createFixtureSignalProvider().getSignals({ from: "2026-11-21T00:00:00Z", to: "2026-11-21T23:59:59Z", stations: ["LIV"] });
    expect(signals.map((s) => s.id)).toEqual(["openfootball:2026-11-21:liverpool-v-manchester-united"]);
  });

  it("fake A2 answers the hero query and prices a fare curve", async () => {
    const rail = createFixtureRailProvider();
    const options = await rail.getJourneyOptions({ ...FIXTURE_QUERY, bookingDate: "2026-11-07" });
    expect(options).toHaveLength(136);
    const curve = await rail.getFareCurve(options[0]!.id, "2026-11-07");
    expect(curve?.points.at(-1)?.daysBefore).toBe(0);
  });

  it("fake A2 and A3 also serve the way back (MAN → EUS), mirrored, with consistent ids", async () => {
    const back = { ...FIXTURE_QUERY, origin: "MAN", destination: "EUS" };
    const rail = createFixtureRailProvider();
    const options = await rail.getJourneyOptions({ ...back, bookingDate: "2026-11-07" });
    expect(options).toHaveLength(136);
    expect(options.every((o) => o.origin === "MAN" && o.destination === "EUS" && o.id.startsWith("MAN-EUS-"))).toBe(true);
    expect(options[0]!.callingPoints).toEqual(["SPT", "MAC", "SOT", "MKC"]);
    expect(await rail.getFareCurve(options[0]!.id, "2026-11-07")).not.toBeNull();

    const r = RecommendationResponseSchema.parse(await createFixtureEngine().recommend(back));
    const ids = new Set(r.options.map((o) => o.journey.id));
    expect(r.options.every((o) => o.journey.origin === "MAN" && o.journey.destination === "EUS")).toBe(true);
    expect(r.best && ids.has(r.best.journey.id)).toBe(true);
    expect(r.bookingAdvice?.journeyId).toBe(r.best?.journey.id);
    for (const cell of r.heatmap) for (const id of cell.optionIds) expect(ids.has(id)).toBe(true);
    expect(r.warnings.join(" ")).not.toMatch(/canned EUS → MAN example/);
  });

  it("fake A3 echoes the query and warns when it can't really answer it", async () => {
    const r = await createFixtureEngine().recommend({ ...FIXTURE_QUERY, origin: "KGX", destination: "EDB" });
    expect(r.query.origin).toBe("KGX");
    expect(r.warnings.at(-1)).toMatch(/canned EUS → MAN/);
  });
});
