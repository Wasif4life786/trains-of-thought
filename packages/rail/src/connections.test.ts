import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FareCurveSchema, JourneyOptionSchema, utcToLondon, type JourneyQuery } from "@tot/shared";
import { combineFares, findConnections, mergeLegs } from "./connections";
import { createRailProvider } from "./index";

const DAY = { dateFrom: "2026-11-21", dateTo: "2026-11-21", earliest: "06:00", latest: "22:00", bookingDate: "2026-11-07" };
const query = (origin: string, destination: string): JourneyQuery => ({ origin, destination, ...DAY });

describe("one-change journeys", () => {
  const rail = createRailProvider();

  it("finds Liverpool → Edinburgh through Manchester, with a workable connection", async () => {
    const options = z.array(JourneyOptionSchema).parse(await rail.getJourneyOptions(query("LIV", "EDB")));
    expect(options.length).toBeGreaterThan(5);
    for (const o of options) {
      expect(o).toMatchObject({ origin: "LIV", destination: "EDB", changes: 1 });
      expect(o.callingPoints).toContain("MAN");
      expect(o.id).toBe(`LIV-EDB-${o.departAt}`);
    }
    for (const c of findConnections("LIV", "EDB", "2026-11-21")) {
      const wait = (Date.parse(c.second.service.departAt) - Date.parse(c.first.service.arriveAt)) / 60_000;
      expect(wait).toBeGreaterThanOrEqual(10);
      expect(wait).toBeLessThanOrEqual(90);
    }
  });

  it("returns each departure once, sorted, inside the time window", async () => {
    const options = await rail.getJourneyOptions({ ...query("LIV", "EDB"), earliest: "09:00", latest: "12:00" });
    const ids = options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(options.map((o) => o.departAt)).toEqual(options.map((o) => o.departAt).sort());
    for (const o of options) expect(utcToLondon(o.departAt).time >= "09:00" && utcToLondon(o.departAt).time <= "12:00").toBe(true);
  });

  it("works the other way round, and for Bristol → Manchester through Birmingham", async () => {
    expect((await rail.getJourneyOptions(query("EDB", "LIV"))).length).toBeGreaterThan(5);
    const bristol = await rail.getJourneyOptions(query("BRI", "MAN"));
    expect(bristol.length).toBeGreaterThan(5);
    expect(bristol[0]!.callingPoints).toContain("BHM");
  });

  it("adds the two fares, and makes the trip less likely to run on time than either train", async () => {
    const [journey] = await rail.getJourneyOptions(query("LIV", "EDB"));
    const c = findConnections("LIV", "EDB", "2026-11-21")[0]!;
    expect(journey!.fares.at(-1)!.ticketType).toBe("anytime");
    expect(journey!.fares.at(-1)!.pricePence).toBe(2450 + 13200);
    expect(journey!.durationMin).toBeGreaterThan(c.first.service.durationMin + c.second.service.durationMin);
  });

  it("keeps to direct trains where there are any, and offers nothing that needs two changes", async () => {
    expect(await rail.getJourneyOptions(query("EDB", "BRI"))).toEqual([]);
    const direct = await rail.getJourneyOptions(query("EUS", "MAN"));
    expect(direct.length).toBeGreaterThan(30);
    expect(direct.every((o) => o.changes === 0)).toBe(true);
  });

  it("gives a fare curve for a connection, and null for one that doesn't exist", async () => {
    const [journey] = await rail.getJourneyOptions(query("LIV", "EDB"));
    const curve = FareCurveSchema.parse(await rail.getFareCurve(journey!.id, "2026-11-07"));
    expect(curve.points.at(-1)).toMatchObject({ daysBefore: 0, date: "2026-11-21" });
    expect(await rail.getFareCurve("LIV-EDB-2026-11-21T03:00:00Z", "2026-11-07")).toBeNull();
  });

  it("applies a railcard to the joined fare", async () => {
    const plain = (await rail.getJourneyOptions(query("LIV", "EDB")))[0]!;
    const card = (await rail.getJourneyOptions({ ...query("LIV", "EDB"), railcard: "16-25" }))[0]!;
    expect(card.fares[0]!.pricePence).toBeLessThan(plain.fares[0]!.pricePence);
  });
});

describe("joining legs", () => {
  it("combines only the ticket types both legs sell, and is flexible only if both are", () => {
    const a = [{ ticketType: "advance" as const, pricePence: 2000, flexible: false }, { ticketType: "anytime" as const, pricePence: 5000, flexible: true }];
    const b = [{ ticketType: "anytime" as const, pricePence: 4000, flexible: true }];
    expect(combineFares(a, b)).toEqual([{ ticketType: "anytime", pricePence: 9000, flexible: true }]);
  });

  it("mergeLegs keeps the first departure and the last arrival", () => {
    const leg = (o: string, d: string, dep: string, arr: string) => ({
      id: `${o}-${d}-${dep}`, origin: o, destination: d, departAt: dep, arriveAt: arr, durationMin: 60, changes: 0, operator: "XC", callingPoints: [],
      fares: [{ ticketType: "anytime" as const, pricePence: 1000, flexible: true }],
      baseline: { onTimeProb: 0.8, cancelProb: 0.02, avgDelayMin: 4, crowding: 0.4, peak: false, sampleSize: 10 },
    });
    const merged = mergeLegs(leg("A", "B", "2026-11-21T09:00:00Z", "2026-11-21T10:00:00Z"), leg("B", "C", "2026-11-21T10:20:00Z", "2026-11-21T11:20:00Z"), "B");
    expect(merged).toMatchObject({ id: "A-C-2026-11-21T09:00:00Z", durationMin: 140, changes: 1, callingPoints: ["B"] });
    expect(merged.baseline.onTimeProb).toBeCloseTo(0.64, 2);
  });
});
