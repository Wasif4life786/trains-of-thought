/**
 * The canned hero scenario + fake providers (contract.md §5.4). Build against these until your upstream lane ships:
 *   import { createFixtureRailProvider } from "@tot/shared/fixtures";
 * Regenerate the JSON with `npm run fixtures` (packages/shared/scripts/generate-fixtures.ts).
 */
import { z } from "zod";
import journeyOptionsJson from "../fixtures/journey-options.json";
import inputsJson from "../fixtures/inputs.json";
import networkJson from "../fixtures/network.json";
import operationsJson from "../fixtures/operations.json";
import recommendationJson from "../fixtures/recommendation.json";
import signalsJson from "../fixtures/signals.json";
import sourcesJson from "../fixtures/sources.json";
import stationsJson from "../fixtures/stations.json";
import { FIXTURE_QUERY, fixtureFareCurve, mirrorJourney, mirrorRecommendation } from "./fixture-model";
import type { Engine, RailProvider, SignalProvider } from "./providers";
import {
  InputsResponseSchema,
  JourneyOptionSchema,
  NetworkResponseSchema,
  OperationsResponseSchema,
  RecommendationResponseSchema,
  SignalSchema,
  SourceStatusSchema,
  StationSchema,
  type InputsResponse,
  type JourneyOption,
  type NetworkResponse,
  type OperationsResponse,
  type RecommendationResponse,
  type Signal,
  type SourceStatus,
  type Station,
} from "./schemas";
import { overlaps, utcToLondon } from "./time";

export { FIXTURE_BOOKING_DATE, FIXTURE_QUERY, advanceMultiplier, fixtureFareCurve, mirrorJourney, mirrorRecommendation } from "./fixture-model";

export interface Fixtures {
  stations: Station[];
  signals: Signal[];
  journeyOptions: JourneyOption[];
  sources: SourceStatus[];
  recommendation: RecommendationResponse;
}

let cache: Fixtures | undefined;

/** Every fixture, validated against the contract on first use. */
export function loadFixtures(): Fixtures {
  cache ??= {
    stations: z.array(StationSchema).parse(stationsJson),
    signals: z.array(SignalSchema).parse(signalsJson),
    journeyOptions: z.array(JourneyOptionSchema).parse(journeyOptionsJson),
    sources: z.array(SourceStatusSchema).parse(sourcesJson),
    recommendation: RecommendationResponseSchema.parse(recommendationJson),
  };
  return cache;
}

let opsCache: { operations: OperationsResponse; network: NetworkResponse; inputs: InputsResponse } | undefined;

/**
 * (v1.3.0) The canned operator answers: the EUS → MAN board for FIXTURE_QUERY's dates and the network view, made by
 * A3's real engine on the fake providers (`npm run fixtures:ops -w @tot/engine`). Loaded separately so the generator
 * can run before they exist.
 */
export function loadOperationsFixtures(): { operations: OperationsResponse; network: NetworkResponse; inputs: InputsResponse } {
  opsCache ??= { operations: OperationsResponseSchema.parse(operationsJson), network: NetworkResponseSchema.parse(networkJson), inputs: InputsResponseSchema.parse(inputsJson) };
  return opsCache;
}

/** Fake A1: filters the canned signals exactly as the real provider must (window overlap, stations or nationwide, kinds). */
export function createFixtureSignalProvider(): SignalProvider {
  return {
    name: "fixture",
    async getSignals(q) {
      const wanted = new Set(q.stations);
      return loadFixtures()
        .signals.filter(
          (s) =>
            overlaps(s.start, s.end, q.from, q.to) &&
            (s.scope.nationwide || s.scope.stations.some((crs) => wanted.has(crs))) &&
            (!q.kinds || q.kinds.includes(s.kind)),
        )
        .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    },
    async listSources() {
      return loadFixtures().sources.filter((s) => s.lane === "signals");
    },
  };
}

/** Fake A2: 31 stations, and EUS ⇄ MAN departures (the way back mirrors the way there) for Fri 20 – Sun 22 Nov 2026 only. */
export function createFixtureRailProvider(): RailProvider {
  let both: JourneyOption[] | undefined;
  const journeys = () => (both ??= [...loadFixtures().journeyOptions, ...loadFixtures().journeyOptions.map(mirrorJourney)]);
  return {
    name: "fixture",
    async searchStations(query, limit = 8) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const all = loadFixtures().stations;
      const exact = all.filter((s) => s.crs.toLowerCase() === q);
      const rest = all.filter((s) => !exact.includes(s) && [s.name, ...s.aliases].some((n) => n.toLowerCase().includes(q)));
      return [...exact, ...rest].slice(0, limit);
    },
    async getStation(crs) {
      return loadFixtures().stations.find((s) => s.crs === crs.toUpperCase()) ?? null;
    },
    async getJourneyOptions(q) {
      return journeys().filter((j) => {
        if (j.origin !== q.origin || j.destination !== q.destination) return false;
        const local = utcToLondon(j.departAt);
        return local.date >= q.dateFrom && local.date <= q.dateTo && local.time >= q.earliest && local.time <= q.latest;
      });
    },
    async getFareCurve(journeyId, bookingDate) {
      const journey = journeys().find((j) => j.id === journeyId);
      return journey ? fixtureFareCurve(journey, bookingDate) : null;
    },
    async listSources() {
      return loadFixtures().sources.filter((s) => s.lane === "rail");
    },
    async listRoutes() {
      return [
        { origin: FIXTURE_QUERY.origin, destination: FIXTURE_QUERY.destination, operator: "VT" },
        { origin: FIXTURE_QUERY.destination, destination: FIXTURE_QUERY.origin, operator: "VT" },
      ];
    },
  };
}

/** Fake A3: the canned EUS → MAN answer, or its mirror for MAN → EUS, whatever the dates (with a warning for any other route). */
export function createFixtureEngine(): Engine {
  return {
    name: "fixture",
    async recommend(q) {
      const canned = loadFixtures().recommendation;
      const there = q.origin === FIXTURE_QUERY.origin && q.destination === FIXTURE_QUERY.destination;
      const back = q.origin === FIXTURE_QUERY.destination && q.destination === FIXTURE_QUERY.origin;
      const base = back ? mirrorRecommendation(canned) : canned;
      return {
        ...base,
        query: q,
        warnings:
          there || back
            ? base.warnings
            : [...base.warnings, `Fixture engine: showing the canned ${FIXTURE_QUERY.origin} → ${FIXTURE_QUERY.destination} example, not ${q.origin} → ${q.destination}.`],
      };
    },
    async operations(q) {
      const canned = loadOperationsFixtures().operations;
      const same = q.origin === canned.query.origin && q.destination === canned.query.destination;
      return {
        ...canned,
        query: { ...q, bookingDate: q.bookingDate ?? canned.query.bookingDate },
        warnings: same ? canned.warnings : [...canned.warnings, `Fixture engine: showing the canned ${canned.query.origin} → ${canned.query.destination} board, not ${q.origin} → ${q.destination}.`],
      };
    },
    async network(q) {
      const canned = loadOperationsFixtures().network;
      return { ...canned, query: { ...q, bookingDate: q.bookingDate ?? canned.query.bookingDate } };
    },
    async inputs(q) {
      const canned = loadOperationsFixtures().inputs;
      return { ...canned, query: { ...q, bookingDate: q.bookingDate ?? canned.query.bookingDate } };
    },
  };
}
