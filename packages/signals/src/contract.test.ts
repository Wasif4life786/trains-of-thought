// A1's side of the contract. Keep it green; add tests per source next to your adapters.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SignalSchema, SourceStatusSchema, overlaps } from "@tot/shared";
import { createSignalProvider } from "./index";

const HERO = { from: "2026-11-20T00:00:00Z", to: "2026-11-22T23:59:59Z", stations: ["EUS", "MAN", "MKC", "SOT", "SPT"] };

describe("A1 SignalProvider contract", () => {
  const provider = createSignalProvider();

  it("returns schema-valid, unique signals for the hero weekend", async () => {
    const signals = z.array(SignalSchema).parse(await provider.getSignals(HERO));
    expect(signals.length).toBeGreaterThan(0);
    expect(new Set(signals.map((s) => s.id)).size).toBe(signals.length);
    for (const s of signals) expect(Date.parse(s.end)).toBeGreaterThanOrEqual(Date.parse(s.start));
  });

  it("only returns signals that overlap the window and touch the stations (or are nationwide)", async () => {
    for (const s of await provider.getSignals(HERO)) {
      expect(overlaps(s.start, s.end, HERO.from, HERO.to)).toBe(true);
      expect(s.scope.nationwide || s.scope.stations.some((crs) => HERO.stations.includes(crs))).toBe(true);
    }
  });

  it("is sorted by start time", async () => {
    const starts = (await provider.getSignals(HERO)).map((s) => s.start);
    expect(starts).toEqual([...starts].sort());
  });

  it("filters by kind", async () => {
    const football = await provider.getSignals({ ...HERO, kinds: ["football"] });
    expect(football.every((s) => s.kind === "football")).toBe(true);
  });

  it("reports every source honestly", async () => {
    const sources = z.array(SourceStatusSchema).parse(await provider.listSources());
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.lane === "signals")).toBe(true);
  });
});
