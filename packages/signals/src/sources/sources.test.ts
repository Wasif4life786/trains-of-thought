import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SignalSchema } from "@tot/shared";
import { RAW_PATH, readRaw } from "../util";
import { SCOTTISH_STATIONS, parseBankHolidays } from "./bank-holidays";
import { buildDisruptions, operatorCode } from "./disruptions";
import { buildEvents, parseEventDate, parseEventTime, parseVenues } from "./events";
import { buildFootball, normaliseTeam, parseStadiums } from "./football";
import { buildWeather, hazardFor } from "./weather";

const ALL = z.array(SignalSchema);
const invariant = (q: { rowsIn: number; rowsOut: number; dropped: Record<string, number> }) => expect(q.rowsIn - q.rowsOut).toBe(Object.values(q.dropped).reduce((a, b) => a + b, 0));

describe("bank holidays", () => {
  const feed = JSON.stringify({
    "england-and-wales": { events: [{ title: "Christmas Day", date: "2026-12-25" }, { title: "New Year’s Day", date: "2027-01-01" }] },
    scotland: { events: [{ title: "Christmas Day", date: "2026-12-25" }, { title: "St Andrew’s Day", date: "2026-11-30" }] },
    "northern-ireland": { events: [{ title: "St Patrick’s Day", date: "2027-03-17" }] },
  });

  it("makes England & Wales holidays nationwide and Scotland-only ones Scottish, and skips the rest", () => {
    const { signals, quality } = parseBankHolidays(feed);
    ALL.parse(signals);
    expect(signals.map((s) => s.id)).toEqual([
      "gov-uk-bank-holidays:england-and-wales:2026-12-25",
      "gov-uk-bank-holidays:england-and-wales:2027-01-01",
      "gov-uk-bank-holidays:scotland:2026-11-30",
    ]);
    expect(signals[0]!.scope).toEqual({ stations: [], operators: [], nationwide: true });
    expect(signals[2]).toMatchObject({ title: "St Andrew's Day (Scotland)", scope: { stations: SCOTTISH_STATIONS, nationwide: false } });
    expect(quality.dropped).toEqual({ merged_into_england_and_wales: 1, northern_ireland_out_of_scope: 1 });
    expect(quality.fixed.curly_apostrophe_normalised).toBe(2);
    invariant(quality);
  });

  it("covers the London day, in winter and summer", () => {
    const winter = parseBankHolidays(feed).signals[0]!;
    expect([winter.start, winter.end]).toEqual(["2026-12-25T00:00:00Z", "2026-12-25T23:59:00Z"]);
    const summer = parseBankHolidays(JSON.stringify({ "england-and-wales": { events: [{ title: "Summer bank holiday", date: "2027-08-30" }] } })).signals[0]!;
    expect([summer.start, summer.end]).toEqual(["2027-08-29T23:00:00Z", "2027-08-30T22:59:00Z"]);
  });

  it("reads the real GOV.UK file", () => {
    const { signals, quality } = parseBankHolidays(readRaw("bank-holidays.json"));
    ALL.parse(signals);
    expect(signals.length).toBeGreaterThan(100);
    invariant(quality);
  });

  it("only uses Scottish stations that exist", () => {
    const stations = new Set((JSON.parse(readFileSync(`${RAW_PATH}../rail/stations.json`, "utf8")) as { crsCode: string }[]).map((s) => s.crsCode));
    for (const crs of SCOTTISH_STATIONS) expect(stations.has(crs), crs).toBe(true);
  });
});

