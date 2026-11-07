import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toIsoUtc, type QualityReport, type Signal, type SourceStatus } from "@tot/shared";

const RAW_DIR = fileURLToPath(new URL("../../../data/raw/signals/", import.meta.url));
const CACHE_DIR = fileURLToPath(new URL("../../../data/cache/signals/", import.meta.url));

export const readRaw = (file: string): string => readFileSync(RAW_DIR + file, "utf8");
export const RAW_PATH = RAW_DIR;

/** What every adapter needs to know about the world it runs in. */
export interface Ctx {
  now: Date;
  /** TOT_OFFLINE=1 or under Vitest: never touch the network. */
  offline: boolean;
  /** Read data/cache/ when the network isn't available. Off under Vitest so tests don't depend on one machine's cache. */
  useCache: boolean;
}

export interface AdapterResult {
  signals: Signal[];
  statuses: SourceStatus[];
}
export type Adapter = (ctx: Ctx) => Promise<AdapterResult>;

export interface Fetched {
  text: string;
  mode: "live" | "cache" | "seed";
  /** When this copy was fetched; absent for the checked-in seed. */
  fetchedAt?: string;
}

/**
 * Live → data/cache → the checked-in raw file (contract.md §4.7). Returns null when none of them is available.
 * A successful live fetch refreshes the cache.
 */
export async function fetchText(id: string, url: string, rawFile: string, ctx: Ctx): Promise<Fetched | null> {
  const cacheFile = `${CACHE_DIR}${id}.json`;
  if (!ctx.offline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "trains-of-thought-hackathon" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cacheFile, text);
      if (process.env.TOT_SNAPSHOT === "1") {
        mkdirSync(`${RAW_DIR}snapshot/`, { recursive: true });
        writeFileSync(`${RAW_DIR}snapshot/${rawFile}`, text);
      }
      return { text, mode: "live", fetchedAt: toIsoUtc(new Date()) };
    } catch {
      // fall through to the cache and the seed
    }
  }
  if (ctx.useCache && existsSync(cacheFile)) return { text: readFileSync(cacheFile, "utf8"), mode: "cache", fetchedAt: toIsoUtc(statSync(cacheFile).mtime) };
  // The seed is the demo snapshot if one was taken (npm run ingest -- --snapshot), else the file checked in as downloaded.
  for (const file of [`snapshot/${rawFile}`, rawFile]) if (existsSync(RAW_DIR + file)) return { text: readRaw(file), mode: "seed" };
  return null;
}

export const bump = (counts: Record<string, number>, reason: string, n = 1): void => {
  counts[reason] = (counts[reason] ?? 0) + n;
};

export const sumValues = (counts: Record<string, number>): number => Object.values(counts).reduce((a, b) => a + b, 0);

/** A report where every row in is accounted for: rowsOut = rowsIn − Σ dropped. */
export function report(rowsIn: number, fixed: Record<string, number>, dropped: Record<string, number>): QualityReport {
  return { rowsIn, rowsOut: rowsIn - sumValues(dropped), fixed, dropped };
}

/** The status of a source we couldn't read at all. */
export const downStatus = (id: string, name: string, note: string): SourceStatus => ({ id, name, lane: "signals", mode: "down", quality: { rowsIn: 0, rowsOut: 0, fixed: {}, dropped: {} }, note });

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Minimal CSV reader: quoted fields, doubled quotes, CRLF. A blank line comes back as [""] so callers can count it. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Severity from a crowd size: the rubric of contract.md §4.5. `big` bands are for concerts and events, `match` for football. */
export function crowdSeverity(capacity: number, kind: "match" | "event"): number {
  const bands = kind === "match" ? [15_000, 30_000, 45_000, 60_000] : [5_000, 15_000, 30_000, 60_000];
  const index = bands.filter((b) => capacity >= b).length;
  return [0.2, 0.4, 0.6, 0.8, 1][index]!;
}

/** Confidence in a forecast from how far ahead it looks (contract.md §4.6). */
export function leadConfidence(leadDays: number): number {
  if (leadDays <= 1) return 0.8;
  if (leadDays <= 3) return 0.7;
  if (leadDays <= 5) return 0.6;
  if (leadDays <= 7) return 0.5;
  if (leadDays <= 10) return 0.4;
  if (leadDays <= 14) return 0.3;
  return 0.2;
}
