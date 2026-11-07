/**
 * Writes packages/shared/fixtures/*.json: the canned hero scenario (contract.md §1.3) every lane builds against.
 * Deterministic. Run `npm run fixtures` and commit the JSON together with any schema change (contract.md §8).
 * The scoring here is the default model of contract.md §5.5: a reference for A3's real engine, not a replacement.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { FIXTURE_BOOKING_DATE, FIXTURE_QUERY, advanceMultiplier, fixtureFareCurve } from "../src/fixture-model";
import {
  CONTRACT_VERSION,
  JourneyOptionSchema,
  RecommendationResponseSchema,
  SignalSchema,
  SourceStatusSchema,
  StationSchema,
  addDays,
  addMinutes,
  datesBetween,
  daysBetween,
  formatPence,
  londonToUtc,
  overlaps,
  utcToLondon,
  type BookingAdvice,
  type Fare,
  type HeatmapCell,
  type JourneyOption,
  type Reason,
  type ReliabilityBaseline,
  type ScoredOption,
  type Signal,
  type SignalKind,
  type SourceStatus,
  type Station,
  type Verdict,
} from "../src/index";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const GENERATED_AT = "2026-11-07T21:00:00Z";

/** FNV-1a: stable "randomness" so every run produces identical fixtures. */
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (p: number) => `${Math.round(p * 100)}%`;

// ── Stations: coordinates from davwheat/uk-railway-stations, names cleaned ────

const station = (crs: string, name: string, lat: number, lon: number, aliases: string[] = [], country = "england"): Station => ({
  crs,
  name,
  lat,
  lon,
  aliases,
  country,
});

const STATIONS: Station[] = [
  station("EUS", "London Euston", 51.528853, -0.134191, ["Euston", "London"]),
  station("KGX", "London King's Cross", 51.532395, -0.123022, ["Kings Cross", "King's Cross", "London"]),
  station("PAD", "London Paddington", 51.517095, -0.177317, ["Paddington", "London"]),
  station("MAN", "Manchester Piccadilly", 53.47722, -2.23014, ["Manchester", "Piccadilly"]),
  station("MCV", "Manchester Victoria", 53.487975, -2.242485, ["Manchester", "Victoria"]),
  station("LIV", "Liverpool Lime Street", 53.407299, -2.977746, ["Liverpool", "Lime Street"]),
  station("BHM", "Birmingham New Street", 52.477646, -1.898694, ["Birmingham", "New Street"]),
  station("BHI", "Birmingham International", 52.450673, -1.725149, ["Birmingham Airport", "NEC"]),
  station("LDS", "Leeds", 53.794414, -1.548621, ["Leeds City"]),
  station("EDB", "Edinburgh Waverley", 55.951902, -3.19042, ["Edinburgh", "Waverley"], "scotland"),
  station("BRI", "Bristol Temple Meads", 51.449099, -2.580403, ["Bristol", "Temple Meads"]),
  station("MKC", "Milton Keynes Central", 52.034201, -0.774826, ["Milton Keynes"]),
  station("WFJ", "Watford Junction", 51.663945, -0.396111, ["Watford"]),
  station("NMP", "Northampton", 52.237433, -0.906689),
  station("RUG", "Rugby", 52.379035, -1.250274),
  station("COV", "Coventry", 52.400787, -1.513466),
  station("STA", "Stafford", 52.803581, -2.122626),
  station("SOT", "Stoke-on-Trent", 53.008012, -2.181119, ["Stoke"]),
  station("MAC", "Macclesfield", 53.259331, -2.121397),
  station("CRE", "Crewe", 53.088963, -2.432636),
  station("WML", "Wilmslow", 53.327099, -2.226009),
  station("SPT", "Stockport", 53.40545, -2.163044),
  station("RDG", "Reading", 51.45922, -0.972318),
  station("SWI", "Swindon", 51.5657, -1.785284),
  station("BTH", "Bath Spa", 51.377602, -2.356719, ["Bath"]),
  station("PBO", "Peterborough", 52.574604, -0.250316),
  station("DON", "Doncaster", 53.521954, -1.139915),
  station("WKF", "Wakefield Westgate", 53.682212, -1.50558, ["Wakefield"]),
  station("YRK", "York", 53.957966, -1.093159),
  station("DAR", "Darlington", 54.520462, -1.54732),
  station("NCL", "Newcastle", 54.968336, -1.616046, ["Newcastle upon Tyne", "Newcastle Central"]),
];
const stationName = (crs: string) => STATIONS.find((s) => s.crs === crs)?.name ?? crs;

