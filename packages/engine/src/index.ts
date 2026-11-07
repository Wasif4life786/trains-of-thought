import {
  CONTRACT_VERSION,
  addMinutes,
  datesBetween,
  daysBetween,
  londonToday,
  toIsoUtc,
  utcToLondon,
  type Engine,
  type EngineDeps,
  type RecommendationResponse,
  type Signal,
  type SourceStatus,
} from "@tot/shared";
import { adviseBooking, buildHeatmap } from "./advice";
import { assess, scoreAll, touches } from "./model";

export { KIND_WEIGHT, assess, proximity, risk, scoreAll, touches, verdictFor } from "./model";
export { adviseBooking, buildHeatmap } from "./advice";

const FORECAST_HORIZON_DAYS = 16;
const dayMonth = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * A3 · Controller: turns the rail lane's departures and the signal lane's world data into ranked, explained
 * recommendations (contract.md §5.5). It only sees the injected providers, never a concrete lane.
 */
export function createEngine(deps: EngineDeps): Engine {
  return {
    name: "engine",

    async recommend(q): Promise<RecommendationResponse> {
      const now = deps.now?.() ?? new Date();
      const bookingDate = q.bookingDate ?? londonToday(now);
      const query = { ...q, bookingDate };
      const warnings: string[] = [];

      const journeys = await deps.rail.getJourneyOptions({
        origin: q.origin,
        destination: q.destination,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        earliest: q.earliest,
        latest: q.latest,
        bookingDate,
      });
      const sources = await listSources(deps, warnings);
      const base = { contractVersion: CONTRACT_VERSION, generatedAt: toIsoUtc(now), query, sources };

      if (journeys.length === 0) {
        warnings.push(`No trains found from ${q.origin} to ${q.destination} between ${q.earliest} and ${q.latest} on those dates. We may not have this route yet.`);
        return { ...base, best: null, options: [], heatmap: buildHeatmap([], datesBetween(q.dateFrom, q.dateTo), q.earliest, q.latest), signals: [], bookingAdvice: null, warnings };
      }

      const stationCodes = [...new Set(journeys.flatMap((j) => [j.origin, j.destination, ...j.callingPoints]))];
      let signals: Signal[] = [];
      try {
        signals = await deps.signals.getSignals({
          from: addMinutes(journeys[0]!.departAt, -60),
          to: addMinutes(journeys.reduce((latest, j) => (j.arriveAt > latest ? j.arriveAt : latest), journeys[0]!.arriveAt), 60),
          stations: stationCodes,
        });
      } catch {
        warnings.push("World-data sources (weather, events, disruption) are unavailable, so reliability reflects punctuality history only.");
      }

      const names = new Map<string, string>();
      await Promise.all(
        [...new Set([...stationCodes, ...signals.flatMap((s) => s.scope.stations.slice(0, 12))])].map(async (crs) => {
          names.set(crs, (await deps.rail.getStation(crs).catch(() => null))?.name ?? crs);
        }),
      );
      const name = (crs: string) => names.get(crs) ?? crs;

      const options = scoreAll(
        journeys,
        journeys.map((j) => assess(j, touches(j, signals), name)),
        q.priority,
      );
      const best = options.find((o) => o.verdict === "best") ?? null;

      const cited = new Set(options.flatMap((o) => o.reasons.flatMap((r) => (r.signalId ? [r.signalId] : []))));
      const citedSignals = signals.filter((s) => cited.has(s.id)).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

      let bookingAdvice = null;
      if (best) {
        const curve = await deps.rail.getFareCurve(best.journey.id, bookingDate).catch(() => null);
        if (curve) bookingAdvice = adviseBooking(best, curve, bookingDate);
      }

      if (daysBetween(bookingDate, q.dateTo) > FORECAST_HORIZON_DAYS) warnings.push(`Weather forecasts only reach ${FORECAST_HORIZON_DAYS} days ahead, so weather risk isn't included for the later days you chose.`);
      if (journeys.some((j) => daysBetween(bookingDate, utcToLondon(j.departAt).date) > 84)) warnings.push("Advance fares more than 12 weeks away aren't on sale yet, so those trains show walk-up prices.");
      const provisional = [...new Set(citedSignals.filter((s) => s.kind === "football" && s.confidence < 0.7).map((s) => dayMonth(utcToLondon(s.start).date)))];
      if (provisional.length > 0) warnings.push(`Kick-off times for ${provisional.join(", ")} are provisional until the TV picks are announced.`);
      if (citedSignals.some((s) => s.kind === "weather" && s.confidence < 0.5)) warnings.push("Weather more than a week out is low-confidence and weighted down.");

      return {
        ...base,
        best,
        options,
        heatmap: buildHeatmap(options, datesBetween(q.dateFrom, q.dateTo), q.earliest, q.latest),
        signals: citedSignals,
        bookingAdvice,
        warnings,
      };
    },
  };
}

async function listSources(deps: EngineDeps, warnings: string[]): Promise<SourceStatus[]> {
  const [signals, rail] = await Promise.allSettled([deps.signals.listSources(), deps.rail.listSources()]);
  const sources = [...(signals.status === "fulfilled" ? signals.value : []), ...(rail.status === "fulfilled" ? rail.value : [])];
  if (signals.status === "rejected") warnings.push("Couldn't read the world-data source list.");
  for (const s of sources) if (s.mode === "down") warnings.push(`${s.name} is down: using what we have.`);
  if (sources.some((s) => s.id.startsWith("seed:rail"))) warnings.push("Timetables, fares and punctuality history are modelled sample data, not live feeds.");
  return sources;
}
