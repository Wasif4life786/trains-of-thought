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
  /** Where the train starts; when that is our origin, its scheduled time is the real departure. */
  origin?: { location?: { description?: string }; temporalData?: { scheduleAdvertised?: string; scheduleInternal?: string } }[];
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
  /** The route's operator: an operator's view counts only its own trains (e.g. Avanti, not WMR, on Birmingham–Euston). */
  operator?: string,
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
    if (operator && meta.operator?.code && meta.operator.code !== operator) {
      bump(quality.dropped, "other_operator");
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

/** One real scheduled train for a route direction. */
export interface RealService {
  /** London date and time it leaves our origin. */
  departDate: string;
  time: string;
  durationMin: number;
  operator: string;
  /** True when the train starts further back, so the departure is its arrival minus the usual running time. */
  estimated: boolean;
}

const minutesBetween = (a: string, b: string) => (Date.parse(`${b.slice(0, 19)}Z`) - Date.parse(`${a.slice(0, 19)}Z`)) / 60_000;
const shiftLocal = (stamp: string, minutes: number) => new Date(Date.parse(`${stamp.slice(0, 19)}Z`) + minutes * 60_000).toISOString().slice(0, 16);
const sameStation = (a: string, b: string) => {
  const n = (x: string) => x.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return n(a) === n(b) || n(b).startsWith(`${n(a)} `) || n(a).startsWith(`${n(b)} `);
};

/**
 * The real timetable in one saved day: every scheduled passenger train of the route's operator (cancelled ones too,
 * they were still timetabled). Departure is the train's own scheduled start when it starts at our origin.
 */
export function scheduleFromDay(json: unknown, originName: string | undefined, durationMin: number, operator?: string): RealService[] {
  const out: RealService[] = [];
  const seen = new Set<string>();
  for (const s of (json as RttLocationResponse | null)?.services ?? []) {
    const meta = s.scheduleMetadata ?? {};
    if (meta.inPassengerService === false || (meta.modeType && meta.modeType !== "TRAIN")) continue;
    if (operator && meta.operator?.code && meta.operator.code !== operator) continue;
    const arr = s.temporalData?.arrival?.scheduleAdvertised ?? s.temporalData?.arrival?.scheduleInternal;
    if (!arr || seen.has(meta.uniqueIdentity ?? arr)) continue;
    seen.add(meta.uniqueIdentity ?? arr);
    const start = s.origin?.[0];
    const startTime = start?.temporalData?.scheduleAdvertised ?? start?.temporalData?.scheduleInternal;
    const fromOrigin = Boolean(originName && start?.location?.description && startTime && sameStation(originName, start.location.description));
    let depart = fromOrigin ? startTime! : shiftLocal(arr, -durationMin);
    let duration = fromOrigin ? minutesBetween(startTime!, arr) : durationMin;
    let estimated = !fromOrigin;
    if (!(duration > 0 && duration <= durationMin * 2.5)) {
      depart = shiftLocal(arr, -durationMin);
      duration = durationMin;
      estimated = true;
    }
    out.push({ departDate: depart.slice(0, 10), time: depart.slice(11, 16), durationMin: Math.round(duration), operator: meta.operator?.code ?? operator ?? "", estimated });
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
  /** Real timetable: route direction → London departure date → trains, earliest first. */
  timetable: Map<string, Map<string, RealService[]>>;
}

/** What loadRttHistory needs to know about a route direction ("EUS-MAN"); undefined = a route we don't run. */
export interface RouteInfo {
  durationMin: number;
  operator: string;
  originName: string;
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

/** Changes whenever a day is added or rewritten in the cache or snapshot: count + newest modification time. */
export function rttSignature(dirs = { cache: RTT_CACHE_DIR, snapshot: RTT_SNAPSHOT_DIR }): string {
  const files = [...readDir(dirs.cache), ...readDir(dirs.snapshot)];
  return `${files.length}|${files.reduce((t, f) => Math.max(t, statSync(f.file).mtimeMs), 0)}`;
}

/** Every saved day, from this machine's cache if it has any, else the committed snapshot. */
export function loadRttHistory(routeInfo: (route: string) => RouteInfo | undefined, dirs = { cache: RTT_CACHE_DIR, snapshot: RTT_SNAPSHOT_DIR }): RttHistory {
  const fromCache = readDir(dirs.cache);
  const files = fromCache.length > 0 ? fromCache : readDir(dirs.snapshot);
  const mode = files.length === 0 ? null : fromCache.length > 0 ? "cache" : "seed";
  const quality = { rowsIn: 0, fixed: {} as Record<string, number>, dropped: {} as Record<string, number> };
  const seen = new Set<string>();
  const observations: Observation[] = [];
  const timetable = new Map<string, Map<string, RealService[]>>();
  let newest = 0;
  for (const f of files) {
    const info = routeInfo(f.route);
    // A file for a route we no longer run, or a half-written one, holds no rows we could count: skip it.
    if (info === undefined) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(f.file, "utf8"));
    } catch {
      continue;
    }
    observations.push(...parseRttDay(json, f.route, info.durationMin, quality, seen, info.operator));
    const byDate = timetable.get(f.route) ?? new Map<string, RealService[]>();
    for (const r of scheduleFromDay(json, info.originName, info.durationMin, info.operator)) byDate.set(r.departDate, [...(byDate.get(r.departDate) ?? []), r]);
    timetable.set(f.route, byDate);
    newest = Math.max(newest, statSync(f.file).mtimeMs);
  }
  return {
    observations,
    quality: { rowsIn: quality.rowsIn, rowsOut: observations.length, fixed: quality.fixed, dropped: quality.dropped },
    mode,
    days: new Set(files.map((f) => f.date)).size,
    routes: new Set(files.map((f) => f.route)).size,
    ...(newest ? { fetchedAt: new Date(newest) } : {}),
    timetable: new Map([...timetable].map(([route, byDate]) => [route, new Map([...byDate].map(([d, list]) => [d, list.sort((a, b) => a.time.localeCompare(b.time))]))])),
  };
}
