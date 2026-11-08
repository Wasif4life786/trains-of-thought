import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SignalSchema } from "@tot/shared";
import { readRaw } from "../util";
import { parseVenues } from "./events";
import { buildFootball, parseStadiums } from "./football";
import { buildLeafFall } from "./seasonal";
import { buildTicketmaster } from "./ticketmaster";
import { buildTfl } from "./tfl";
import { buildWeather } from "./weather";

const ALL = z.array(SignalSchema);
const invariant = (q: { rowsIn: number; rowsOut: number; dropped: Record<string, number> }) => expect(q.rowsIn - q.rowsOut).toBe(Object.values(q.dropped).reduce((a, b) => a + b, 0));
const NOW = new Date("2026-11-08T09:00:00Z");

describe("TfL line status", () => {
  const status = (id: string, sev: number, desc: string, periods?: { fromDate: string; toDate: string }[]) => ({ id, name: id, lineStatuses: [{ statusSeverity: sev, statusSeverityDescription: desc, reason: "  Part   closure \n tonight ", validityPeriods: periods }] });

  it("turns planned closures into low-severity 'other' signals scoped to the termini, one per period", () => {
    const feed = JSON.stringify([
      status("bakerloo", 5, "Part Closure", [{ fromDate: "2026-11-21T04:30:00Z", toDate: "2026-11-23T01:29:00Z" }]),
      status("victoria", 10, "Good Service"),
      status("district", 9, "Minor Delays"),
      status("dlr", 6, "Severe Delays"),
    ]);
    const { signals, quality } = buildTfl(feed, NOW);
    ALL.parse(signals);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({ kind: "other", start: "2026-11-21T04:30:00Z", end: "2026-11-23T01:29:00Z", severity: 0.2, confidence: 0.9, scope: { stations: ["PAD", "EUS"], nationwide: false } });
    expect(signals[0]!.detail).toBe("Part closure tonight");
    expect(signals[1]).toMatchObject({ severity: 0.1, confidence: 0.6 });
    expect(quality.dropped).toEqual({ good_service: 1, line_not_near_our_termini: 1 });
    expect(quality.fixed).toMatchObject({ open_ended_status_given_a_window: 1, reason_text_tidied: 2 });
    invariant(quality);
  });

  it("gives a status with no published period a three-hour window from now", () => {
    const [s] = buildTfl(JSON.stringify([status("northern", 6, "Severe Delays")]), NOW).signals;
    expect([s!.start, s!.end]).toEqual(["2026-11-08T09:00:00Z", "2026-11-08T12:00:00Z"]);
  });

  it("reads the recorded real response, including the Bakerloo closure on 21–22 Nov", () => {
    const { signals, quality } = buildTfl(readRaw("tfl-status.json"), NOW);
    ALL.parse(signals);
    expect(signals.some((s) => s.id.startsWith("tfl-status:bakerloo:2026-11-21") && s.title.includes("part closure"))).toBe(true);
    invariant(quality);
  });
});

describe("Ticketmaster", () => {
  const venues = parseVenues(readRaw("venues.csv"));
  const event = (id: string, venue: string, extra: object = {}) => ({
    id, name: "Big Gig", dates: { start: { localDate: "2026-11-21", localTime: "19:30:00" } }, classifications: [{ segment: { name: "Music" } }], _embedded: { venues: [{ name: venue }] }, ...extra,
  });

  it("turns events at venues near our stations into concert signals", () => {
    const feed = JSON.stringify({ _embedded: { events: [event("a1", "Co-op Live"), event("a1", "Co-op Live"), event("b2", "Nowhere Arena"), event("c3", "AO Arena", { dates: { start: { localDate: "2026-11-28" } }, classifications: [{ segment: { name: "Sports" } }] })] } });
    const { signals, quality } = buildTicketmaster(feed, venues);
    ALL.parse(signals);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({ id: "ticketmaster:a1", kind: "concert", title: "Big Gig at Co-op Live", start: "2026-11-21T16:30:00Z", end: "2026-11-21T23:30:00Z", severity: 0.6, scope: { stations: ["ABY", "MAN", "MCV"] } });
    expect(signals[1]).toMatchObject({ kind: "event", start: "2026-11-28T16:00:00Z" });
    expect(quality.dropped).toEqual({ duplicate: 1, venue_not_near_our_stations: 1 });
    expect(quality.fixed).toEqual({ start_time_defaulted: 1 });
    invariant(quality);
  });

  it("matches Ticketmaster's own venue names nearby, but not every bar next to an arena", () => {
    const at = (name: string, latitude: string, longitude: string) => ({ venues: [{ name, location: { latitude, longitude } }] });
    const feed = JSON.stringify({
      _embedded: {
        events: [
          event("v1", "", { _embedded: at("Leeds First Direct Bank Arena", "53.804616", "-1.544073") }), // real name and spot (2026-11-08)
          event("v2", "", { _embedded: at("O2 Academy Leeds", "53.8030", "-1.5470") }), // a different, smaller venue next door
          event("v3", "", { _embedded: at("First Direct Arena", "51.50", "-0.12"), dates: { start: { localDate: "2026-11-22", localTime: "19:30:00" } } }), // exact name: matched by name alone
        ],
      },
    });
    const { signals, quality } = buildTicketmaster(feed, venues);
    expect(signals.map((s) => s.id)).toEqual(["ticketmaster:v1", "ticketmaster:v3"]);
    expect(signals[0]).toMatchObject({ title: "Big Gig at First Direct Arena", scope: { stations: ["LDS"] } });
    expect(quality.fixed).toEqual({ venue_name_variant_matched: 1 });
    expect(quality.dropped).toEqual({ venue_not_near_our_stations: 1 });
    invariant(quality);
  });

  it("counts a show once, keeping its plain name, when add-ons are listed as separate events", () => {
    const feed = JSON.stringify({
      _embedded: { events: [event("p1", "AO Arena", { name: "Noah Kahan - Venue Premium Packages" }), event("p2", "AO Arena", { name: "Noah Kahan - The Great Divide Tour" }), event("p3", "AO Arena", { name: "Official Parking" })] },
    });
    const { signals, quality } = buildTicketmaster(feed, venues);
    expect(signals.map((s) => s.title)).toEqual(["Noah Kahan - The Great Divide Tour at AO Arena"]);
    expect(quality.dropped).toEqual({ same_show_listed_twice: 2 });
    invariant(quality);
  });

  it("copes with no events at all", () => {
    expect(buildTicketmaster("{}", venues)).toMatchObject({ signals: [], quality: { rowsIn: 0, rowsOut: 0 } });
  });
});

