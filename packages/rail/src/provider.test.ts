import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FareCurveSchema, JourneyOptionSchema, SourceStatusSchema, utcToLondon, type JourneyQuery } from "@tot/shared";
import { createRailProvider } from "./index";

const WEEKEND = { dateFrom: "2026-11-20", dateTo: "2026-11-22", earliest: "06:00", latest: "22:00", bookingDate: "2026-11-07" };
const query = (origin: string, destination: string, extra: Partial<JourneyQuery> = {}): JourneyQuery => ({ origin, destination, ...WEEKEND, ...extra });

describe("the rail provider (real model)", () => {
  const rail = createRailProvider();

  it("meets the M1 bar: ≥ 100 hero departures with fares and baselines, quickly", async () => {
    const t = performance.now();
    const options = z.array(JourneyOptionSchema).parse(await rail.getJourneyOptions(query("EUS", "MAN")));
    expect(options.length).toBeGreaterThanOrEqual(100);
    expect(performance.now() - t).toBeLessThan(2000);
    expect((await rail.searchStations("manc"))[0]?.crs).toBe("MAN");
  });

  it("serves Edinburgh ⇄ Manchester in both directions (the second scenario)", async () => {
    for (const [from, to] of [["EDB", "MAN"], ["MAN", "EDB"]] as const) {
      const options = z.array(JourneyOptionSchema).parse(await rail.getJourneyOptions(query(from, to)));
      expect(options.length, `${from}→${to}`).toBe(42);
      expect(options.every((o) => o.origin === from && o.destination === to && o.operator === "TP" && o.durationMin === 194)).toBe(true);
      expect(options.every((o) => o.id === `${from}-${to}-${o.departAt}`)).toBe(true);
    }
  });

  it("returns departures sorted, unique, inside the date range and time window", async () => {
    const options = await rail.getJourneyOptions(query("EUS", "MAN", { dateFrom: "2026-11-21", dateTo: "2026-11-21", earliest: "09:00", latest: "11:00" }));
    expect(options.length).toBeGreaterThan(0);
    const ids = options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(options.map((o) => o.departAt)).toEqual(options.map((o) => o.departAt).sort());
    for (const o of options) {
      const local = utcToLondon(o.departAt);
      expect(local.date).toBe("2026-11-21");
      expect(local.time >= "09:00" && local.time <= "11:00").toBe(true);
    }
  });

  it("returns nothing for routes it doesn't know, and for unknown stations", async () => {
    expect(await rail.getJourneyOptions(query("EDB", "BRI"))).toEqual([]);
    expect(await rail.getJourneyOptions(query("ZZZ", "MAN"))).toEqual([]);
  });

  it("flags peak trains, and gives them only Advance and Anytime fares", async () => {
    const options = await rail.getJourneyOptions(query("EUS", "MAN", { dateFrom: "2026-11-20", dateTo: "2026-11-20" }));
    const peak = options.filter((o) => o.baseline.peak);
    expect(peak.length).toBeGreaterThan(5);
    for (const o of peak) expect(o.fares.every((f) => f.ticketType === "advance" || f.ticketType === "anytime")).toBe(true);
  });

  it("prices Advance fares as of the booking date: none 12+ weeks before travel", async () => {
    const far = await rail.getJourneyOptions(query("EDB", "MAN", { bookingDate: "2026-08-01" }));
    expect(far.every((o) => o.fares.every((f) => f.ticketType !== "advance"))).toBe(true);
    const near = await rail.getJourneyOptions(query("EDB", "MAN", { bookingDate: "2026-10-01" }));
    expect(near.some((o) => o.fares.some((f) => f.ticketType === "advance"))).toBe(true);
  });

  it("gives a fare curve for every departure, rising to travel day", async () => {
    const options = await rail.getJourneyOptions(query("EDB", "MAN"));
    for (const o of options) {
      const curve = FareCurveSchema.parse(await rail.getFareCurve(o.id, "2026-11-07"));
      expect(curve.journeyId).toBe(o.id);
      expect(curve.points.map((p) => p.date)).toEqual(curve.points.map((p) => p.date).sort());
      expect(curve.points.at(-1)).toMatchObject({ daysBefore: 0, date: utcToLondon(o.departAt).date });
      expect(curve.points[0]!.pricePence).toBeLessThanOrEqual(curve.points.at(-1)!.pricePence);
    }
    expect(await rail.getFareCurve("EDB-MAN-2026-11-20T03:33:00Z", "2026-11-07")).toBeNull();
    expect(await rail.getFareCurve("nope", "2026-11-07")).toBeNull();
  });

  it("reports honest sources with every row accounted for", async () => {
    const sources = z.array(SourceStatusSchema).parse(await rail.listSources());
    expect(sources.map((s) => s.id)).toEqual(["rail:stations", "seed:rail-timetable", "seed:rail-fares", "seed:rail-performance"]);
    for (const s of sources) {
      expect(s.lane).toBe("rail");
      expect(s.quality.rowsIn - s.quality.rowsOut, s.id).toBe(Object.values(s.quality.dropped).reduce((a, b) => a + b, 0));
    }
  });
});
