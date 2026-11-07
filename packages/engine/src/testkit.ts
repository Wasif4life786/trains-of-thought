/** Hand-built journeys, signals and stub providers for the engine's tests: small, exact and easy to reason about. */
import type { FareCurve, JourneyOption, JourneyQuery, RailProvider, RecommendationQuery, Signal, SignalProvider } from "@tot/shared";

export const journey = (o: Partial<JourneyOption> = {}): JourneyOption => ({
  id: "EUS-MAN-2026-11-21T09:00:00Z",
  origin: "EUS",
  destination: "MAN",
  departAt: "2026-11-21T09:00:00Z",
  arriveAt: "2026-11-21T11:08:00Z",
  durationMin: 128,
  changes: 0,
  operator: "VT",
  callingPoints: ["MKC", "SOT"],
  fares: [
    { ticketType: "advance", pricePence: 3000, flexible: false },
    { ticketType: "anytime", pricePence: 21400, flexible: true },
  ],
  baseline: { onTimeProb: 0.9, cancelProb: 0.01, avgDelayMin: 3, crowding: 0.4, peak: false, sampleSize: 20 },
  ...o,
});

export const signal = (o: Partial<Signal> = {}): Signal => ({
  id: "test:1",
  kind: "football",
  title: "Man City v Fulham",
  source: "test",
  start: "2026-11-21T10:50:00Z",
  end: "2026-11-21T18:00:00Z",
  scope: { stations: ["MAN"], operators: [], nationwide: false },
  severity: 0.8,
  confidence: 0.6,
  ...o,
});

export const query = (o: Partial<RecommendationQuery> = {}): RecommendationQuery => ({
  origin: "EUS",
  destination: "MAN",
  dateFrom: "2026-11-21",
  dateTo: "2026-11-21",
  earliest: "06:00",
  latest: "22:00",
  priority: 0.5,
  bookingDate: "2026-11-07",
  ...o,
});

export function stubRail(journeys: JourneyOption[], curve: FareCurve | null = null): RailProvider & { lastQuery?: JourneyQuery } {
  const rail: RailProvider & { lastQuery?: JourneyQuery } = {
    name: "stub",
    async searchStations() {
      return [];
    },
    async getStation(crs) {
      return { crs, name: `Station ${crs}`, lat: 52, lon: -1, aliases: [] };
    },
    async getJourneyOptions(q) {
      rail.lastQuery = q;
      return journeys;
    },
    async getFareCurve() {
      return curve;
    },
    async listSources() {
      return [];
    },
  };
  return rail;
}

export const stubSignals = (signals: Signal[], fail = false): SignalProvider => ({
  name: "stub",
  async getSignals() {
    if (fail) throw new Error("boom");
    return signals;
  },
  async listSources() {
    return [];
  },
});