// ── Signals around the hero weekend. Fixtures from openfootball 2026/27; "(sample)" = invented for the demo ──

const SIGNALS: Signal[] = [
  {
    id: "open-meteo:MAN:2026-11-20T16:gusts",
    kind: "weather",
    title: "Strong winds, gusts to 54 mph",
    detail: "Forecast 13 days out, so low confidence · West Coast Main Line north of Stoke",
    source: "open-meteo",
    start: "2026-11-20T16:00:00Z",
    end: "2026-11-20T23:00:00Z",
    place: { name: "Manchester", lat: 53.47722, lon: -2.23014 },
    scope: { stations: ["MAN", "SPT", "MAC", "SOT", "WML", "CRE"], operators: [], nationwide: false },
    severity: 0.6,
    confidence: 0.55,
    metrics: { windGustKph: 87 },
    url: "https://open-meteo.com/",
  },
  {
    id: "openfootball:2026-11-21:manchester-city-v-fulham",
    kind: "football",
    title: "Man City v Fulham",
    detail: "Etihad Stadium · kick-off 15:00 (provisional until TV picks) · 53,400 seats",
    source: "openfootball",
    start: "2026-11-21T12:00:00Z",
    end: "2026-11-21T18:00:00Z",
    place: { name: "Etihad Stadium", lat: 53.4831, lon: -2.2004 },
    scope: { stations: ["MAN", "MCV"], operators: [], nationwide: false },
    severity: 0.8,
    confidence: 0.6,
    metrics: { capacity: 53400 },
  },
  {
    id: "openfootball:2026-11-21:liverpool-v-manchester-united",
    kind: "football",
    title: "Liverpool v Man United",
    detail: "Anfield · kick-off 15:00 (likely to move for TV) · 61,276 seats",
    source: "openfootball",
    start: "2026-11-21T12:00:00Z",
    end: "2026-11-21T18:00:00Z",
    place: { name: "Anfield", lat: 53.4308, lon: -2.9608 },
    scope: { stations: ["LIV"], operators: [], nationwide: false },
    severity: 1,
    confidence: 0.5,
    metrics: { capacity: 61276 },
  },
  {
    id: "seed:events:2026-11-21:manchester-christmas-markets",
    kind: "event",
    title: "Manchester Christmas Markets (sample)",
    detail: "Busy Saturday, extra leisure demand into Piccadilly",
    source: "seed:events",
    start: "2026-11-21T09:00:00Z",
    end: "2026-11-21T20:00:00Z",
    place: { name: "Manchester city centre", lat: 53.4794, lon: -2.2453 },
    scope: { stations: ["MAN", "MCV"], operators: [], nationwide: false },
    severity: 0.2,
    confidence: 0.9,
  },
  {
    id: "seed:events:2026-11-21:co-op-live-concert",
    kind: "concert",
    title: "Sold-out arena concert at Co-op Live (sample)",
    detail: "Doors 18:30, show 19:30 · 23,500 capacity",
    source: "seed:events",
    start: "2026-11-21T16:30:00Z",
    end: "2026-11-21T23:30:00Z",
    place: { name: "Co-op Live", lat: 53.4848, lon: -2.1997 },
    scope: { stations: ["MAN", "MCV"], operators: [], nationwide: false },
    severity: 0.6,
    confidence: 0.8,
    metrics: { capacity: 23500 },
  },
  {
    id: "seed:disruptions:2026-11-22:wcml-mkc-rug",
    kind: "engineering_works",
    title: "Engineering works Milton Keynes to Rugby (sample)",
    detail: "Trains diverted via Northampton, about 25 minutes longer",
    source: "seed:disruptions",
    start: "2026-11-22T00:00:00Z",
    end: "2026-11-22T14:00:00Z",
    scope: { stations: ["EUS", "MKC", "RUG", "NMP"], operators: ["VT", "LM"], nationwide: false },
    severity: 0.6,
    confidence: 0.9,
  },
  {
    id: "open-meteo:SOT:2026-11-22T14:rain",
    kind: "weather",
    title: "Heavy rain, 9 mm an hour",
    detail: "Forecast 15 days out, so low confidence · Stoke to Manchester",
    source: "open-meteo",
    start: "2026-11-22T14:00:00Z",
    end: "2026-11-22T19:00:00Z",
    place: { name: "Stoke-on-Trent", lat: 53.008012, lon: -2.181119 },
    scope: { stations: ["SOT", "MAC", "SPT", "MAN"], operators: [], nationwide: false },
    severity: 0.6,
    confidence: 0.45,
    metrics: { precipitationMmPerHour: 9 },
  },
];
SIGNALS.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

