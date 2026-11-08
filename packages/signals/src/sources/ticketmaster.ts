import { z } from "zod";
import { addMinutes, londonToUtc, type Signal } from "@tot/shared";
import { bump, crowdSeverity, downStatus, fetchText, readRaw, report, slug, type Adapter } from "../util";
import { parseVenues, type Venue } from "./events";

const ID = "ticketmaster";
const NAME = "Ticketmaster Discovery (real concerts and events)";

// Shape from the public Discovery API docs (developer.ticketmaster.com), checked against the live API on 2026-11-08.
// Needs TICKETMASTER_API_KEY; the tests use a hand-written sample.
const Feed = z.object({
  _embedded: z
    .object({
      events: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          dates: z.object({ start: z.object({ localDate: z.string().optional(), localTime: z.string().optional() }) }),
          classifications: z.array(z.object({ segment: z.object({ name: z.string().optional() }).optional() })).optional(),
          _embedded: z
            .object({
              venues: z
                .array(z.object({ name: z.string(), location: z.object({ latitude: z.string(), longitude: z.string() }).optional() }))
                .optional(),
            })
            .optional(),
        }),
      ),
    })
    .optional(),
});

/** Great-circle distance in km. */
function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/**
 * Ticketmaster names venues its own way ("Leeds First Direct Bank Arena"). A venue within 750 m matches when its name
 * contains every word of one of our multi-word names for it; distance alone would sweep in every bar next to an arena.
 */
const NEAR_KM = 0.75;

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Discovery API events at venues we know near our stations → signals, like the curated events. */
export function buildTicketmaster(json: string, venues: Map<string, Venue>): { signals: Signal[]; quality: ReturnType<typeof report> } {
  // Ticketmaster lists add-ons (VIP packages, parking, hospitality) as events of their own: the plain show goes first,
  // so it is the one kept when the same venue and start time come round again.
  const ADDON = /package|parking|hospitality|\bvip\b|upgrade|experience|add-?on/i;
  const events = [...(Feed.parse(JSON.parse(json))._embedded?.events ?? [])].sort((a, b) => Number(ADDON.test(a.name)) - Number(ADDON.test(b.name)));
  const shows = new Set<string>();
  const dropped: Record<string, number> = {};
  const fixed: Record<string, number> = {};
  const signals: Signal[] = [];
  const seen = new Set<string>();

  for (const e of events) {
    const tmVenue = e._embedded?.venues?.[0];
    let venue = venues.get(norm(tmVenue?.name ?? ""));
    if (!venue && tmVenue?.location) {
      const lat = Number(tmVenue.location.latitude);
      const lon = Number(tmVenue.location.longitude);
      const words = new Set(norm(tmVenue.name).split(" "));
      venue = [...venues.entries()].find(([name, v]) => {
        const ours = name.split(" ");
        return ours.length >= 2 && ours.every((w) => words.has(w)) && km(lat, lon, v.lat, v.lon) <= NEAR_KM;
      })?.[1];
      if (venue) bump(fixed, "venue_name_variant_matched");
    }
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
    const show = `${venue.venue}|${date}|${time}`;
    if (shows.has(show)) {
      bump(dropped, "same_show_listed_twice");
      continue;
    }
    shows.add(show);
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
/** Venues big enough to move rail demand; smaller ones are curated by hand in events.csv. */
const MIN_CAPACITY = 8_000;

/**
 * One search per big venue we know (events within 1 km over the next 30 days), not one national search: GB has ~9,000
 * listed events a month, so a date-sorted national page only covers the next day or so, mostly small London venues.
 */
export const ticketmaster: Adapter = async (ctx) => {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return { signals: [], statuses: [] };
  const from = ctx.now.toISOString().slice(0, 19) + "Z";
  const to = new Date(ctx.now.getTime() + 30 * 86_400_000).toISOString().slice(0, 19) + "Z";
  const venues = parseVenues(readRaw("venues.csv"));
  const big = [...new Set(venues.values())].filter((v) => v.capacity >= MIN_CAPACITY);

  const events: unknown[] = [];
  const modes: string[] = [];
  let fetchedAt: string | undefined;
  for (const v of big) {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?latlong=${v.lat},${v.lon}&radius=1&unit=km&size=100&sort=date,asc&startDateTime=${from}&endDateTime=${to}&apikey=${key}`;
    const got = await fetchText(`${ID}-${slug(v.venue)}`, url, `ticketmaster-${slug(v.venue)}.json`, ctx);
    if (!got) continue;
    modes.push(got.mode);
    fetchedAt ??= got.fetchedAt;
    events.push(...((JSON.parse(got.text) as { _embedded?: { events?: unknown[] } })._embedded?.events ?? []));
  }
  if (modes.length === 0) return { signals: [], statuses: [downStatus(ID, NAME, "No live data or cache available")] };
  const { signals, quality } = buildTicketmaster(JSON.stringify({ _embedded: { events } }), venues);
  const mode = modes.includes("live") ? "live" : modes.includes("cache") ? "cache" : "seed";
  return {
    signals,
    statuses: [{ id: ID, name: NAME, lane: "signals", mode, ...(fetchedAt ? { fetchedAt } : {}), quality, note: `${modes.length} of ${big.length} big venues searched` }],
  };
};
