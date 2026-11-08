/**
 * A2.9 · Real punctuality from Realtime Trains (https://data.rtt.io, the next-generation API; sign-up at
 * https://api-portal.rtt.io). One request per route direction per London day, made at the ARRIVAL station, because
 * Delay Repay is judged on lateness at the destination.
 *
 * Network access lives only in scripts/fetch-rtt.ts. This module is pure: it turns saved responses into cleaned
 * observations (counting every repair and drop) and reads them back from data/cache, else the committed snapshot.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { QualityReport } from "@tot/shared";
import { bump } from "./data";
import type { Observation } from "./performance";

export const RTT_CACHE_DIR = fileURLToPath(new URL("../../../data/cache/rail/rtt/", import.meta.url));
export const RTT_SNAPSHOT_DIR = fileURLToPath(new URL("../../../data/raw/rail/rtt/", import.meta.url));

/** The slice of a /gb-nr/location response we read (shape from github.com/realtimetrains/api-specification). */
interface RttCall {
  scheduleInternal?: string;
  scheduleAdvertised?: string;
  realtimeActual?: string;
  realtimeInternalLateness?: number | null;
  realtimeAdvertisedLateness?: number | null;
  isCancelled?: boolean;
}
interface RttService {
  temporalData?: { arrival?: RttCall; departure?: RttCall };
  scheduleMetadata?: { uniqueIdentity?: string; operator?: { code?: string }; inPassengerService?: boolean; modeType?: string };
}
interface RttLocationResponse {
  services?: RttService[] | null;
}

/** Local wall-clock "2026-11-07T08:44:00" → ISO weekday and hour, read straight off the string (it is London time). */
function localParts(stamp: string): { date: string; weekday: number; hour: number; minutes: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return { date: `${m[1]}-${m[2]}-${m[3]}`, weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() || 7, hour: h, minutes: h * 60 + mi };
}

/**
 * One saved day of arrivals for a route direction → observations keyed by planned DEPARTURE hour (arrival minus the
 * route's running time), which is how the baseline model is indexed.
 */
export function parseRttDay(
  json: unknown,
  route: string,
  durationMin: number,
  quality: { fixed: Record<string, number>; dropped: Record<string, number>; rowsIn: number },
  seen: Set<string>,
): Observation[] {
  const services = (json as RttLocationResponse | null)?.services ?? [];
  const out: Observation[] = [];
  for (const s of services) {
    quality.rowsIn++;
    const meta = s.scheduleMetadata ?? {};
    if (meta.inPassengerService === false || (meta.modeType && meta.modeType !== "TRAIN")) {
      bump(quality.dropped, "not_a_passenger_train");
      continue;
    }
    const arr = s.temporalData?.arrival;
    const planned = arr?.scheduleAdvertised ?? arr?.scheduleInternal;
    if (!arr || !planned) {
      bump(quality.dropped, "no_scheduled_arrival");
      continue;
    }
    if (!arr.scheduleAdvertised) bump(quality.fixed, "working_time_used_for_public_time");
    const key = `${route}|${meta.uniqueIdentity ?? planned}`;
    if (seen.has(key)) {
      bump(quality.dropped, "duplicate");
      continue;
    }
    const at = localParts(planned);
    if (!at) {
      bump(quality.dropped, "bad_timestamp");
      continue;
    }
    let delayMin = 0;
    let cancelled = false;
    if (arr.isCancelled) cancelled = true;
    else {
      const late = arr.realtimeAdvertisedLateness ?? arr.realtimeInternalLateness;
      if (late == null) {
        bump(quality.dropped, arr.realtimeActual ? "lateness_missing" : "no_actual_time_recorded");
        continue;
      }
      if (arr.realtimeAdvertisedLateness == null) bump(quality.fixed, "working_lateness_used");
      if (late < 0) bump(quality.fixed, "early_clamped_to_zero");
      delayMin = Math.max(0, late);
    }
    seen.add(key);
    const departMinutes = at.minutes - durationMin;
    const hour = departMinutes >= 0 ? Math.floor(departMinutes / 60) : 0;
    if (departMinutes < 0) bump(quality.fixed, "departure_before_midnight_clamped");
    out.push({ route, weekday: at.weekday, hour, delayMin, cancelled });
  }
  return out;
}

export interface RttHistory {
  observations: Observation[];
  quality: QualityReport;
  /** "cache" (fetched on this machine), "seed" (committed snapshot) or null (none: synthetic history only). */
  mode: "cache" | "seed" | null;
  days: number;
  routes: number;
  fetchedAt?: Date;
}

/** Saved files are `<dir>/<ORIGIN>-<DEST>/<yyyy-mm-dd>.json`. */
function readDir(dir: string): { route: string; date: string; file: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((route) =>
    /^[A-Z]{3}-[A-Z]{3}$/.test(route) && statSync(dir + route).isDirectory()
      ? readdirSync(dir + route)
          .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .map((f) => ({ route, date: f.slice(0, 10), file: `${dir}${route}/${f}` }))
      : [],
  );
}

/** Every saved day, from this machine's cache if it has any, else the committed snapshot. */
export function loadRttHistory(durationOf: (route: string) => number | undefined, dirs = { cache: RTT_CACHE_DIR, snapshot: RTT_SNAPSHOT_DIR }): RttHistory {
  const fromCache = readDir(dirs.cache);
  const files = fromCache.length > 0 ? fromCache : readDir(dirs.snapshot);
  const mode = files.length === 0 ? null : fromCache.length > 0 ? "cache" : "seed";
  const quality = { rowsIn: 0, fixed: {} as Record<string, number>, dropped: {} as Record<string, number> };
  const seen = new Set<string>();
  const observations: Observation[] = [];
  let newest = 0;
  for (const f of files) {
    const duration = durationOf(f.route);
    // A file for a route we no longer run, or a half-written one, holds no rows we could count: skip it.
    if (duration === undefined) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(f.file, "utf8"));
    } catch {
      continue;
    }
    observations.push(...parseRttDay(json, f.route, duration, quality, seen));
    newest = Math.max(newest, statSync(f.file).mtimeMs);
  }
  return {
    observations,
    quality: { rowsIn: quality.rowsIn, rowsOut: observations.length, fixed: quality.fixed, dropped: quality.dropped },
    mode,
    days: new Set(files.map((f) => f.date)).size,
    routes: new Set(files.map((f) => f.route)).size,
    ...(newest ? { fetchedAt: new Date(newest) } : {}),
  };
}
