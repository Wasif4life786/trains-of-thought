import { isOffline, overlaps, type Signal, type SignalProvider, type SourceStatus } from "@tot/shared";
import { bankHolidays } from "./sources/bank-holidays";
import { disruptions } from "./sources/disruptions";
import { events } from "./sources/events";
import { football } from "./sources/football";
import { seasonal } from "./sources/seasonal";
import { ticketmaster } from "./sources/ticketmaster";
import { tfl } from "./sources/tfl";
import { weather } from "./sources/weather";
import { downStatus, type Adapter, type AdapterResult, type Ctx } from "./util";

export interface SignalProviderOptions {
  /** The clock, for deterministic tests and demo replays. */
  now?: () => Date;
  /** Force offline mode (default: TOT_OFFLINE=1 or under Vitest). */
  offline?: boolean;
}

/** One adapter per source; each reports its own signals and its own SourceStatus (contract.md §6.1). */
const ADAPTERS: { id: string; name: string; run: Adapter }[] = [
  { id: "gov-uk-bank-holidays", name: "GOV.UK bank holidays", run: bankHolidays },
  { id: "open-meteo", name: "Open-Meteo hourly forecast", run: weather },
  { id: "openfootball", name: "openfootball Premier League 2026/27", run: football },
  { id: "seed:events", name: "Big events near stations (curated sample)", run: events },
  { id: "seed:disruptions", name: "Strikes and engineering works (curated sample)", run: disruptions },
  { id: "tfl-status", name: "TfL line status near the London termini", run: tfl },
  { id: "seasonal:leaf-fall", name: "Autumn leaf-fall adhesion (modelled seasonal rule)", run: seasonal },
  // Real concerts. Always registered: the adapter reads TICKETMASTER_API_KEY when it runs and reports nothing without
  // one. (Checking the key here, at import time, ran before server.ts / ingest.ts had loaded .env, so it never fired.)
  { id: "ticketmaster", name: "Ticketmaster Discovery (real concerts and events)", run: ticketmaster },
];

/** How long a loaded source is reused before it's fetched again. */
const REFRESH_MS = 30 * 60_000;

/**
 * A1 · Signaller: messy world data (bank holidays, weather, football, events, strikes and engineering works) as clean
 * `Signal[]` with honest `SourceStatus[]`. Live → data/cache → checked-in seed; never throws because one source is down.
 */
export function createSignalProvider(options: SignalProviderOptions = {}): SignalProvider {
  const now = options.now ?? (() => new Date());
  const offline = options.offline ?? isOffline();
  const ctx = (): Ctx => ({ now: now(), offline, useCache: !process.env.VITEST });
  const loaded = new Map<string, { at: number; result: Promise<AdapterResult> }>();

  function load(adapter: (typeof ADAPTERS)[number]): Promise<AdapterResult> {
    const hit = loaded.get(adapter.id);
    if (hit && Date.now() - hit.at < REFRESH_MS) return hit.result;
    const result = adapter.run(ctx()).catch((err: unknown): AdapterResult => ({
      signals: [],
      statuses: [downStatus(adapter.id, adapter.name, err instanceof Error ? err.message : String(err))],
    }));
    loaded.set(adapter.id, { at: Date.now(), result });
    return result;
  }

  return {
    name: "signals",

    async getSignals(q) {
      const wanted = new Set(q.stations);
      const results = await Promise.all(ADAPTERS.map(load));
      const seen = new Set<string>();
      const out: Signal[] = [];
      for (const s of results.flatMap((r) => r.signals)) {
        if (seen.has(s.id)) continue;
        if (!overlaps(s.start, s.end, q.from, q.to)) continue;
        if (!s.scope.nationwide && !s.scope.stations.some((crs) => wanted.has(crs))) continue;
        if (q.kinds && !q.kinds.includes(s.kind)) continue;
        seen.add(s.id);
        out.push(s);
      }
      return out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    },

    async listSources(): Promise<SourceStatus[]> {
      return (await Promise.all(ADAPTERS.map(load))).flatMap((r) => r.statuses);
    },
  };
}
