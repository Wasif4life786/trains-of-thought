import { z } from "zod";
import { addMinutes, londonToUtc, type Signal } from "@tot/shared";
import { bump, crowdSeverity, downStatus, fetchText, readRaw, report, slug, type Adapter } from "../util";
import { parseVenues, type Venue } from "./events";

const ID = "ticketmaster";
const NAME = "Ticketmaster Discovery (real concerts and events)";

// Shape from the public Discovery API docs (developer.ticketmaster.com). Needs TICKETMASTER_API_KEY, so this is exercised by
// its tests on a hand-written sample; it has not been run against the live API.
const Feed = z.object({
  _embedded: z
    .object({
      events: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          dates: z.object({ start: z.object({ localDate: z.string().optional(), localTime: z.string().optional() }) }),
          classifications: z.array(z.object({ segment: z.object({ name: z.string().optional() }).optional() })).optional(),
          _embedded: z.object({ venues: z.array(z.object({ name: z.string() })).optional() }).optional(),
        }),
      ),
    })
    .optional(),
});

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Discovery API events at venues we know near our stations → signals, like the curated events. */
export function buildTicketmaster(json: string, venues: Map<string, Venue>): { signals: Signal[]; quality: ReturnType<typeof report> } {
  const events = Feed.parse(JSON.parse(json))._embedded?.events ?? [];
  const dropped: Record<string, number> = {};
  const fixed: Record<string, number> = {};
  const signals: Signal[] = [];
  const seen = new Set<string>();

  for (const e of events) {
    const venueName = e._embedded?.venues?.[0]?.name ?? "";
    const venue = venues.get(norm(venueName));
    if (!venue) {
      bump(dropped, "venue_not_near_our_stations");
      continue;
    }
    const date = e.dates.start.localDate;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      bump(dropped, "bad_date");
      continue;
    }
    if (seen.has(e.id)) {
      bump(dropped, "duplicate");
      continue;
    }
    seen.add(e.id);
    let time = e.dates.start.localTime?.slice(0, 5);
    if (!time) {
      time = "19:00";
      bump(fixed, "start_time_defaulted");
    }
    const start = londonToUtc(date, time);
    const music = e.classifications?.[0]?.segment?.name?.toLowerCase() === "music";
    signals.push({
      id: `${ID}:${e.id}`,
      kind: music ? "concert" : "event",
      title: `${e.name} at ${venue.venue}`,
      detail: `Starts ${time} · capacity ${venue.capacity.toLocaleString("en-GB")}`,
      source: ID,
      start: addMinutes(start, -180),
      end: addMinutes(start, 240),
      place: { name: venue.venue, lat: venue.lat, lon: venue.lon },
      scope: { stations: venue.stations, operators: [], nationwide: false },
      severity: crowdSeverity(venue.capacity, "event"),
      confidence: 0.85,
      metrics: { capacity: venue.capacity },
      url: `https://www.ticketmaster.co.uk/event/${slug(e.id)}`,
    });
  }
  return { signals, quality: report(events.length, fixed, dropped) };
}

/** Only registered when TICKETMASTER_API_KEY is set (see index.ts): without a key there is nothing to read. */
export const ticketmaster: Adapter = async (ctx) => {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return { signals: [], statuses: [] };
  const from = ctx.now.toISOString().slice(0, 19) + "Z";
  const to = new Date(ctx.now.getTime() + 30 * 86_400_000).toISOString().slice(0, 19) + "Z";
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?countryCode=GB&size=200&sort=date,asc&startDateTime=${from}&endDateTime=${to}&apikey=${key}`;
  const got = await fetchText(ID, url, "ticketmaster-events.json", ctx);
  if (!got) return { signals: [], statuses: [downStatus(ID, NAME, "No live data or cache available")] };
  const { signals, quality } = buildTicketmaster(got.text, parseVenues(readRaw("venues.csv")));
  return { signals, statuses: [{ id: ID, name: NAME, lane: "signals", mode: got.mode, ...(got.fetchedAt ? { fetchedAt: got.fetchedAt } : {}), quality }] };
};
