/** The seams between lanes (contract.md §5.2). Implementations live in their lane's package; fakes in ./fixtures. */
import type {
  FareCurve,
  JourneyOption,
  JourneyQuery,
  RecommendationQuery,
  RecommendationResponse,
  Signal,
  SignalQuery,
  SourceStatus,
  Station,
} from "./schemas";

/** A1 · Signaller implements this in @tot/signals (createSignalProvider). */
export interface SignalProvider {
  /** Shown in /api/health: "fixture" until A1 ships. */
  readonly name: string;
  /**
   * Signals whose impact window overlaps [from, to] AND that touch one of `stations` or are nationwide
   * (AND whose kind is in `kinds`, when given). Sorted by start, unique ids.
   * Never throws because one source is down: degrade to cache/seed and say so in listSources().
   */
  getSignals(q: SignalQuery): Promise<Signal[]>;
  listSources(): Promise<SourceStatus[]>;
}

/** A2 · Timetabler implements this in @tot/rail (createRailProvider). */
export interface RailProvider {
  readonly name: string;
  /** Fuzzy search over name, aliases and CRS; an exact CRS match comes first. Empty query → []. */
  searchStations(query: string, limit?: number): Promise<Station[]>;
  getStation(crs: string): Promise<Station | null>;
  /** Every departure in the date range and London time window, sorted by departAt, priced as of q.bookingDate. */
  getJourneyOptions(q: JourneyQuery): Promise<JourneyOption[]>;
  /** How the cheapest fare for one journey moves by booking date; null for an unknown id. */
  getFareCurve(journeyId: string, bookingDate: string): Promise<FareCurve | null>;
  listSources(): Promise<SourceStatus[]>;
}

/** A3 · Controller implements this in @tot/engine (createEngine). */
export interface Engine {
  readonly name: string;
  recommend(q: RecommendationQuery): Promise<RecommendationResponse>;
}

/** What the engine gets injected; only @tot/api wires concrete lanes together. */
export interface EngineDeps {
  signals: SignalProvider;
  rail: RailProvider;
  /** Clock override for deterministic tests and demo replays. */
  now?: () => Date;
}
