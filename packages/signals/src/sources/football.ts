import { z } from "zod";
import { addMinutes, londonToUtc, utcToLondon, type Signal, type SourceStatus } from "@tot/shared";
import { bump, crowdSeverity, downStatus, fetchText, parseCsv, readRaw, report, slug, type Adapter } from "../util";

const OPENFOOTBALL = "openfootball";
const SPORTSDB = "thesportsdb";
const OPENFOOTBALL_URL = "https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json";
const SPORTSDB_URL = "https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=4328";

export interface Club {
  club: string;
  short: string;
  stadium: string;
  lat: number;
  lon: number;
  capacity: number;
  stations: string[];
}

/** "Brighton & Hove Albion FC" and "Brighton and Hove Albion" are the same team. */
export const normaliseTeam = (name: string): string =>
  name.toLowerCase().replace(/&/g, " and ").replace(/\b(fc|afc)\b/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Every spelling of every club → the club. */
export function parseStadiums(text: string): Map<string, Club> {
  const byName = new Map<string, Club>();
  for (const row of parseCsv(text).slice(1)) {
    const [club, aliases = "", short, stadium, lat, lon, capacity, stations = ""] = row.map((c) => c.trim());
    if (!club || !short || !stadium) continue;
    const entry: Club = { club, short, stadium, lat: Number(lat), lon: Number(lon), capacity: Number(capacity), stations: stations.split("|").filter(Boolean) };
    for (const name of [club, ...aliases.split("|")]) if (name) byName.set(normaliseTeam(name), entry);
  }
  return byName;
}

const Season = z.object({ matches: z.array(z.object({ date: z.string(), time: z.string().nullish(), team1: z.string(), team2: z.string() })) });
const SportsDb = z.object({ events: z.array(z.object({ strTimestamp: z.string().nullable(), strHomeTeam: z.string(), strAwayTeam: z.string() })).nullable() });

/** Pairs of clubs whose meetings fill every train: severity goes straight to the top. */
const DERBIES = [
  ["Liverpool", "Everton"],
  ["Manchester City", "Manchester United"],
  ["Arsenal", "Tottenham Hotspur"],
  ["Newcastle United", "Sunderland"],
  ["Chelsea", "Tottenham Hotspur"],
  ["Arsenal", "Chelsea"],
  ["Crystal Palace", "Brighton & Hove Albion"],
] as const;
const isDerby = (a: string, b: string) => DERBIES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

const hhmm = (iso: string) => utcToLondon(iso).time;

export interface FootballResult {
  signals: Signal[];
  football: ReturnType<typeof report>;
  /** How the cross-check source fared: its events, how many moved a kick-off, how many were merged into the fixture list. */
  crossCheck: ReturnType<typeof report>;
}

/**
 * The season's fixtures → one signal per match at the home ground. Kick-offs are local time and provisional until the
 * TV picks are made, so TheSportsDB's timestamps (UTC, TV-adjusted) override them where the two sources disagree.
 */
export function buildFootball(season: unknown, sportsDb: unknown, clubs: Map<string, Club>): FootballResult {
  const { matches } = Season.parse(season);
  const events = SportsDb.parse(sportsDb).events ?? [];
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const checkFixed: Record<string, number> = {};
  const signals: Signal[] = [];

  // What the cross-check source says about each fixture, keyed by the two clubs.
  const tv = new Map<string, string>();
  for (const e of events) {
    const home = clubs.get(normaliseTeam(e.strHomeTeam));
    const away = clubs.get(normaliseTeam(e.strAwayTeam));
    if (home && away && e.strTimestamp) tv.set(`${home.club}|${away.club}`, `${e.strTimestamp.slice(0, 19)}Z`);
  }

  for (const m of matches) {
    const home = clubs.get(normaliseTeam(m.team1));
    const away = clubs.get(normaliseTeam(m.team2));
    if (!home || !away) {
      bump(dropped, "unknown_team");
      continue;
    }
    bump(fixed, "team_alias_resolved", 2);
    bump(fixed, "kickoff_assumed_london_time");
    if (!m.time) bump(fixed, "kickoff_time_defaulted");
    let kickoff = londonToUtc(m.date, m.time ?? "15:00");
    let confidence = 0.6;

    const key = `${home.club}|${away.club}`;
    const confirmed = tv.get(key);
    if (confirmed && Math.abs(Date.parse(confirmed) - Date.parse(kickoff)) <= 3 * 86_400_000) {
      if (confirmed !== kickoff) {
        kickoff = confirmed as typeof kickoff;
        bump(fixed, "kickoff_moved_for_tv");
        bump(checkFixed, "kickoff_moved_for_tv");
        confidence = 0.8;
      } else confidence = 0.85;
    }

    const derby = isDerby(home.club, away.club);
    const provisional = confidence <= 0.6;
    signals.push({
      id: `${OPENFOOTBALL}:${m.date}:${slug(home.club)}-v-${slug(away.club)}`,
      kind: "football",
      title: `${home.short} v ${away.short}${derby ? " (derby)" : ""}`,
      detail: `${home.stadium} · kick-off ${hhmm(kickoff)}${provisional ? " (provisional)" : ""} · ${home.capacity.toLocaleString("en-GB")} seats`,
      source: OPENFOOTBALL,
      start: addMinutes(kickoff, -180),
      end: addMinutes(kickoff, 180),
      place: { name: home.stadium, lat: home.lat, lon: home.lon },
      scope: { stations: home.stations, operators: [], nationwide: false },
      severity: derby ? 1 : crowdSeverity(home.capacity, "match"),
      confidence,
      metrics: { capacity: home.capacity },
    });
  }

  const merged = events.filter((e) => clubs.has(normaliseTeam(e.strHomeTeam)) && clubs.has(normaliseTeam(e.strAwayTeam))).length;
  const checkDropped: Record<string, number> = {};
  if (merged > 0) bump(checkDropped, "merged_into_openfootball", merged);
  if (events.length - merged > 0) bump(checkDropped, "unknown_team", events.length - merged);
  return { signals, football: report(matches.length, fixed, dropped), crossCheck: report(events.length, checkFixed, checkDropped) };
}

export const football: Adapter = async (ctx) => {
  const [season, check] = await Promise.all([
    fetchText(OPENFOOTBALL, OPENFOOTBALL_URL, "openfootball-en1-2026-27.json", ctx),
    fetchText(SPORTSDB, SPORTSDB_URL, "thesportsdb-epl-next.json", ctx),
  ]);
  if (!season) return { signals: [], statuses: [downStatus(OPENFOOTBALL, "openfootball Premier League 2026/27", "No live data, cache or seed available")] };
  const clubs = parseStadiums(readRaw("stadiums.csv"));
  const { signals, football: footballQuality, crossCheck } = buildFootball(JSON.parse(season.text), check ? JSON.parse(check.text) : { events: [] }, clubs);
  const status = (id: string, name: string, got: typeof season | null, quality: typeof footballQuality, note?: string): SourceStatus =>
    got
      ? { id, name, lane: "signals", mode: got.mode, ...(got.fetchedAt ? { fetchedAt: got.fetchedAt } : {}), quality, ...(note ? { note } : {}) }
      : downStatus(id, name, "No live data, cache or seed available");
  return {
    signals,
    statuses: [
      status(OPENFOOTBALL, "openfootball Premier League 2026/27", season, footballQuality, "Kick-offs are provisional until TV picks are made"),
      status(SPORTSDB, "TheSportsDB (TV-adjusted kick-offs)", check, crossCheck, "Free test key: only a handful of upcoming matches"),
    ],
  };
};
