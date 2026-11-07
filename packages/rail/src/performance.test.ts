import { describe, expect, it } from "vitest";
import { buildBaseline, cleanPerformance, loadPerformance, type Observation } from "./performance";
import { loadRoutes } from "./routes";
import { loadStations } from "./stations";

const stations = loadStations();
const known = new Set(["EUS-MAN", "MAN-EUS"]);

describe("cleanPerformance", () => {
  const messy = [
    "route,date,planned,delay,status",
    "EUS-MAN,2026-05-01,09:00,3,ON TIME",
    "eus-man,01/05/2026,9:20,5 mins,",
    "London Euston to Manchester Piccadilly,1 May 2026,0940,,ON TIME",
    "EUS-MAN,2026-05-01,10:00,cancelled,CANCELLED",
    "EUS-MAN,2026-05-01,10:00,7,ON TIME",
    "EUS-MAN,2026-05-01,11:00,-,",
    "EUS-MAN,2026-05-01,12:00,,LATE",
    "",
    "EUS-MAN,not a date,12:00,1,",
    "EUS-MAN,2026-05-01,25:99,1,",
    "EUS-ZZZ,2026-05-01,09:00,3,ON TIME",
    "route,date,planned,delay,status",
    "EUS-MAN,2026-05-02,09:00,-2,",
  ].join("\n");

  it("repairs what it can and says what it repaired", () => {
    const { observations, quality } = cleanPerformance(messy, stations, known);
    expect(observations).toHaveLength(5);
    expect(quality.fixed).toEqual({
      route_code_normalised: 1,
      date_ddmmyyyy_to_iso: 1,
      time_normalised: 2,
      delay_parsed_from_text: 1,
      route_name_to_crs: 1,
      date_text_to_iso: 1,
      delay_inferred_from_status: 1,
      early_clamped_to_zero: 1,
    });
  });

  it("drops what it can't trust, with a reason for every row", () => {
    const { quality } = cleanPerformance(messy, stations, known);
    expect(quality.dropped).toEqual({ duplicate: 1, missing_delay: 1, late_without_minutes: 1, blank_row: 1, bad_date: 1, bad_time: 1, unknown_route: 2 });
    expect(quality.rowsIn - quality.rowsOut).toBe(Object.values(quality.dropped).reduce((a, b) => a + b, 0));
  });

  it("reads the cleaned values correctly", () => {
    const { observations } = cleanPerformance(messy, stations, known);
    expect(observations[0]).toEqual({ route: "EUS-MAN", weekday: 5, hour: 9, delayMin: 3, cancelled: false });
    expect(observations[1]).toMatchObject({ weekday: 5, hour: 9, delayMin: 5 });
    expect(observations[3]).toMatchObject({ hour: 10, cancelled: true });
    expect(observations[4]).toMatchObject({ weekday: 6, delayMin: 0 });
  });
});

describe("baseline model", () => {
  const obs = (route: string, weekday: number, hour: number, delays: number[]): Observation[] => delays.map((delayMin) => ({ route, weekday, hour, delayMin, cancelled: false }));

  it("counts a train as on time when it's at most 15 minutes late, and cancellations as failures", () => {
    const model = buildBaseline([...obs("A-B", 2, 9, [0, 5, 15, 16, 40]), { route: "A-B", weekday: 2, hour: 9, delayMin: 0, cancelled: true }]);
    const b = model.get("A-B", 2, 9);
    expect(b.sampleSize).toBe(6);
    expect(b.cancelProb).toBeGreaterThan(0.02);
    expect(b.onTimeProb).toBeGreaterThan(0.5);
    expect(b.onTimeProb).toBeLessThan(0.85);
  });

  it("pulls a tiny sample toward the rest of the route instead of trusting it", () => {
    const quiet = Array.from({ length: 60 }, (_, i) => obs("A-B", 3, 8 + (i % 4), [0])).flat();
    const model = buildBaseline([...quiet, ...obs("A-B", 3, 15, [90])]);
    expect(model.get("A-B", 3, 15).onTimeProb).toBeGreaterThan(0.7);
    expect(model.get("A-B", 3, 9).onTimeProb).toBeGreaterThan(0.9);
  });

  it("falls back to a modelled guess where there's no data", () => {
    expect(buildBaseline([]).get("X-Y", 1, 12)).toMatchObject({ sampleSize: 0, onTimeProb: 0.85 });
  });
});

describe("the real history file", () => {
  const known = new Set(loadRoutes().flatMap((r) => [`${r.from}-${r.to}`, `${r.to}-${r.from}`]));
  const { model, quality } = loadPerformance(stations, known);

  it("is cleaned, with every discarded row accounted for", () => {
    expect(quality.rowsIn).toBeGreaterThan(10000);
    expect(quality.rowsOut).toBeGreaterThan(9000);
    expect(quality.rowsIn - quality.rowsOut).toBe(Object.values(quality.dropped).reduce((a, b) => a + b, 0));
    expect(Object.keys(quality.fixed).length).toBeGreaterThanOrEqual(6);
  });

  it("recovers the pattern the history was made from: Friday-evening trains are less punctual than Saturday-midday ones", () => {
    // One route and hour is too noisy to show a few points' difference, so average over every route and both directions.
    const mean = (weekday: number, hours: number[]) => {
      const values = [...known].flatMap((route) => hours.map((h) => model.get(route, weekday, h).onTimeProb));
      return values.reduce((a, b) => a + b, 0) / values.length;
    };
    expect(mean(5, [16, 17, 18])).toBeLessThan(mean(6, [10, 11, 12, 13]) - 0.04);
  });

  it("has data for every modelled route in both directions", () => {
    for (const route of known) expect(model.get(route, 3, 12).sampleSize, route).toBeGreaterThan(0);
  });
});
