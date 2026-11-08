// A2.9: Realtime Trains arrivals → observations. Hand-made responses in the API's shape; never the network.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBaseline } from "./performance";
import { servicesFor } from "./index";
import { loadRoutes } from "./routes";
import { loadRttHistory, parseRttDay, scheduleFromDay, type RealService } from "./rtt";

const arrival = (planned: string, o: Record<string, unknown> = {}) => ({
  temporalData: { arrival: { scheduleInternal: planned, scheduleAdvertised: planned, realtimeActual: planned, realtimeAdvertisedLateness: 0, realtimeInternalLateness: 0, isCancelled: false, ...o } },
  scheduleMetadata: { uniqueIdentity: `gb-nr:${planned}`, operator: { code: "VT" }, inPassengerService: true, modeType: "TRAIN" },
});

const day = {
  services: [
    arrival("2026-11-07T08:44:00", { realtimeAdvertisedLateness: 24 }),
    arrival("2026-11-07T09:04:00", { realtimeAdvertisedLateness: -2 }),
    arrival("2026-11-07T09:24:00", { isCancelled: true, realtimeActual: undefined, realtimeAdvertisedLateness: null }),
    arrival("2026-11-07T09:44:00", { realtimeAdvertisedLateness: null, realtimeInternalLateness: 6 }),
    arrival("2026-11-07T10:04:00", { realtimeActual: undefined, realtimeAdvertisedLateness: null, realtimeInternalLateness: null }),
    arrival("2026-11-07T08:44:00", { realtimeAdvertisedLateness: 24 }),
    { ...arrival("2026-11-07T11:00:00"), scheduleMetadata: { inPassengerService: false } },
    { temporalData: {} },
  ],
};

const fresh = () => ({ rowsIn: 0, fixed: {} as Record<string, number>, dropped: {} as Record<string, number> });

describe("parseRttDay", () => {
  it("keeps real arrivals, counting every repair and drop", () => {
    const q = fresh();
    const obs = parseRttDay(day, "EUS-MAN", 128, q, new Set());
    expect(obs).toHaveLength(4);
    expect(q.rowsIn).toBe(8);
    expect(q.rowsIn - obs.length).toBe(Object.values(q.dropped).reduce((a, b) => a + b, 0));
    expect(q.dropped).toEqual({ no_actual_time_recorded: 1, duplicate: 1, not_a_passenger_train: 1, no_scheduled_arrival: 1 });
    expect(q.fixed).toEqual({ early_clamped_to_zero: 1, working_lateness_used: 1 });
  });

  it("reads lateness at the destination and files it under the planned departure hour", () => {
    const [first, second, third] = parseRttDay(day, "EUS-MAN", 128, fresh(), new Set());
    // 08:44 arrival − 128 min = 06:36 departure, on a Saturday.
    expect(first).toEqual({ route: "EUS-MAN", weekday: 6, hour: 6, delayMin: 24, cancelled: false });
    expect(second!.delayMin).toBe(0);
    expect(third!.cancelled).toBe(true);
  });

  it("survives an empty or malformed day", () => {
    expect(parseRttDay({ services: null }, "EUS-MAN", 128, fresh(), new Set())).toEqual([]);
    expect(parseRttDay(null, "EUS-MAN", 128, fresh(), new Set())).toEqual([]);
  });
});

describe("loadRttHistory", () => {
  it("prefers this machine's cache, falls back to the snapshot, and skips routes we don't run", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtt-"));
    const dirs = { cache: `${root}/cache/`, snapshot: `${root}/snap/` };
    mkdirSync(`${dirs.snapshot}EUS-MAN`, { recursive: true });
    writeFileSync(`${dirs.snapshot}EUS-MAN/2026-11-07.json`, JSON.stringify(day));
    mkdirSync(`${dirs.snapshot}XXX-YYY`, { recursive: true });
    writeFileSync(`${dirs.snapshot}XXX-YYY/2026-11-07.json`, JSON.stringify(day));
    const durations = (r: string) => (r === "EUS-MAN" ? { durationMin: 128, operator: "VT", originName: "London Euston" } : undefined);

    const fromSnapshot = loadRttHistory(durations, dirs);
    expect(fromSnapshot.mode).toBe("seed");
    expect(fromSnapshot.observations).toHaveLength(4);

    mkdirSync(`${dirs.cache}EUS-MAN`, { recursive: true });
    writeFileSync(`${dirs.cache}EUS-MAN/2026-11-06.json`, JSON.stringify({ services: [arrival("2026-11-06T08:44:00")] }));
    const fromCache = loadRttHistory(durations, dirs);
    expect(fromCache.mode).toBe("cache");
    expect(fromCache.observations).toHaveLength(1);
    expect(fromCache.days).toBe(1);
  });

  it("returns nothing (synthetic history only) when no real data has been fetched", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtt-"));
    expect(loadRttHistory(() => ({ durationMin: 128, operator: "VT", originName: "London Euston" }), { cache: `${root}/a/`, snapshot: `${root}/b/` })).toMatchObject({ mode: null, observations: [] });
  });
});

