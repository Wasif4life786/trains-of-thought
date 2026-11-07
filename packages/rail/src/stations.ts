import { z } from "zod";
import { StationSchema, type QualityReport, type Station } from "@tot/shared";
import { bump, readRaw } from "./data";

const RawStation = z.object({
  stationName: z.string(),
  lat: z.number(),
  long: z.number(),
  crsCode: z.string(),
  constituentCountry: z.string().optional(),
});

/** Searched first when several stations match (the termini people mean when they type a city). */
const MAJOR = ["MAN", "EUS", "KGX", "PAD", "BHM", "LIV", "LDS", "EDB", "BRI", "NCL", "GLC", "YRK", "MCV", "STP", "VIC", "WAT", "LST"];

/** What people type that the official name doesn't contain. */
const EXTRA_ALIASES: Record<string, string[]> = {
  EUS: ["Euston"],
  KGX: ["Kings Cross", "King's Cross"],
  PAD: ["Paddington"],
  STP: ["St Pancras", "Pancras"],
  MAN: ["Piccadilly", "Manchester"],
  MCV: ["Victoria"],
  LIV: ["Lime Street"],
  BHM: ["New Street"],
  LDS: ["Leeds City"],
  EDB: ["Waverley", "Edinburgh"],
  BRI: ["Temple Meads"],
  NCL: ["Newcastle Central", "Newcastle upon Tyne"],
  SOT: ["Stoke"],
  BTH: ["Bath"],
  MKC: ["Milton Keynes"],
  BHI: ["Birmingham Airport", "NEC"],
  DID: ["Didcot"],
};

const JOINERS = /-(On|Upon|Under|In|By|Le|Les|La|The|With|Over|Cum|Next)-/g;
const KINGS = /\bKings (Cross|Lynn|Langley|Norton|Park|Sutton|Heath)\b/g;

/** Fixes how the dataset spells a station name; says which fixes it made. */
export function cleanStationName(raw: string): { name: string; fixes: string[] } {
  const fixes: string[] = [];
  let name = raw.trim().replace(/\s+/g, " ");
  if (name !== raw) fixes.push("whitespace_trimmed");
  const lowered = name.replace(JOINERS, (_, word: string) => `-${word.toLowerCase()}-`);
  if (lowered !== name) fixes.push("name_case_normalised");
  const apostrophes = lowered.replace(KINGS, "King's $1");
  if (apostrophes !== lowered) fixes.push("apostrophe_restored");
  name = apostrophes;
  return { name, fixes };
}

function aliasesFor(name: string, crs: string): string[] {
  const out = new Set<string>();
  const bare = name.replace(/\s*\(.*\)\s*$/, "").trim();
  if (bare !== name) out.add(bare);
  if (name.startsWith("London ")) out.add(name.slice("London ".length));
  const first = bare.split(" ")[0]!;
  if (bare.includes(" ") && first.length >= 4) out.add(first);
  for (const extra of EXTRA_ALIASES[crs] ?? []) out.add(extra);
  for (const alias of [...out]) out.add(alias.replaceAll("'", ""));
  return [...out].filter((a) => a.toLowerCase() !== name.toLowerCase());
}

const normalise = (s: string) => s.toLowerCase().replaceAll("'", "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export interface StationIndex {
  stations: Station[];
  byCrs: Map<string, Station>;
  quality: QualityReport;
  /** Exact match on a station's name or alias, ignoring case and punctuation; undefined when absent or ambiguous. */
  findByName(text: string): Station | undefined;
  /** Exact CRS first, then names and aliases (equal → prefix → word prefix → contains), major stations breaking ties. */
  search(query: string, limit: number): Station[];
}

let cached: StationIndex | undefined;

export function loadStations(): StationIndex {
  cached ??= buildIndex(JSON.parse(readRaw("stations.json")) as unknown);
  return cached;
}

export function buildIndex(raw: unknown): StationIndex {
  const rows = z.array(z.unknown()).parse(raw);
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const stations: Station[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const parsed = RawStation.safeParse(row);
    if (!parsed.success) {
      bump(dropped, "malformed_row");
      continue;
    }
    const r = parsed.data;
    const crs = r.crsCode.trim().toUpperCase();
    if (seen.has(crs)) {
      bump(dropped, "duplicate_crs");
      continue;
    }
    const { name, fixes } = cleanStationName(r.stationName);
    const candidate = { crs, name, lat: r.lat, lon: r.long, aliases: aliasesFor(name, crs), ...(r.constituentCountry ? { country: r.constituentCountry } : {}) };
    const valid = StationSchema.safeParse(candidate);
    if (!valid.success) {
      bump(dropped, "invalid_station");
      continue;
    }
    for (const fix of fixes) bump(fixed, fix);
    if (candidate.aliases.length > 0) bump(fixed, "alias_added", candidate.aliases.length);
    seen.add(crs);
    stations.push(valid.data);
  }

  const byCrs = new Map(stations.map((s) => [s.crs, s]));
  const byName = new Map<string, Station[]>();
  for (const s of stations) for (const n of new Set([s.name, ...s.aliases].map(normalise))) byName.set(n, [...(byName.get(n) ?? []), s]);
  const majorRank = (crs: string) => {
    const i = MAJOR.indexOf(crs);
    return i === -1 ? MAJOR.length : i;
  };

  function rank(s: Station, q: string): number {
    if (s.crs.toLowerCase() === q) return 0;
    const names = [s.name, ...s.aliases].map(normalise);
    if (names.includes(q)) return 1;
    if (names.some((n) => n.startsWith(q))) return 2;
    if (names.some((n) => n.split(" ").some((w) => w.startsWith(q)))) return 3;
    if (names.some((n) => n.includes(q))) return 4;
    const tokens = q.split(" ");
    if (tokens.length > 1 && names.some((n) => tokens.every((t) => n.includes(t)))) return 5;
    return Infinity;
  }

  return {
    stations,
    byCrs,
    quality: { rowsIn: rows.length, rowsOut: stations.length, fixed, dropped },
    findByName(text) {
      const hits = byName.get(normalise(text));
      return hits?.length === 1 ? hits[0] : hits?.find((s) => normalise(s.name) === normalise(text));
    },
    search(query, limit) {
      const q = normalise(query);
      if (!q) return [];
      return stations
        .map((s) => ({ s, r: rank(s, q) }))
        .filter((x) => x.r !== Infinity)
        .sort((a, b) => a.r - b.r || majorRank(a.s.crs) - majorRank(b.s.crs) || a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name))
        .slice(0, limit)
        .map((x) => x.s);
    },
  };
}