describe("weather", () => {
  it("rates an hour by its worst hazard, with the rubric's bands", () => {
    expect(hazardFor(10, 0, 0, 10)).toBeNull();
    expect(hazardFor(70, 0, 0, 10)).toMatchObject({ cause: "gusts", severity: 0.2 }); // 43 mph
    expect(hazardFor(85, 0, 0, 10)).toMatchObject({ cause: "gusts", severity: 0.6 }); // 53 mph
    expect(hazardFor(100, 0, 0, 10)).toMatchObject({ severity: 0.8 }); // 62 mph
    expect(hazardFor(120, 0, 0, 10)).toMatchObject({ severity: 1 }); // 75 mph
    expect(hazardFor(10, 3, 0, 10)).toMatchObject({ cause: "rain", severity: 0.2 });
    expect(hazardFor(10, 9, 0, 10)).toMatchObject({ cause: "rain", severity: 0.6 });
    expect(hazardFor(10, 0, 1.5, 0)).toMatchObject({ cause: "snow", severity: 0.6 });
    expect(hazardFor(10, 0, 0, 31)).toMatchObject({ cause: "heat", severity: 0.6 });
    expect(hazardFor(100, 9, 0, 10)).toMatchObject({ cause: "gusts" }); // the worse of two
  });

  /** A forecast of 12 hours from 15:00 on 20 Nov where `gusts` are km/h, one value per hour. */
  const forecast = (gusts: (number | null)[]) => [
    {
      hourly: {
        time: gusts.map((_, i) => `2026-11-20T${String(15 + i).padStart(2, "0")}:00`),
        temperature_2m: gusts.map(() => 5),
        precipitation: gusts.map(() => 0),
        wind_gusts_10m: gusts,
        snowfall: gusts.map(() => 0),
      },
    },
  ];
  const point = { id: "manchester", name: "Manchester", lat: 53.48, lon: -2.23, stations: ["MAN", "SPT"] };
  const asOf = new Date("2026-11-07T00:00:00Z");

  it("merges the hours above a threshold into one window, bridging a one-hour gap, plus an hour to recover", () => {
    const { signals, quality } = buildWeather([point], forecast([10, 10, 90, 100, 10, 95, 10, 10]), asOf);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: "open-meteo:manchester:2026-11-20T17:gusts",
      kind: "weather",
      start: "2026-11-20T17:00:00Z",
      end: "2026-11-20T22:00:00Z", // last bad hour is 20:00, which ends at 21:00, plus an hour
      severity: 0.8,
      scope: { stations: ["MAN", "SPT"], operators: [], nationwide: false },
    });
    expect(signals[0]!.metrics!.windGustMph).toBeGreaterThan(60);
    expect(quality.dropped).toEqual({ below_threshold: 5, merged_into_window: 2 });
    invariant(quality);
    ALL.parse(signals);
  });

  it("keeps separate windows apart, and drops hours before the forecast time and missing values", () => {
    const { signals, quality } = buildWeather([point], forecast([90, 10, 10, 10, 10, 90, null]), new Date("2026-11-20T15:00:00Z"));
    expect(signals).toHaveLength(2);
    expect(quality.dropped.missing_values).toBe(1);
    const later = buildWeather([point], forecast([90, 10, 10, 10, 10, 90, 10]), new Date("2026-11-20T18:00:00Z"));
    expect(later.signals).toHaveLength(1);
    expect(later.quality.dropped.past_hours).toBe(3);
    invariant(later.quality);
  });

  it("trusts a forecast less the further ahead it looks", () => {
    const near = buildWeather([point], forecast([90]), new Date("2026-11-20T12:00:00Z")).signals[0]!;
    const far = buildWeather([point], forecast([90]), new Date("2026-11-04T12:00:00Z")).signals[0]!;
    expect(near.confidence).toBeGreaterThan(far.confidence);
    expect(far.confidence).toBeLessThanOrEqual(0.3);
  });

  it("reads the real forecast snapshot: calm on the demo weekend, a gale at Bristol on 17 Nov", () => {
    const points = (JSON.parse(readRaw("weather-points.json")) as { points: (typeof point)[] }).points;
    const real = JSON.parse(readRaw("open-meteo-forecast.json")) as ReturnType<typeof forecast>;
    const { signals, quality } = buildWeather(points, real, new Date(`${real[0]!.hourly.time[0]}:00Z`));
    ALL.parse(signals);
    expect(quality.rowsIn).toBe(points.length * 384);
    invariant(quality);
    expect(signals.some((s) => s.id.startsWith("open-meteo:bristol:2026-11-17"))).toBe(true);
    expect(signals.filter((s) => s.start >= "2026-11-20T00:00:00Z" && s.start <= "2026-11-22T23:59:59Z")).toEqual([]);
  });
});

