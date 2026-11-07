// A3's side of the contract: the bar any engine must clear. Add model tests (contract.md A3.6) beside it.
import { describe, expect, it } from "vitest";
import { RecommendationResponseSchema } from "@tot/shared";
import { FIXTURE_QUERY, createFixtureRailProvider, createFixtureSignalProvider } from "@tot/shared/fixtures";
import { createEngine } from "./index";

describe("A3 Engine contract (hero scenario on fixture providers)", () => {
  const engine = createEngine({ signals: createFixtureSignalProvider(), rail: createFixtureRailProvider(), now: () => new Date("2026-11-07T21:00:00Z") });

  it("returns a schema-valid recommendation with a best pick", async () => {
    const r = RecommendationResponseSchema.parse(await engine.recommend(FIXTURE_QUERY));
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.best?.score).toBe(Math.max(...r.options.map((o) => o.score)));
    expect(r.options.filter((o) => o.verdict === "best")).toHaveLength(1);
  });

  it("cites only signals it returns", async () => {
    const r = await engine.recommend(FIXTURE_QUERY);
    const ids = new Set(r.signals.map((s) => s.id));
    for (const o of r.options) for (const reason of o.reasons) if (reason.signalId) expect(ids.has(reason.signalId)).toBe(true);
  });

  it("ignores events that don't touch the route (Liverpool v Man United is not on EUS → MAN)", async () => {
    const r = await engine.recommend(FIXTURE_QUERY);
    expect(r.signals.map((s) => s.id)).not.toContain("openfootball:2026-11-21:liverpool-v-manchester-united");
  });

  it("sorts options by departure and the heatmap by date then hour", async () => {
    const r = await engine.recommend(FIXTURE_QUERY);
    const departs = r.options.map((o) => o.journey.departAt);
    expect(departs).toEqual([...departs].sort());
    const cells = r.heatmap.map((c) => `${c.date}T${String(c.hour).padStart(2, "0")}`);
    expect(cells).toEqual([...cells].sort());
  });
});
