import type { QualityReport, ReliabilityBaseline } from "@tot/shared";
import { bump, clamp01, parseCsv, readRaw, round } from "./data";
import { loadRttHistory, rttSignature, type RttHistory } from "./rtt";
import type { StationIndex } from "./stations";

export interface Observation {
  /** Directional route code, "EUS-MAN". */
  route: string;
  /** ISO weekday of the planned departure. */
  weekday: number;
  hour: number;
  delayMin: number;
  cancelled: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const isoDate = (y: number, m: number, d: number): string | null => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : null;
};

/** "2026-03-14" | "14/03/2026" | "14 Mar 2026" → ISO date plus which repair was needed (null = none). */
function parseDate(raw: string): { date: string; fix: string | null } | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const date = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? { date, fix: null } : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) {
    const date = isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
    return date ? { date, fix: "date_ddmmyyyy_to_iso" } : null;
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(raw);
  const month = m ? MONTHS.indexOf(m[2]!.toLowerCase()) + 1 : 0;
  if (m && month > 0) {
    const date = isoDate(Number(m[3]), month, Number(m[1]));
    return date ? { date, fix: "date_text_to_iso" } : null;
  }
  return null;
}

/** "09:20" | "9:20" | "0920" → "09:20" plus whether it needed repairing. */
function parseTime(raw: string): { time: string; fixed: boolean } | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const time = `${m[1]!.padStart(2, "0")}:${m[2]}`;
  return { time, fixed: time !== raw };
}

/** "EUS-MAN" | "eus-man" | "EUS MAN" | "London Euston to Manchester Piccadilly" → "EUS-MAN". */
function parseRoute(raw: string, stations: StationIndex): { route: string; fix: string | null } | null {
  const code = /^([A-Za-z]{3})\s*[-–\s]\s*([A-Za-z]{3})$/.exec(raw);
  if (code) {
    const route = `${code[1]!.toUpperCase()}-${code[2]!.toUpperCase()}`;
    return { route, fix: route === raw ? null : "route_code_normalised" };
  }
  const names = raw.split(/\s+to\s+/i);
  if (names.length === 2) {
    const from = stations.findByName(names[0]!);
    const to = stations.findByName(names[1]!);
    if (from && to) return { route: `${from.crs}-${to.crs}`, fix: "route_name_to_crs" };
  }
  return null;
}

type Delay = { cancelled: boolean; delayMin: number; fix: string | null } | { drop: string };

function parseDelay(rawDelay: string, rawStatus: string): Delay {
  const status = rawStatus.toUpperCase();
  if (/CANC/i.test(rawDelay) || status.includes("CANC")) return { cancelled: true, delayMin: 0, fix: null };
  let m = /^(-?\d+)$/.exec(rawDelay);
  if (m) {
    const n = Number(m[1]);
    return n < 0 ? { cancelled: false, delayMin: 0, fix: "early_clamped_to_zero" } : { cancelled: false, delayMin: n, fix: null };
  }
  m = /^(\d+)\s*(m|min|mins|minutes?)$/i.exec(rawDelay);
  if (m) return { cancelled: false, delayMin: Number(m[1]), fix: "delay_parsed_from_text" };
  if (status.includes("ON TIME")) return { cancelled: false, delayMin: 0, fix: "delay_inferred_from_status" };
  if (status.includes("LATE")) return { drop: "late_without_minutes" };
  return { drop: "missing_delay" };
}

/** Turns the messy punctuality history into clean observations, counting every repair and every discarded row. */
export function cleanPerformance(text: string, stations: StationIndex, knownRoutes: ReadonlySet<string>): { observations: Observation[]; quality: QualityReport } {
  const rows = parseCsv(text).slice(1);
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const observations: Observation[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cells = row.map((c) => c.trim());
    if (cells.every((c) => c === "")) {
      bump(dropped, "blank_row");
      continue;
    }
    if (cells.length < 4) {
      bump(dropped, "malformed_row");
      continue;
    }
    const [rawRoute = "", rawDate = "", rawTime = "", rawDelay = "", rawStatus = ""] = cells;
    const route = parseRoute(rawRoute, stations);
    if (!route || !knownRoutes.has(route.route)) {
      bump(dropped, "unknown_route");
      continue;
    }
    const date = parseDate(rawDate);
    if (!date) {
      bump(dropped, "bad_date");
      continue;
    }
    const time = parseTime(rawTime);
    if (!time) {
      bump(dropped, "bad_time");
      continue;
    }
    const delay = parseDelay(rawDelay, rawStatus);
    if ("drop" in delay) {
      bump(dropped, delay.drop);
      continue;
    }
    const key = `${route.route}|${date.date}|${time.time}`;
    if (seen.has(key)) {
      bump(dropped, "duplicate");
      continue;
    }
    seen.add(key);
    for (const fix of [route.fix, date.fix, time.fixed ? "time_normalised" : null, delay.fix]) if (fix) bump(fixed, fix);
    const [y, mo, d] = date.date.split("-").map(Number) as [number, number, number];
    observations.push({
      route: route.route,
      weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() || 7,
      hour: Number(time.time.slice(0, 2)),
      delayMin: delay.delayMin,
      cancelled: delay.cancelled,
    });
  }
  return { observations, quality: { rowsIn: rows.length, rowsOut: observations.length, fixed, dropped } };
}

// ── Baseline model ──────────────────────────────────────────────────────────

