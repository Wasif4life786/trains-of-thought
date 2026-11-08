import {
  CONTRACT_VERSION,
  addMinutes,
  datesBetween,
  daysBetween,
  londonToUtc,
  londonToday,
  toIsoUtc,
  utcToLondon,
  OPERATIONS_DEFAULTS,
  type Corridor,
  type DisruptionAlert,
  type Engine,
  type EngineDeps,
  type ExposurePoint,
  type InputsResponse,
  type Mitigation,
  type NetworkQuery,
  type NetworkResponse,
  type SignalImpact,
  type Station,
  type OperationsQuery,
  type OperationsResponse,
  type RecommendationResponse,
  type RouteRef,
  type RouteSummary,
  type ServiceRisk,
  type Signal,
  type SourceStatus,
} from "@tot/shared";
import { adviseBooking, buildHeatmap } from "./advice";
import { assess, demandAdjusted, scoreAll, touches } from "./model";
import { assessService, buildExposure, totalsOf, worstRisk } from "./operations";

export { KIND_WEIGHT, assess, demandAdjusted, proximity, risk, scoreAll, touches, verdictFor } from "./model";
export { adviseBooking, buildHeatmap } from "./advice";
export { CAPACITY, CLAIM_RATE, assessService, bandShares, buildExposure, forecastDelay, payout, riskLevelFor, totalsOf } from "./operations";

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
        ...(q.railcard ? { railcard: q.railcard } : {}),
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

      // Price first: a big event at the destination makes Advance fares dearer, and everything downstream uses those prices.
      const priced = journeys.map((j) => {
        const touching = touches(j, signals);
        return { touching, ...demandAdjusted(j, touching, name) };
      });
      const options = scoreAll(
        priced.map((p) => p.journey),
        priced.map((p) => {
          const a = assess(p.journey, p.touching, name);
          return p.reason ? { ...a, reasons: [...a.reasons, p.reason] } : a;
        }),
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

    async operations(q) {
      return operations(deps, q);
    },

    async network(q): Promise<NetworkResponse> {
      const now = deps.now?.() ?? new Date();
      const warnings: string[] = [];
      const boards = await sweep(deps, q, warnings);
      const services = boards.flatMap((b) => b.board.services);
      const signals = new Map(boards.flatMap((b) => b.board.signals.map((s) => [s.id, s] as const)));

      const summaries: RouteSummary[] = boards
        .map(({ route, board }) => ({ ...route, services: board.totals.services, highRiskServices: board.totals.highRiskServices, expectedCostPence: board.totals.expectedCostPence, baselineCostPence: board.totals.baselineCostPence, mitigationSavingPence: board.totals.mitigationSavingPence }))
        .sort((a, b) => b.expectedCostPence - a.expectedCostPence);

      const alerts: DisruptionAlert[] = [...signals.values()]
        .map((signal) => alertFor(signal, boards))
        .filter((a) => a.expectedCostPence > 0)
        .sort((a, b) => b.expectedCostPence - a.expectedCostPence || a.signal.start.localeCompare(b.signal.start));

      const sources = await listSources(deps, warnings);
      warnings.push(...new Set(boards.flatMap((b) => b.board.warnings)));
      return {
        contractVersion: CONTRACT_VERSION,
        generatedAt: toIsoUtc(now),
        query: q,
        alerts,
        routes: summaries,
        totals: totalsOf(services),
        sources,
        warnings,
      };
    },

    async inputs(q): Promise<InputsResponse> {
      const now = deps.now?.() ?? new Date();
      const warnings: string[] = [];
      const boards = await sweep(deps, q, warnings);

      // Every hour of every London day in the window, and which slot a departure falls in.
      const timeline = datesBetween(q.dateFrom, q.dateTo).flatMap((date) => Array.from({ length: 24 }, (_, h) => londonToUtc(date, `${String(h).padStart(2, "0")}:00`)));
      const slot = new Map(timeline.map((at, i) => [at, i]));
      const slotOf = (s: ServiceRisk) => {
        const local = utcToLondon(s.journey.departAt);
        return slot.get(londonToUtc(local.date, `${String(local.hour).padStart(2, "0")}:00`));
      };

      // Corridors: both directions of a route merged; stops in running order from the first direction seen.
      const corridors = new Map<string, Corridor & { onTimeSum: number }>();
      for (const { route, board } of boards) {
        const key = [route.origin, route.destination].sort().join("-");
        const c = corridors.get(key) ?? { ...route, stops: [route.origin, route.destination], services: 0, onTimeProb: 0, onTimeSum: 0, exposureByHour: timeline.map(() => 0) };
        if (c.origin === route.origin) {
          const longest = board.services.reduce<string[]>((best, s) => (s.journey.callingPoints.length > best.length ? s.journey.callingPoints : best), []);
          if (longest.length + 2 > c.stops.length) c.stops = [route.origin, ...longest, route.destination];
        }
        for (const s of board.services) {
          c.services += 1;
          c.onTimeSum += s.journey.baseline.onTimeProb;
          const i = slotOf(s);
          if (i !== undefined) c.exposureByHour[i]! += s.compensation.expectedCostPence;
        }
        corridors.set(key, c);
      }
      const corridorList: Corridor[] = [...corridors.values()].map(({ onTimeSum, ...c }) => ({ ...c, onTimeProb: c.services ? Math.round((onTimeSum / c.services) * 1000) / 1000 : 0 }));

      const services = boards.flatMap((b) => b.board.services);
      const points: ExposurePoint[] = timeline.map((at) => ({ at, services: 0, expectedCostPence: 0, baselineCostPence: 0 }));
      for (const s of services) {
        const i = slotOf(s);
        if (i === undefined) continue;
        points[i]!.services += 1;
        points[i]!.expectedCostPence += s.compensation.expectedCostPence;
        points[i]!.baselineCostPence += s.compensation.baselineCostPence;
      }

      const codes = [...new Set(corridorList.flatMap((c) => c.stops))];
      const stations = (await Promise.all(codes.map((crs) => deps.rail.getStation(crs).catch(() => null)))).filter((s): s is Station => s !== null);

      // Every signal in the window, not only the ones that add cost: the explorer shows all the evidence.
      const known = new Map(boards.flatMap((b) => b.board.signals.map((s) => [s.id, s] as const)));
      if (timeline.length > 0 && codes.length > 0) {
        try {
          for (const s of await deps.signals.getSignals({ from: timeline[0]!, to: addMinutes(timeline.at(-1)!, 60), stations: codes })) if (!known.has(s.id)) known.set(s.id, s);
        } catch {
          warnings.push("World-data sources are unavailable, so only signals already cited by the forecast are shown.");
        }
      }
      const signals: SignalImpact[] = [...known.values()]
        .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
        .map((signal) => {
          const a = alertFor(signal, boards);
          return { signal, expectedCostPence: a.expectedCostPence, affectedServices: a.affectedServices, routes: a.routes };
        });

      const sources = await listSources(deps, warnings);
      return { contractVersion: CONTRACT_VERSION, generatedAt: toIsoUtc(now), query: q, stations, corridors: corridorList, signals, timeline: points, sources, warnings };
    },
  };
}