// ── Departures: Avanti EUS → MAN, three trains an hour ─────────────────────────

const PATTERNS = [
  { minute: 0, callingPoints: ["MKC", "SOT", "MAC", "SPT"], durationMin: 128 },
  { minute: 20, callingPoints: ["CRE", "WML", "SPT"], durationMin: 131 },
  { minute: 40, callingPoints: ["MKC", "SOT", "SPT"], durationMin: 125 },
];
/** First departure by ISO weekday (Fri, Sat, Sun); last is 21:40. */
const FIRST_DEPARTURE: Record<number, string> = { 5: "06:00", 6: "06:20", 7: "08:20" };
const WALK_UP = { anytime: 21400, off_peak: 10850, super_off_peak: 6720 };

const isPeak = (weekday: number, time: string) => weekday <= 5 && ((time >= "06:00" && time < "09:30") || (time >= "16:00" && time < "19:00"));
const superOffPeakValid = (weekday: number, time: string) => weekday >= 6 || (time >= "10:00" && time < "15:30") || time >= "19:00";

function fares(id: string, weekday: number, time: string, daysBefore: number): Fare[] {
  const out: Fare[] = [];
  const soldOut = (weekday === 5 && time >= "15:00" && time < "19:00") || (weekday === 6 && time >= "10:00" && time < "13:00") || hash(id) % 7 === 0;
  const multiplier = advanceMultiplier(daysBefore);
  if (!soldOut && multiplier !== null) {
    out.push({ ticketType: "advance", pricePence: Math.round((2400 + (hash(id) % 9) * 250) * multiplier), flexible: false });
  }
  if (!isPeak(weekday, time)) {
    if (superOffPeakValid(weekday, time)) out.push({ ticketType: "super_off_peak", pricePence: WALK_UP.super_off_peak, flexible: true });
    out.push({ ticketType: "off_peak", pricePence: WALK_UP.off_peak, flexible: true });
  }
  out.push({ ticketType: "anytime", pricePence: WALK_UP.anytime, flexible: true });
  return out.sort((a, b) => a.pricePence - b.pricePence);
}

function baseline(id: string, weekday: number, time: string): ReliabilityBaseline {
  const hour = Number(time.slice(0, 2));
  const peak = isPeak(weekday, time);
  const fridayGetaway = weekday === 5 && hour >= 15 && hour < 20;
  let onTime = 0.9 + ((hash(id) % 5) - 2) / 100;
  if (peak) onTime -= 0.04;
  if (fridayGetaway) onTime -= 0.05;
  if (weekday === 7) onTime -= 0.03;
  if (hour >= 20) onTime -= 0.02;
  let crowding = 0.4;
  if (fridayGetaway) crowding = 0.85;
  else if (peak) crowding = 0.75;
  else if (weekday === 6 && hour >= 9 && hour < 13) crowding = 0.65;
  else if (weekday === 7 && hour >= 15 && hour < 20) crowding = 0.7;
  return {
    onTimeProb: round(onTime),
    cancelProb: round(0.015 + (peak ? 0.01 : 0) + (weekday === 7 ? 0.01 : 0), 3),
    avgDelayMin: round((1 - onTime) * 40, 1),
    crowding,
    peak,
    sampleSize: 46 + (hash(id) % 7),
  };
}