/** Monday–Thursday behave alike; Friday (getaway), Saturday and Sunday each get their own pattern. */
const dayClass = (weekday: number) => (weekday <= 4 ? "mon-thu" : weekday === 5 ? "fri" : weekday === 6 ? "sat" : "sun");

interface Tally {
  n: number;
  ok: number;
  cancelled: number;
  delaySum: number;
  delayN: number;
}
const empty = (): Tally => ({ n: 0, ok: 0, cancelled: 0, delaySum: 0, delayN: 0 });

/** Pulls a small sample toward a better-informed prior: (successes + weight × prior) ÷ (n + weight). */
const shrink = (sum: number, n: number, prior: number, weight: number) => (sum + weight * prior) / (n + weight);

export interface BaselineModel {
  /** Punctuality for a directional route at a weekday and hour; sampleSize 0 means a modelled guess. */
  get(route: string, weekday: number, hour: number): Pick<ReliabilityBaseline, "onTimeProb" | "cancelProb" | "avgDelayMin" | "sampleSize">;
}

/**
 * `prior`, when given, is what a cell falls back to where this history is thin: real Realtime Trains observations
 * (A2.9) are layered over the synthetic baseline, so a route × hour with three real trains doesn't swing wildly.
 */
export function buildBaseline(observations: Observation[], prior?: BaselineModel): BaselineModel {
  const cells = new Map<string, Tally>();
  const classes = new Map<string, Tally>();
  const routes = new Map<string, Tally>();
  const add = (map: Map<string, Tally>, key: string, o: Observation) => {
    const t = map.get(key) ?? empty();
    t.n++;
    if (o.cancelled) t.cancelled++;
    else {
      t.delaySum += o.delayMin;
      t.delayN++;
      if (o.delayMin <= 15) t.ok++;
    }
    map.set(key, t);
  };
  for (const o of observations) {
    const cls = dayClass(o.weekday);
    add(cells, `${o.route}|${cls}|${o.hour}`, o);
    add(classes, `${o.route}|${cls}`, o);
    add(routes, o.route, o);
  }

  return {
    get(route, weekday, hour) {
      const cls = dayClass(weekday);
      const cell = cells.get(`${route}|${cls}|${hour}`) ?? empty();
      const klass = classes.get(`${route}|${cls}`) ?? empty();
      const whole = routes.get(route) ?? empty();
      const base = prior?.get(route, weekday, hour);
      const layered = (pick: (t: Tally) => number, nOf: (t: Tally) => number, prior: number) => {
        const r = shrink(pick(whole), nOf(whole), prior, 5);
        const c = shrink(pick(klass), nOf(klass), r, 8);
        return shrink(pick(cell), nOf(cell), c, 14);
      };
      return {
        onTimeProb: round(clamp01(layered((t) => t.ok, (t) => t.n, base?.onTimeProb ?? 0.85)), 3),
        cancelProb: round(clamp01(layered((t) => t.cancelled, (t) => t.n, base?.cancelProb ?? 0.02)), 3),
        avgDelayMin: round(Math.max(0, layered((t) => t.delaySum, (t) => t.delayN, base?.avgDelayMin ?? 4)), 1),
        sampleSize: cell.n,
      };
    },
  };
}

export interface PerformanceData {
  model: BaselineModel;
  /** Quality of the synthetic history file. */
  quality: QualityReport;
  /** Real arrivals from Realtime Trains, when any have been fetched (A2.9). */
  rtt: RttHistory;
}

let synthetic: { model: BaselineModel; quality: QualityReport } | undefined;
let cached: (PerformanceData & { signature: string; checkedAt: number }) | undefined;
/** How often to look for newly fetched Realtime Trains days (one directory listing). */
const RECHECK_MS = 60_000;

const NO_RTT: RttHistory = { observations: [], quality: { rowsIn: 0, rowsOut: 0, fixed: {}, dropped: {} }, mode: null, days: 0, routes: 0 };

/**
 * The synthetic history gives every route × day class × hour a baseline; real Realtime Trains arrivals, where we have
 * them, are layered on top and win wherever they have enough observations. The real part is reloaded when
 * `npm run fetch:rtt` saves new days, so a running API picks them up without a restart.
 */
export function loadPerformance(stations: StationIndex, knownRoutes: ReadonlySet<string>, durationOf: (route: string) => number | undefined = () => undefined): PerformanceData {
  if (!synthetic) {
    const { observations, quality } = cleanPerformance(readRaw("performance.csv"), stations, knownRoutes);
    synthetic = { model: buildBaseline(observations), quality };
  }
  // Tests stay deterministic: they never see whatever this machine happens to have fetched.
  if (process.env.VITEST) {
    cached ??= { model: synthetic.model, quality: synthetic.quality, rtt: NO_RTT, signature: "", checkedAt: Infinity };
    return cached;
  }

  const now = Date.now();
  if (cached && now - cached.checkedAt < RECHECK_MS) return cached;
  const signature = rttSignature();
  if (cached && cached.signature === signature) {
    cached.checkedAt = now;
    return cached;
  }
  const rtt = loadRttHistory((route) => (knownRoutes.has(route) ? durationOf(route) : undefined));
  cached = { model: rtt.observations.length > 0 ? buildBaseline(rtt.observations, synthetic.model) : synthetic.model, quality: synthetic.quality, rtt, signature, checkedAt: now };
  return cached;
}