/** The operator board for every route direction the rail lane knows, over the whole operating day. */
async function sweep(deps: EngineDeps, q: NetworkQuery, warnings: string[]): Promise<{ route: RouteRef; board: OperationsResponse }[]> {
  const routes: RouteRef[] = deps.rail.listRoutes ? await deps.rail.listRoutes().catch(() => []) : [];
  if (routes.length === 0) warnings.push("The rail data source can't list its routes, so there is nothing to sweep.");
  return Promise.all(
    routes.map(async (route) => ({
      route,
      board: await operations(deps, { ...route, dateFrom: q.dateFrom, dateTo: q.dateTo, ...OPERATIONS_DEFAULTS, bookingDate: q.bookingDate }, { quiet: true }),
    })),
  );
}

/** One signal's network-wide footprint: every service it touches, what it adds, and the best action against it. */
function alertFor(signal: Signal, boards: { route: RouteRef; board: OperationsResponse }[]): DisruptionAlert {
  const hit: { route: RouteRef; service: ServiceRisk; cost: number }[] = [];
  for (const { route, board } of boards) {
    for (const service of board.services) {
      const reason = service.reasons.find((r) => r.signalId === signal.id);
      if (reason) hit.push({ route, service, cost: reason.compensationPence ?? 0 });
    }
  }
  const routes = [...new Map(hit.map((h) => [`${h.route.origin}-${h.route.destination}`, h.route])).values()];

  const byKind = new Map<string, Mitigation[]>();
  for (const { service } of hit) for (const m of service.mitigations) if (m.signalId === signal.id) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
  const action =
    [...byKind.values()]
      .map((ms): Mitigation => {
        const costPence = ms.reduce((n, m) => n + m.costPence, 0);
        const savingPence = ms.reduce((n, m) => n + m.savingPence, 0);
        return { ...ms[0]!, detail: `${ms[0]!.detail} (${ms.length} service${ms.length === 1 ? "" : "s"})`, costPence, savingPence, netPence: savingPence - costPence };
      })
      .sort((a, b) => b.netPence - a.netPence)[0] ?? null;

  return {
    id: signal.id,
    signal,
    riskLevel: worstRisk(hit.map((h) => h.service.riskLevel)) ?? "low",
    routes,
    affectedServices: hit.length,
    expectedCostPence: hit.reduce((n, h) => n + h.cost, 0),
    action,
  };
}