describe("real history layered over the synthetic baseline", () => {
  const synthetic = buildBaseline(Array.from({ length: 200 }, (_, i) => ({ route: "EUS-MAN", weekday: 6, hour: 9, delayMin: i % 10 === 0 ? 30 : 2, cancelled: false })));

  it("follows the real data where there is plenty of it", () => {
    const real = Array.from({ length: 300 }, (_, i) => ({ route: "EUS-MAN", weekday: 6, hour: 9, delayMin: i % 2 === 0 ? 25 : 3, cancelled: false }));
    const layered = buildBaseline(real, synthetic).get("EUS-MAN", 6, 9);
    expect(synthetic.get("EUS-MAN", 6, 9).onTimeProb).toBeGreaterThan(0.85);
    expect(layered.onTimeProb).toBeLessThan(0.6);
  });

  it("falls back to the synthetic prior where real data is missing", () => {
    expect(buildBaseline([], synthetic).get("EUS-MAN", 6, 9).onTimeProb).toBeCloseTo(synthetic.get("EUS-MAN", 6, 9).onTimeProb, 2);
  });
});

describe("real timetable", () => {
  const withOrigin = (arrive: string, depart: string | null, o: Record<string, unknown> = {}) => ({
    ...arrival(arrive),
    ...(depart ? { origin: [{ location: { description: "London Euston" }, temporalData: { scheduleAdvertised: depart } }] } : { origin: [{ location: { description: "Wolverhampton" }, temporalData: { scheduleAdvertised: "2026-11-07T07:00:00" } }] }),
    ...o,
  });

  it("takes the real departure when the train starts at our origin, else estimates it from the arrival", () => {
    const day = {
      services: [
        withOrigin("2026-11-07T08:44:00", "2026-11-07T06:29:00"),
        withOrigin("2026-11-07T09:05:00", null),
        { ...withOrigin("2026-11-07T09:44:00", "2026-11-07T07:33:00"), scheduleMetadata: { uniqueIdentity: "x", operator: { code: "LM" }, inPassengerService: true } },
      ],
    };
    expect(scheduleFromDay(day, "London Euston", 128, "VT")).toEqual([
      { departDate: "2026-11-07", time: "06:29", durationMin: 135, operator: "VT", estimated: false },
      { departDate: "2026-11-07", time: "06:57", durationMin: 128, operator: "VT", estimated: true },
    ]);
  });

  it("drives the departures: the real times for that weekday, not the modelled :00/:20/:40 pattern", () => {
    const route = loadRoutes().find((r) => r.id === "EUS-MAN")!;
    const sat: RealService[] = ["06:29", "07:33", "08:33"].map((time) => ({ departDate: "2026-11-07", time, durationMin: 132, operator: "VT", estimated: false }));
    const timetable = new Map([["EUS-MAN", new Map([["2026-11-07", sat]])]]);
    const onSat = servicesFor(route, false, "2026-11-21", timetable);
    expect(onSat.map((s) => s.time)).toEqual(["06:29", "07:33", "08:33"]);
    expect(onSat[0]).toMatchObject({ origin: "EUS", destination: "MAN", departAt: "2026-11-21T06:29:00Z", arriveAt: "2026-11-21T08:41:00Z", weekday: 6 });
    // No real Sunday yet, and a weekend never borrows another day: the modelled pattern stands in.
    expect(servicesFor(route, false, "2026-11-22", timetable).map((s) => s.time.slice(3))).toContain("20");
    // The other direction has no real data at all.
    expect(servicesFor(route, true, "2026-11-21", timetable)[0]!.origin).toBe("MAN");
  });
});