describe("football", () => {
  const clubs = parseStadiums(readRaw("stadiums.csv"));
  const season = (matches: object[]) => ({ matches });

  it("knows every spelling of a club", () => {
    expect(normaliseTeam("Brighton & Hove Albion FC")).toBe(normaliseTeam("Brighton and Hove Albion"));
    expect(clubs.get(normaliseTeam("Manchester City FC"))?.stadium).toBe("Etihad Stadium");
    expect(clubs.get(normaliseTeam("Man Utd"))?.stadium).toBe("Old Trafford");
  });

  it("turns a fixture into a signal at the home ground, kick-off ± 3 hours", () => {
    const { signals, football } = buildFootball(season([{ date: "2026-11-21", time: "15:00", team1: "Manchester City FC", team2: "Fulham FC" }]), { events: [] }, clubs);
    expect(signals[0]).toMatchObject({
      id: "openfootball:2026-11-21:manchester-city-v-fulham",
      kind: "football",
      title: "Man City v Fulham",
      start: "2026-11-21T12:00:00Z",
      end: "2026-11-21T18:00:00Z",
      severity: 0.8,
      confidence: 0.6,
      scope: { stations: ["ABY", "MAN", "MCV"], operators: [], nationwide: false },
      metrics: { capacity: 53400 },
    });
    expect(signals[0]!.detail).toContain("provisional");
    invariant(football);
  });

  it("converts a summer kick-off from London time", () => {
    const { signals } = buildFootball(season([{ date: "2027-05-15", time: "15:00", team1: "Arsenal FC", team2: "Chelsea FC" }]), { events: [] }, clubs);
    expect(signals[0]!.start).toBe("2027-05-15T11:00:00Z");
  });

  it("rates derbies at the top, and big crowds above small ones", () => {
    const { signals } = buildFootball(
      season([
        { date: "2026-11-21", time: "12:30", team1: "Liverpool FC", team2: "Everton FC" },
        { date: "2026-11-21", time: "15:00", team1: "AFC Bournemouth", team2: "Fulham FC" },
      ]),
      { events: [] },
      clubs,
    );
    expect(signals[0]).toMatchObject({ title: "Liverpool v Everton (derby)", severity: 1 });
    expect(signals[1]!.severity).toBe(0.2);
  });

  it("moves a kick-off to the TV time when TheSportsDB disagrees, and trusts it more", () => {
    const matches = season([
      { date: "2026-11-07", time: "15:00", team1: "Brighton & Hove Albion FC", team2: "Brentford FC" },
      { date: "2026-11-21", time: "15:00", team1: "Manchester City FC", team2: "Fulham FC" },
    ]);
    const tv = { events: [{ strTimestamp: "2026-11-08T14:00:00", strHomeTeam: "Brighton and Hove Albion", strAwayTeam: "Brentford" }, { strTimestamp: "2026-11-21T15:00:00", strHomeTeam: "Manchester City", strAwayTeam: "Fulham" }] };
    const { signals, football, crossCheck } = buildFootball(matches, tv, clubs);
    expect(signals[0]).toMatchObject({ start: "2026-11-08T11:00:00Z", confidence: 0.8 });
    expect(signals[1]).toMatchObject({ start: "2026-11-21T12:00:00Z", confidence: 0.85 });
    expect(football.fixed.kickoff_moved_for_tv).toBe(1);
    expect(crossCheck).toMatchObject({ rowsIn: 2, rowsOut: 0, dropped: { merged_into_openfootball: 2 } });
    invariant(crossCheck);
  });

  it("drops a fixture whose teams it doesn't know, saying why", () => {
    const { signals, football } = buildFootball(season([{ date: "2026-11-21", time: "15:00", team1: "Nowhere Rovers", team2: "Fulham FC" }]), { events: [] }, clubs);
    expect(signals).toEqual([]);
    expect(football.dropped).toEqual({ unknown_team: 1 });
  });

  it("reads the real fixture list: every match placed at a ground, and the stations exist", () => {
    const { signals, football } = buildFootball(JSON.parse(readRaw("openfootball-en1-2026-27.json")), JSON.parse(readRaw("thesportsdb-epl-next.json")), clubs);
    expect(signals).toHaveLength(380);
    expect(football.dropped).toEqual({});
    ALL.parse(signals);
    const stations = new Set((JSON.parse(readFileSync(`${RAW_PATH}../rail/stations.json`, "utf8")) as { crsCode: string }[]).map((s) => s.crsCode));
    for (const club of new Set(clubs.values())) for (const crs of club.stations) expect(stations.has(crs), `${club.club}: ${crs}`).toBe(true);
  });
});

