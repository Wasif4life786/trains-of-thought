// A2's side of the contract. Keep it green; add tests for your models next to them.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FareCurveSchema, JourneyOptionSchema, SourceStatusSchema, StationSchema, utcToLondon, type JourneyQuery } from "@tot/shared";
import { createRailProvider } from "./index";

const HERO: JourneyQuery = { origin: "EUS", destination: "MAN", dateFrom: "2026-11-20", dateTo: "2026-11-22", earliest: "06:00", latest: "22:00", bookingDate: "2026-11-07" };

describe("A2 RailProvider contract", () => {
  const rail = createRailProvider();

  it("searches stations by name and puts an exact CRS match first", async () => {
    const byName = z.array(StationSchema).parse(await rail.searchStations("manchester"));
    expect(byName.map((s) => s.crs)).toContain("MAN");
    expect((await rail.searchStations("eus"))[0]?.crs).toBe("EUS");
    expect(await rail.searchStations("")).toEqual([]);
  });

  it("looks stations up by CRS", async () => {
    expect((await rail.getStation("EUS"))?.name).toMatch(/Euston/);
    expect(await rail.getStation("ZZZ")).toBeNull();
  });

  it("returns schema-valid departures inside the window, sorted, with unique ids", async () => {
    const options = z.array(JourneyOptionSchema).parse(await rail.getJourneyOptions(HERO));
    expect(options.length).toBeGreaterThan(0);
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
    expect(options.map((o) => o.departAt)).toEqual(options.map((o) => o.departAt).sort());
    for (const o of options) {
      const local = utcToLondon(o.departAt);
      expect(local.date >= HERO.dateFrom && local.date <= HERO.dateTo).toBe(true);
      expect(local.time >= HERO.earliest && local.time <= HERO.latest).toBe(true);
      expect(Date.parse(o.arriveAt)).toBeGreaterThan(Date.parse(o.departAt));
      expect(o.fares.map((f) => f.pricePence)).toEqual(o.fares.map((f) => f.pricePence).sort((a, b) => a - b));
    }
  });

  it("gives a fare curve for any departure it returned", async () => {
    const [first] = await rail.getJourneyOptions(HERO);
    const curve = FareCurveSchema.parse(await rail.getFareCurve(first!.id, HERO.bookingDate));
    expect(curve.points.map((p) => p.date)).toEqual(curve.points.map((p) => p.date).sort());
    expect(await rail.getFareCurve("nope", HERO.bookingDate)).toBeNull();
  });

  it("reports every source honestly", async () => {
    const sources = z.array(SourceStatusSchema).parse(await rail.listSources());
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.lane === "rail")).toBe(true);
  });
});