function buildJourneys(): JourneyOption[] {
  const out: JourneyOption[] = [];
  for (const date of datesBetween(FIXTURE_QUERY.dateFrom, FIXTURE_QUERY.dateTo)) {
    const weekday = utcToLondon(londonToUtc(date, "12:00")).weekday;
    const daysBefore = daysBetween(FIXTURE_BOOKING_DATE, date);
    for (let hour = 6; hour <= 21; hour++) {
      for (const p of PATTERNS) {
        const time = `${String(hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
        if (time < (FIRST_DEPARTURE[weekday] ?? "06:00") || time > "21:40") continue;
        const departAt = londonToUtc(date, time);
        const id = `EUS-MAN-${departAt}`;
        out.push({
          id,
          origin: "EUS",
          destination: "MAN",
          departAt,
          arriveAt: addMinutes(departAt, p.durationMin),
          durationMin: p.durationMin,
          changes: 0,
          operator: "VT",
          callingPoints: p.callingPoints,
          fares: fares(id, weekday, time, daysBefore),
          baseline: baseline(id, weekday, time),
        });
      }
    }
  }
  return out;
}

// ── Default scoring model (contract.md §5.5) ───────────────────────────────────

const KIND_WEIGHT: Record<SignalKind, number> = {
  strike: 0.9,
  engineering_works: 0.6,
  weather: 0.5,
  football: 0.3,
  concert: 0.2,
  event: 0.1,
  bank_holiday: 0.1,
  other: 0.2,
};
const CROWD_KINDS = new Set<SignalKind>(["football", "concert", "event", "bank_holiday"]);
const SIGNAL_EFFECT: Record<SignalKind, string> = {
  weather: "disruption risk",
  football: "match crowds",
  concert: "concert crowds",
  event: "extra crowds",
  strike: "strike action",
  engineering_works: "diversions",
  bank_holiday: "holiday timetable",
  other: "disruption",
};

/** How strongly a signal touches a journey: 1 at origin/destination (or nationwide), 0.6 at a calling point, 0 not at all. */
function proximity(j: JourneyOption, s: Signal): number {
  if (s.scope.operators.length > 0 && !s.scope.operators.includes(j.operator)) return 0;
  if (s.scope.nationwide) return overlaps(s.start, s.end, addMinutes(j.departAt, -30), addMinutes(j.arriveAt, 30)) ? 1 : 0;
  const near = (at: string) => overlaps(s.start, s.end, addMinutes(at, -30), addMinutes(at, 30));
  if (s.scope.stations.includes(j.origin) && near(j.departAt)) return 1;
  if (s.scope.stations.includes(j.destination) && near(j.arriveAt)) return 1;
  const n = j.callingPoints.length;
  const atCallingPoint = j.callingPoints.some(
    (crs, i) => s.scope.stations.includes(crs) && near(addMinutes(j.departAt, Math.round(((i + 1) / (n + 1)) * j.durationMin))),
  );
  return atCallingPoint ? 0.6 : 0;
}

function signalReasonText(s: Signal, j: JourneyOption, prox: number): string {
  const hhmm = (iso: string) => utcToLondon(iso).time;
  const touched = s.scope.nationwide
    ? ["nationwide"]
    : s.scope.stations.filter((crs) => (prox === 1 ? crs === j.origin || crs === j.destination : j.callingPoints.includes(crs))).map(stationName);
  return `${s.title}: ${SIGNAL_EFFECT[s.kind]} at ${touched.slice(0, 2).join(" & ")}, ${hhmm(s.start)}–${hhmm(s.end)}`;
}

const impact = (r: Reason) => Math.abs(r.reliabilityDelta ?? 0) * 100 + Math.abs(r.priceDeltaPence ?? 0) / 200 + (r.reliabilityDelta === undefined && r.priceDeltaPence === undefined ? 2 : 0);

function verdictFor(score: number): Verdict {
  if (score >= 70) return "great";
  if (score >= 55) return "good";
  if (score >= 40) return "risky";
  return "avoid";
}

function scoreOptions(journeys: JourneyOption[], signals: Signal[], priority: number): ScoredOption[] {
  const drafts = journeys.map((j) => {
    let reliability = j.baseline.onTimeProb;
    let crowding = j.baseline.crowding;
    const reasons: Reason[] = [];
    for (const s of signals) {
      const prox = proximity(j, s);
      if (prox === 0) continue;
      const risk = s.severity * s.confidence * KIND_WEIGHT[s.kind] * prox;
      reliability *= 1 - risk;
      if (CROWD_KINDS.has(s.kind)) crowding += s.severity * 0.4 * prox;
      reasons.push({ kind: s.kind, signalId: s.id, text: signalReasonText(s, j, prox), effect: "bad", reliabilityDelta: -round(j.baseline.onTimeProb * risk, 3) });
    }
    const cheapest = j.fares[0]!;
    const walkUp = j.fares.find((f) => f.flexible);
    if (cheapest.ticketType === "advance" && walkUp && walkUp.pricePence - cheapest.pricePence >= 1000) {
      const saving = walkUp.pricePence - cheapest.pricePence;
      reasons.push({ kind: "price", text: `Advance ticket ${formatPence(cheapest.pricePence)}: ${formatPence(saving)} less than the cheapest walk-up fare`, effect: "good", priceDeltaPence: -saving });
    }
    if (!j.fares.some((f) => f.ticketType === "advance")) reasons.push({ kind: "price", text: "Advance tickets sold out: walk-up fares only", effect: "bad" });
    if (j.baseline.peak) {
      reasons.push({ kind: "peak", text: `Peak train: Anytime ${formatPence(WALK_UP.anytime)} unless you have an Advance`, effect: "bad", priceDeltaPence: WALK_UP.anytime - WALK_UP.off_peak });
    }
    if (j.baseline.onTimeProb >= 0.9) reasons.push({ kind: "history", text: `Usually punctual: ${pct(j.baseline.onTimeProb)} on time over the past year`, effect: "good" });
    else if (j.baseline.onTimeProb <= 0.82) reasons.push({ kind: "history", text: `Often late: only ${pct(j.baseline.onTimeProb)} arrive within 15 minutes`, effect: "bad" });
    if (crowding >= 0.75) reasons.push({ kind: "crowding", text: "Busy train: expect to stand", effect: "bad" });
    return { journey: j, pricePence: cheapest.pricePence, ticketType: cheapest.ticketType, reliability: round(clamp01(reliability), 3), crowding: round(clamp01(crowding)), reasons };
  });

  const minPrice = Math.min(...drafts.map((d) => d.pricePence));
  const scored: ScoredOption[] = drafts.map((d) => {
    const priceScore = minPrice / d.pricePence;
    const reliabilityScore = clamp01((d.reliability - 0.55) / 0.4);
    const score = Math.round(100 * ((1 - priority) * priceScore + priority * reliabilityScore));
    return { ...d, score, verdict: verdictFor(score), reasons: [...d.reasons].sort((a, b) => impact(b) - impact(a)) };
  });
  const top = Math.max(...scored.map((o) => o.score));
  const best = scored.find((o) => o.score === top);
  if (best) best.verdict = "best";
  return scored;
}

function buildHeatmap(options: ScoredOption[]): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  const firstHour = Number(FIXTURE_QUERY.earliest.slice(0, 2));
  const lastHour = Number(FIXTURE_QUERY.latest.slice(0, 2));
  for (const date of datesBetween(FIXTURE_QUERY.dateFrom, FIXTURE_QUERY.dateTo)) {
    for (let hour = firstHour; hour <= lastHour; hour++) {
      const inCell = options.filter((o) => {
        const local = utcToLondon(o.journey.departAt);
        return local.date === date && local.hour === hour;
      });
      const top = inCell.reduce<ScoredOption | null>((acc, o) => (!acc || o.score > acc.score ? o : acc), null);
      cells.push({
        date,
        hour,
        score: top?.score ?? null,
        minPricePence: inCell.length ? Math.min(...inCell.map((o) => o.pricePence)) : null,
        reliability: top?.reliability ?? null,
        optionIds: inCell.map((o) => o.journey.id),
      });
    }
  }
  return cells;
}

function buildBookingAdvice(best: ScoredOption): BookingAdvice {
  const curve = fixtureFareCurve(best.journey, FIXTURE_BOOKING_DATE);
  const travelDate = utcToLondon(best.journey.departAt).date;
  const current = best.pricePence;
  const base = { journeyId: best.journey.id, currentPricePence: current, curve };
  if (daysBetween(FIXTURE_BOOKING_DATE, travelDate) > 84) {
    return { ...base, action: "not_on_sale_yet", headline: `Advance fares go on sale ${curve.advanceOnSale}` };
  }
  const weekLater = curve.points.find((p) => p.date >= addDays(FIXTURE_BOOKING_DATE, 7)) ?? curve.points.at(-1)!;
  if (weekLater.pricePence >= current * 1.1) {
    const nextRise = curve.points.find((p) => p.date > FIXTURE_BOOKING_DATE && p.pricePence > current);
    return {
      ...base,
      action: "book_now",
      headline: `Book now: this fare usually rises to ${formatPence(weekLater.pricePence)} within a week`,
      expectedPricePence: weekLater.pricePence,
      ...(nextRise ? { bookBy: addDays(nextRise.date, -1) } : {}),
    };
  }
  return { ...base, action: "wait", headline: "No rush: this fare looks stable for the next week", expectedPricePence: weekLater.pricePence };
}

// ── Source statuses: illustrative numbers for the "what we cleaned" panel ──────

const quality = (rowsIn: number, fixed: Record<string, number>, dropped: Record<string, number>) => ({
  rowsIn,
  rowsOut: rowsIn - Object.values(dropped).reduce((a, b) => a + b, 0),
  fixed,
  dropped,
});
const FIXTURE_NOTE = "Fixture: illustrative numbers";

const SOURCES: SourceStatus[] = [
  {
    id: "open-meteo",
    name: "Open-Meteo hourly forecast",
    lane: "signals",
    mode: "live",
    fetchedAt: "2026-11-07T20:55:00Z",
    quality: quality(1152, { kmh_to_mph: 1152, hours_merged_into_windows: 11 }, { below_threshold: 1137, merged: 9 }),
    note: FIXTURE_NOTE,
  },
  {
    id: "openfootball",
    name: "openfootball Premier League 2026/27",
    lane: "signals",
    mode: "live",
    fetchedAt: "2026-11-07T20:55:00Z",
    quality: quality(380, { team_alias_resolved: 380, kickoff_assumed_london_time: 380 }, { duplicate_fixture: 2 }),
    note: FIXTURE_NOTE,
  },
  {
    id: "thesportsdb",
    name: "TheSportsDB (TV kick-off times)",
    lane: "signals",
    mode: "live",
    fetchedAt: "2026-11-07T20:55:00Z",
    quality: quality(10, { kickoff_moved_for_tv: 3 }, { merged_into_openfootball: 10 }),
    note: FIXTURE_NOTE,
  },
  {
    id: "gov-uk-bank-holidays",
    name: "GOV.UK bank holidays",
    lane: "signals",
    mode: "cache",
    fetchedAt: "2026-11-07T09:12:00Z",
    quality: quality(213, { curly_apostrophes: 6 }, { past_dates: 160 }),
    note: FIXTURE_NOTE,
  },
  {
    id: "seed:events",
    name: "Big events near stations (curated CSV)",
    lane: "signals",
    mode: "seed",
    quality: quality(64, { ddmmyyyy_dates: 23, venue_alias_resolved: 19 }, { duplicate: 5, past_event: 2 }),
    note: FIXTURE_NOTE,
  },
  {
    id: "seed:disruptions",
    name: "Strikes & engineering works (curated)",
    lane: "signals",
    mode: "seed",
    quality: quality(9, { operator_name_to_atoc: 9 }, { cancelled_works: 1 }),
    note: FIXTURE_NOTE,
  },
  {
    id: "rail:stations",
    name: "UK stations (davwheat/uk-railway-stations)",
    lane: "rail",
    mode: "seed",
    quality: quality(2609, { name_case_normalised: 41, alias_added: 120 }, {}),
    note: FIXTURE_NOTE,
  },
  {
    id: "rail:timetable",
    name: "Timetable model (hero corridors)",
    lane: "rail",
    mode: "seed",
    quality: quality(6, {}, {}),
    note: FIXTURE_NOTE,
  },
  {
    id: "rail:fares",
    name: "Fare tables and Advance curve",
    lane: "rail",
    mode: "seed",
    quality: quality(24, { pounds_to_pence: 24 }, {}),
    note: FIXTURE_NOTE,
  },
  {
    id: "rail:performance",
    name: "Punctuality history",
    lane: "rail",
    mode: "seed",
    quality: quality(48210, { delay_parsed_from_text: 1820, crs_from_station_name: 412 }, { missing_actual_time: 1102, duplicate: 235 }),
    note: FIXTURE_NOTE,
  },
];

// ── Assemble, validate, write ──────────────────────────────────────────────────

const journeys = buildJourneys();
const options = scoreOptions(journeys, SIGNALS, FIXTURE_QUERY.priority);
const best = options.find((o) => o.verdict === "best") ?? null;
const citedIds = new Set(options.flatMap((o) => o.reasons.flatMap((r) => (r.signalId ? [r.signalId] : []))));

const recommendation = RecommendationResponseSchema.parse({
  contractVersion: CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  query: FIXTURE_QUERY,
  best,
  options,
  heatmap: buildHeatmap(options),
  signals: SIGNALS.filter((s) => citedIds.has(s.id)),
  bookingAdvice: best ? buildBookingAdvice(best) : null,
  sources: SOURCES,
  warnings: [
    "Fixture data generated by packages/shared/scripts/generate-fixtures.ts, not live.",
    "Kick-off times for 21 Nov are provisional until the TV picks are announced.",
    "Weather more than a week out is low-confidence and weighted down.",
  ],
});

// A small, valid copy for reading: the full files are too big for anyone (human or agent) to read whole.
const sampleOptions = (["best", "great", "good", "risky", "avoid"] as const).flatMap((v) => options.find((o) => o.verdict === v) ?? []);
const sample = RecommendationResponseSchema.parse({
  ...recommendation,
  options: sampleOptions,
  heatmap: recommendation.heatmap.slice(0, 6),
  bookingAdvice: recommendation.bookingAdvice && {
    ...recommendation.bookingAdvice,
    curve: { ...recommendation.bookingAdvice.curve, points: recommendation.bookingAdvice.curve.points.slice(-6) },
  },
});

const files: Record<string, unknown> = {
  "stations.json": z.array(StationSchema).parse(STATIONS),
  "signals.json": z.array(SignalSchema).parse(SIGNALS),
  "journey-options.json": z.array(JourneyOptionSchema).parse(journeys),
  "sources.json": z.array(SourceStatusSchema).parse(SOURCES),
  "recommendation.json": recommendation,
  "recommendation.sample.json": sample,
};
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, data] of Object.entries(files)) writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);

const tally = options.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.verdict]: (acc[o.verdict] ?? 0) + 1 }), {});
const bestLocal = best && utcToLondon(best.journey.departAt);
console.log(`fixtures → ${path.relative(process.cwd(), OUT_DIR)}`);
console.log(`  ${STATIONS.length} stations · ${SIGNALS.length} signals (${citedIds.size} cited) · ${journeys.length} departures`);
console.log(`  verdicts ${JSON.stringify(tally)}`);
if (best && bestLocal) {
  console.log(`  best: ${bestLocal.date} ${bestLocal.time} ${formatPence(best.pricePence)} ${best.ticketType} · reliability ${pct(best.reliability)} · score ${best.score}`);
  console.log(`  advice: ${recommendation.bookingAdvice?.headline}`);
}
