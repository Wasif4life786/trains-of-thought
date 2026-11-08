// A1's side of the contract. Keep it green; per-source tests are in src/sources/*.test.ts.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SignalSchema, SourceStatusSchema, overlaps } from "@tot/shared";
import { createSignalProvider } from "./index";

const NOW = () => new Date("2026-11-07T12:00:00Z");
const HERO = { from: "2026-11-20T00:00:00Z", to: "2026-11-22T23:59:59Z", stations: ["EUS", "MAN", "MKC", "SOT", "SPT"] };

describe("A1 SignalProvider contract", () => {
  const provider = createSignalProvider({ now: NOW });

  it("returns schema-valid, unique signals for the hero weekend, including a real football fixture", async () => {
    const signals = z.array(SignalSchema).parse(await provider.getSignals(HERO));
    expect(signals.length).toBeGreaterThanOrEqual(5);
    expect(new Set(signals.map((s) => s.id)).size).toBe(signals.length);
    for (const s of signals) expect(Date.parse(s.end)).toBeGreaterThanOrEqual(Date.parse(s.start));
    expect(signals.map((s) => s.id)).toContain("openfootball:2026-11-21:manchester-city-v-fulham");
  });

  it("only returns signals that overlap the window and touch the stations (or are nationwide)", async () => {
    for (const s of await provider.getSignals(HERO)) {
      expect(overlaps(s.start, s.end, HERO.from, HERO.to)).toBe(true);
      expect(s.scope.nationwide || s.scope.stations.some((crs) => HERO.stations.includes(crs))).toBe(true);
    }
  });

  it("leaves out events that don't touch the stations asked about (Liverpool v Man Utd at Anfield)", async () => {
    expect((await provider.getSignals(HERO)).map((s) => s.id)).not.toContain("openfootball:2026-11-21:liverpool-v-manchester-united");
    const liverpool = await provider.getSignals({ ...HERO, stations: ["LIV"] });
    expect(liverpool.map((s) => s.id)).toContain("openfootball:2026-11-21:liverpool-v-manchester-united");
  });

  it("is sorted by start time", async () => {
    const starts = (await provider.getSignals(HERO)).map((s) => s.start);
    expect(starts).toEqual([...starts].sort());
  });

  it("filters by kind", async () => {
    const football = await provider.getSignals({ ...HERO, kinds: ["football"] });
    expect(football.length).toBeGreaterThan(0);
    expect(football.every((s) => s.kind === "football")).toBe(true);
  });

  it("answers quickly once warm", async () => {
    await provider.getSignals(HERO);
    const t = performance.now();
    await provider.getSignals(HERO);
    expect(performance.now() - t).toBeLessThan(300);
  });

  it("reports every source honestly, with every row accounted for", async () => {
    const sources = z.array(SourceStatusSchema).parse(await provider.listSources());
    expect(sources.map((s) => s.id)).toEqual(["gov-uk-bank-holidays", "open-meteo", "openfootball", "thesportsdb", "seed:events", "seed:disruptions", "tfl-status", "seasonal:leaf-fall"]);
    for (const s of sources) {
      expect(s.lane).toBe("signals");
      expect(s.quality.rowsIn - s.quality.rowsOut, s.id).toBe(Object.values(s.quality.dropped).reduce((a, b) => a + b, 0));
    }
  });
});