/** The operator board for one route direction (contract.md §5.6). `quiet` skips source listing for network sweeps. */
async function operations(deps: EngineDeps, q: OperationsQuery, opts: { quiet?: boolean } = {}): Promise<OperationsResponse> {
  const now = deps.now?.() ?? new Date();
  const bookingDate = q.bookingDate ?? londonToday(now);
  const query = { ...q, bookingDate };
  const warnings: string[] = [];
  const dates = datesBetween(q.dateFrom, q.dateTo);

  const journeys = await deps.rail.getJourneyOptions({ ...query, bookingDate });
  const sources = opts.quiet ? [] : await listSources(deps, warnings);
  const base = { contractVersion: CONTRACT_VERSION, generatedAt: toIsoUtc(now), query, sources };
  if (journeys.length === 0) {
    warnings.push(`No services found from ${q.origin} to ${q.destination} between ${q.earliest} and ${q.latest} on those dates. We may not have this route yet.`);
    return { ...base, services: [], heatmap: buildExposure([], dates, q.earliest, q.latest), totals: totalsOf([]), signals: [], warnings };
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
    warnings.push("World-data sources (weather, events, disruption) are unavailable, so the forecast reflects punctuality history only.");
  }

  const names = new Map<string, string>();
  await Promise.all(
    [...new Set([...stationCodes, ...signals.flatMap((s) => s.scope.stations.slice(0, 12))])].map(async (crs) => {
      names.set(crs, (await deps.rail.getStation(crs).catch(() => null))?.name ?? crs);
    }),
  );
  const name = (crs: string) => names.get(crs) ?? crs;

  const services = journeys.map((journey) => assessService({ journey, touching: touches(journey, signals) }, name));
  const cited = new Set(services.flatMap((s) => [...s.reasons, ...s.mitigations].flatMap((r) => (r.signalId ? [r.signalId] : []))));

  if (daysBetween(bookingDate, q.dateTo) > FORECAST_HORIZON_DAYS) warnings.push(`Weather forecasts only reach ${FORECAST_HORIZON_DAYS} days ahead, so weather risk isn't included for the later days.`);
  warnings.push("Passenger loads, the 25% claim rate and mitigation costs are modelled assumptions (sample), not operator data.");

  return {
    ...base,
    services,
    heatmap: buildExposure(services, dates, q.earliest, q.latest),
    totals: totalsOf(services),
    signals: signals.filter((s) => cited.has(s.id)).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
    warnings,
  };
}

async function listSources(deps: EngineDeps, warnings: string[]): Promise<SourceStatus[]> {
  const [signals, rail] = await Promise.allSettled([deps.signals.listSources(), deps.rail.listSources()]);
  const sources = [...(signals.status === "fulfilled" ? signals.value : []), ...(rail.status === "fulfilled" ? rail.value : [])];
  if (signals.status === "rejected") warnings.push("Couldn't read the world-data source list.");
  for (const s of sources) if (s.mode === "down") warnings.push(`${s.name} is down: using what we have.`);
  const realPunctuality = sources.find((s) => s.id === "rail:rtt");
  if (realPunctuality) warnings.push(`Punctuality is real: ${realPunctuality.name}. Timetables and fares are modelled sample data.`);
  else if (sources.some((s) => s.id.startsWith("seed:rail"))) warnings.push("Timetables, fares and punctuality history are modelled sample data, not live feeds.");
  return sources;
}