describe("autumn leaf-fall", () => {
  it("covers every morning of 1 Oct – 30 Nov, in London time", () => {
    const { signals } = buildLeafFall([2026]);
    ALL.parse(signals);
    expect(signals).toHaveLength(61);
    expect(signals.find((s) => s.id.endsWith("2026-10-01"))).toMatchObject({ start: "2026-10-01T04:00:00Z", end: "2026-10-01T09:00:00Z" }); // BST
    expect(signals.find((s) => s.id.endsWith("2026-11-21"))).toMatchObject({ start: "2026-11-21T05:00:00Z", end: "2026-11-21T10:00:00Z", kind: "weather", severity: 0.2, confidence: 0.4 });
  });
});

describe("away-fan flows", () => {
  const clubs = parseStadiums(readRaw("stadiums.csv"));
  const match = (home: string, away: string) => ({ matches: [{ date: "2026-11-21", time: "15:00", team1: home, team2: away }] });

  it("adds a lower-severity signal on the away club's city stations in the hours before kick-off", () => {
    const { signals, football } = buildFootball(match("Liverpool FC", "Manchester United FC"), { events: [] }, clubs);
    const away = signals.find((s) => s.id.endsWith(":away-fans"))!;
    expect(away).toMatchObject({
      id: "openfootball:2026-11-21:liverpool-v-manchester-united:away-fans",
      kind: "football",
      title: "Man Utd fans travelling to Liverpool",
      start: "2026-11-21T10:00:00Z",
      end: "2026-11-21T14:00:00Z",
      severity: 0.3,
      scope: { stations: ["MAN", "MCV"], nationwide: false },
    });
    expect(away.confidence).toBeLessThan(signals[0]!.confidence);
    expect(football.fixed.away_fan_signal_added).toBe(1);
  });

  it("makes derbies bigger and small clubs' supporters smaller", () => {
    expect(buildFootball(match("Manchester City FC", "Manchester United FC"), { events: [] }, clubs).signals[1]!.severity).toBe(0.5);
    expect(buildFootball(match("Manchester City FC", "Fulham FC"), { events: [] }, clubs).signals[1]).toMatchObject({ severity: 0.2, scope: { stations: ["EUS", "KGX", "PAD"] } });
  });
});

describe("observed weather", () => {
  it("can be given a fixed confidence instead of one that falls with lead time", () => {
    const h = { time: ["2026-10-04T10:00", "2026-10-04T11:00"], temperature_2m: [8, 8], precipitation: [0, 0], wind_gusts_10m: [90, 90], snowfall: [0, 0] };
    const point = { id: "london", name: "London", lat: 51.5, lon: -0.1, stations: ["EUS"] };
    const forecast = buildWeather([point], [{ hourly: h }], new Date("2026-10-01T00:00:00Z"));
    const observed = buildWeather([point], [{ hourly: h }], new Date("2026-10-01T00:00:00Z"), { confidence: 0.95 });
    expect(forecast.signals[0]!.confidence).toBeLessThan(0.95);
    expect(observed.signals[0]!.confidence).toBe(0.95);
  });
});
