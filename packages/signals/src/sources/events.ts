import { addMinutes, londonToUtc, type Signal } from "@tot/shared";
import { bump, crowdSeverity, parseCsv, readRaw, report, slug, type Adapter } from "../util";

const ID = "seed:events";
const NAME = "Big events near stations (curated sample)";

export interface Venue {
  venue: string;
  lat: number;
  lon: number;
  capacity: number;
  stations: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Every spelling of every venue → the venue. */
export function parseVenues(text: string): Map<string, Venue> {
  const byName = new Map<string, Venue>();
  for (const row of parseCsv(text).slice(1)) {
    const [venue, aliases = "", lat, lon, capacity, stations = ""] = row.map((c) => c.trim());
    if (!venue) continue;
    const entry: Venue = { venue, lat: Number(lat), lon: Number(lon), capacity: Number(capacity), stations: stations.split("|").filter(Boolean) };
    for (const name of [venue, ...aliases.split("|")]) if (name) byName.set(norm(name), entry);
  }
  return byName;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const isoDate = (y: number, m: number, d: number): string | null => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};

/** "2026-11-21" | "21/11/2026" | "Sat 21 Nov 2026" → ISO date, and the repair needed (null = none). */
export function parseEventDate(raw: string): { date: string; fix: string | null } | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const date = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? { date, fix: null } : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) {
    const date = isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
    return date ? { date, fix: "ddmmyyyy_dates" } : null;
  }
  m = /^(?:[A-Za-z]{3,9}\s+)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(raw);
  const month = m ? MONTHS.indexOf(m[2]!.toLowerCase()) + 1 : 0;
  if (m && month > 0) {
    const date = isoDate(Number(m[3]), month, Number(m[1]));
    return date ? { date, fix: "text_dates" } : null;
  }
  return null;
}

/** "19:30" | "19.30" | "7.30pm" | "7pm" → "19:30". null when blank or unreadable. */
export function parseEventTime(raw: string): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const minute = Number(m[2] ?? 0);
  return hour > 23 || minute > 59 ? null : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The curated event list → one signal per event. The whole list is invented for the demo, so every title says (sample). */
export function buildEvents(csv: string, venues: Map<string, Venue>): { signals: Signal[]; quality: ReturnType<typeof report> } {
  const rows = parseCsv(csv).slice(1);
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const signals: Signal[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cells = row.map((c) => c.trim());
    if (cells.every((c) => c === "")) {
      bump(dropped, "blank_row");
      continue;
    }
    const [event = "", type = "", venueName = "", rawDate = "", rawTime = "", rawExpected = ""] = cells;
    const venue = venues.get(norm(venueName));
    if (!venue) {
      bump(dropped, "unknown_venue");
      continue;
    }
    if (norm(venueName) !== norm(venue.venue)) bump(fixed, "venue_alias_resolved");
    const date = parseEventDate(rawDate);
    if (!date) {
      bump(dropped, "bad_date");
      continue;
    }
    if (date.fix) bump(fixed, date.fix);
    let time = parseEventTime(rawTime);
    if (!time) {
      time = "19:00";
      bump(fixed, "start_time_defaulted");
    } else if (time !== rawTime) bump(fixed, "time_normalised");

    const key = `${venue.venue}|${date.date}|${slug(event)}`;
    if (seen.has(key)) {
      bump(dropped, "duplicate");
      continue;
    }
    seen.add(key);

    const concert = type.toLowerCase() === "concert";
    const expected = Number(rawExpected) > 0 ? Number(rawExpected) : venue.capacity;
    const start = londonToUtc(date.date, time);
    signals.push({
      id: `${ID}:${date.date}:${slug(venue.venue)}:${slug(event)}`,
      kind: concert ? "concert" : "event",
      title: `${event} at ${venue.venue} (sample)`,
      detail: `Starts ${time} · about ${expected.toLocaleString("en-GB")} people`,
      source: ID,
      start: addMinutes(start, -180),
      end: addMinutes(start, 240),
      place: { name: venue.venue, lat: venue.lat, lon: venue.lon },
      scope: { stations: venue.stations, operators: [], nationwide: false },
      severity: crowdSeverity(expected, "event"),
      confidence: 0.8,
      metrics: { capacity: expected },
    });
  }
  return { signals, quality: report(rows.length, fixed, dropped) };
}

export const events: Adapter = async () => {
  const { signals, quality } = buildEvents(readRaw("events.csv"), parseVenues(readRaw("venues.csv")));
  return { signals, statuses: [{ id: ID, name: NAME, lane: "signals", mode: "seed", quality, note: "Invented sample events, labelled (sample)" }] };
};