describe("events", () => {
  const venues = parseVenues(readRaw("venues.csv"));

  it("reads messy dates and times", () => {
    expect(parseEventDate("2026-11-21")).toEqual({ date: "2026-11-21", fix: null });
    expect(parseEventDate("21/11/2026")).toEqual({ date: "2026-11-21", fix: "ddmmyyyy_dates" });
    expect(parseEventDate("Sun 22 Nov 2026")).toEqual({ date: "2026-11-22", fix: "text_dates" });
    expect(parseEventDate("31/02/2026")).toBeNull();
    expect(parseEventDate("soon")).toBeNull();
    expect([parseEventTime("19:30"), parseEventTime("7.30pm"), parseEventTime("7pm"), parseEventTime("12am"), parseEventTime("")]).toEqual(["19:30", "19:30", "19:00", "00:00", null]);
  });

  it("cleans the curated list, counting every repair and every dropped row", () => {
    const { signals, quality } = buildEvents(readRaw("events.csv"), venues);
    ALL.parse(signals);
    expect(quality.dropped).toEqual({ duplicate: 1, unknown_venue: 1, bad_date: 1 });
    expect(quality.fixed).toMatchObject({ venue_alias_resolved: 1, start_time_defaulted: 1, time_normalised: 1 });
    invariant(quality);
    const concert = signals.find((s) => s.id.includes("co-op-live") && s.start.startsWith("2026-11-21"))!;
    expect(concert).toMatchObject({ kind: "concert", title: "Sold-out arena concert at Co-op Live (sample)", start: "2026-11-21T16:30:00Z", end: "2026-11-21T23:30:00Z", severity: 0.6 });
  });

  it("labels every invented event as a sample", () => {
    for (const s of buildEvents(readRaw("events.csv"), venues).signals) expect(s.title).toMatch(/\(sample\)$/);
  });
});

describe("strikes and engineering works", () => {
  it("maps operator names, however they're written, to ATOC codes", () => {
    expect([operatorCode("Avanti West Coast"), operatorCode("TPE"), operatorCode("London North Eastern Railway"), operatorCode("GW"), operatorCode("Imaginary Rail")]).toEqual(["VT", "TP", "GR", "GW", null]);
  });

  it("keeps engineering works as published and stretches a strike to the morning after", () => {
    const { signals, quality } = buildDisruptions(readRaw("disruptions.json"));
    ALL.parse(signals);
    expect(quality.dropped).toEqual({ cancelled: 1 });
    invariant(quality);
    const works = signals.find((s) => s.title.startsWith("Engineering works Milton Keynes"))!;
    expect(works).toMatchObject({ kind: "engineering_works", start: "2026-11-22T00:00:00Z", end: "2026-11-22T14:00:00Z", severity: 0.6, scope: { operators: ["VT", "LN"], nationwide: false } });
    const strike = signals.find((s) => s.kind === "strike")!;
    expect(strike).toMatchObject({ start: "2026-11-27T00:00:00Z", end: "2026-11-28T09:59:00Z", severity: 0.8, scope: { stations: [], operators: ["TP"], nationwide: true } });
  });

  it("says (sample) on everything invented", () => {
    for (const s of buildDisruptions(readRaw("disruptions.json")).signals) expect(s.title).toMatch(/\(sample\)$/);
  });
});
