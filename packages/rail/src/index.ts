import {
  addDays,
  addMinutes,
  londonToUtc,
  toIsoUtc,
  discountFares,
  daysBetween,
  datesBetween,
  utcToLondon,
  type FareCurve,
  type FarePoint,
  type JourneyOption,
  type RailProvider,
  type RouteRef,
  type SourceStatus,
} from "@tot/shared";
import { combineFares, findConnections, mergeLegs } from "./connections";
import { ADVANCE_ON_SALE_DAYS, faresFor, loadFares } from "./fares";
import { crowding, isPeak } from "./peak";
import { loadPerformance } from "./performance";
import { findRoutes, loadRoutes, parseJourneyId, servicesOn, type Route, type Service } from "./routes";
import type { RouteInfo, RttHistory } from "./rtt";
import { loadStations } from "./stations";

export { cleanStationName } from "./stations";

function loadModel() {
  const stations = loadStations();
  const routes = loadRoutes();
  const fares = loadFares();
  const known = new Set(routes.flatMap((r) => [`${r.from}-${r.to}`, `${r.to}-${r.from}`]));
  const routeInfo = (direction: string): RouteInfo | undefined => {
    const [a = "", b = ""] = direction.split("-");
    const r = routes.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
    const durationMin = r?.patterns[0]?.durationMin;
    return r && durationMin ? { durationMin, operator: r.operator, originName: stations.byCrs.get(a)?.name ?? a } : undefined;
  };
  return { stations, routes, fares, known, routeInfo };
}

/**
 * The trains on one route direction on a London date. Real Realtime Trains schedules when we have them (the date
 * itself if it was fetched, else the most complete fetched day of the same weekday: timetables repeat weekly, and
 * Mon–Fri stand in for each other), otherwise the modelled pattern in routes.json.
 */
export function servicesFor(route: Route, reverse: boolean, date: string, timetable: RttHistory["timetable"]): Service[] {
  const origin = reverse ? route.to : route.from;
  const destination = reverse ? route.from : route.to;
  const days = timetable.get(`${origin}-${destination}`);
  if (!days || days.size === 0) return servicesOn(route, reverse, date);
  const weekday = utcToLondon(londonToUtc(date, "12:00")).weekday;
  const weekdayOf = (d: string) => utcToLondon(londonToUtc(d, "12:00")).weekday;
  const pick = (ok: (w: number) => boolean) =>
    [...days.entries()].filter(([d]) => ok(weekdayOf(d))).sort((x, y) => y[1].length - x[1].length || y[0].localeCompare(x[0]))[0]?.[1];
  const real = days.get(date) ?? pick((w) => w === weekday) ?? (weekday <= 5 ? pick((w) => w <= 5) : undefined);
  if (!real || real.length === 0) return servicesOn(route, reverse, date);

  const pattern = route.patterns[0]!;
  const seen = new Set<string>();
  return real
    .filter((r) => !seen.has(r.time) && Boolean(seen.add(r.time)))
    .map((r) => {
      const departAt = londonToUtc(date, r.time);
      return {
        routeId: route.id,
        origin,
        destination,
        operator: r.operator || route.operator,
        departAt,
        arriveAt: addMinutes(departAt, r.durationMin),
        durationMin: r.durationMin,
        callingPoints: reverse ? [...pattern.callingPoints].reverse() : pattern.callingPoints,
        date,
        time: r.time,
        weekday,
      };
    });
}

/**
 * A2 · Timetabler: stations, departures, fares and punctuality, from raw data in data/raw/rail cleaned in code.
 * The timetable, fares and punctuality history are MODELLED seeds (contract.md §4.3), so every source says `seed`.
 */
export function createRailProvider(): RailProvider {
  let model: ReturnType<typeof loadModel> | undefined;
  // Punctuality is looked up on every call: it reloads itself when new Realtime Trains days have been fetched.
  const data = () => {
    model ??= loadModel();
    return { ...model, performance: loadPerformance(model.stations, model.known, model.routeInfo) };
  };
  const services = (route: Route, reverse: boolean, date: string) => servicesFor(route, reverse, date, data().performance.rtt.timetable);

  function journeyFor(service: Service, routeId: string, bookingDate: string): JourneyOption | null {
    const { fares, performance } = data();
    const table = fares.tables.get(routeId);
    const route = loadRoutes().find((r) => r.id === routeId);
    if (!table || !route) return null;
    const id = `${service.origin}-${service.destination}-${service.departAt}`;
    const hour = Number(service.time.slice(0, 2));
    return {
      id,
      origin: service.origin,
      destination: service.destination,
      departAt: service.departAt,
      arriveAt: service.arriveAt,
      durationMin: service.durationMin,
      changes: 0,
      operator: service.operator,
      callingPoints: service.callingPoints,
      fares: faresFor(table, id, service.weekday, service.time, daysBetween(bookingDate, service.date)),
      baseline: {
        ...performance.model.get(`${service.origin}-${service.destination}`, service.weekday, hour),
        crowding: crowding(service.weekday, service.time, route.crowdingBias),
        peak: isPeak(service.weekday, service.time),
      },
    };
  }

  return {
    name: "rail-model",

    async searchStations(query, limit = 8) {
      return data().stations.search(query, limit);
    },

    async getStation(crs) {
      return data().stations.byCrs.get(crs.trim().toUpperCase()) ?? null;
    },

    async getJourneyOptions(q) {
      const out: JourneyOption[] = [];
      const direct = findRoutes(q.origin, q.destination);
      if (direct.length === 0) {
        for (const date of datesBetween(q.dateFrom, q.dateTo)) {
          for (const c of findConnections(q.origin, q.destination, date, services)) {
            if (c.first.service.time < q.earliest || c.first.service.time > q.latest) continue;
            const a = journeyFor(c.first.service, c.first.route.id, q.bookingDate);
            const b = journeyFor(c.second.service, c.second.route.id, q.bookingDate);
            if (!a || !b) continue;
            const merged = mergeLegs(a, b, c.hub);
            out.push(q.railcard ? { ...merged, fares: discountFares(merged.fares, q.railcard, merged.departAt) } : merged);
          }
        }
        return out.sort((x, y) => x.departAt.localeCompare(y.departAt));
      }
      for (const { route, reverse } of direct) {
        for (const date of datesBetween(q.dateFrom, q.dateTo)) {
          for (const service of services(route, reverse, date)) {
            if (service.time < q.earliest || service.time > q.latest) continue;
            const journey = journeyFor(service, route.id, q.bookingDate);
            if (journey) out.push(q.railcard ? { ...journey, fares: discountFares(journey.fares, q.railcard, journey.departAt) } : journey);
          }
        }
      }
      return out.sort((a, b) => a.departAt.localeCompare(b.departAt));
    },

    async getFareCurve(journeyId, bookingDate): Promise<FareCurve | null> {
      const parsed = parseJourneyId(journeyId);
      if (!parsed) return null;
      const date = utcToLondon(parsed.departAt).date;
      if (findRoutes(parsed.origin, parsed.destination).length === 0) {
        const c = findConnections(parsed.origin, parsed.destination, date, services).find((x) => x.first.service.departAt === parsed.departAt);
        const tableA = c && data().fares.tables.get(c.first.route.id);
        const tableB = c && data().fares.tables.get(c.second.route.id);
        if (!c || !tableA || !tableB) return null;
        const idA = `${c.first.service.origin}-${c.first.service.destination}-${c.first.service.departAt}`;
        const idB = `${c.second.service.origin}-${c.second.service.destination}-${c.second.service.departAt}`;
        const points: FarePoint[] = [];
        for (let d = ADVANCE_ON_SALE_DAYS; d >= 0; d -= d > 28 ? 7 : 1) {
          const cheapest = combineFares(faresFor(tableA, idA, c.first.service.weekday, c.first.service.time, d), faresFor(tableB, idB, c.second.service.weekday, c.second.service.time, d))[0]!;
          points.push({ date: addDays(date, -d), daysBefore: d, pricePence: cheapest.pricePence, ticketType: cheapest.ticketType });
        }
        return { journeyId, bookingDate, points, advanceOnSale: addDays(date, -ADVANCE_ON_SALE_DAYS) };
      }
      for (const { route, reverse } of findRoutes(parsed.origin, parsed.destination)) {
        const service = services(route, reverse, date).find((s) => s.departAt === parsed.departAt);
        const table = data().fares.tables.get(route.id);
        if (!service || !table) continue;
        const points: FarePoint[] = [];
        for (let d = ADVANCE_ON_SALE_DAYS; d >= 0; d -= d > 28 ? 7 : 1) {
          const cheapest = faresFor(table, journeyId, service.weekday, service.time, d)[0]!;
          points.push({ date: addDays(date, -d), daysBefore: d, pricePence: cheapest.pricePence, ticketType: cheapest.ticketType });
        }
        return { journeyId, bookingDate, points, advanceOnSale: addDays(date, -ADVANCE_ON_SALE_DAYS) };
      }
      return null;
    },

    async listRoutes(): Promise<RouteRef[]> {
      return loadRoutes().flatMap((r) => [
        { origin: r.from, destination: r.to, operator: r.operator },
        { origin: r.to, destination: r.from, operator: r.operator },
      ]);
    },

    async listSources(): Promise<SourceStatus[]> {
      const { stations, routes, fares, performance } = data();
      const patterns = routes.reduce((n, r) => n + r.patterns.length, 0);
      return [
        { id: "rail:stations", name: "UK stations (davwheat/uk-railway-stations)", lane: "rail", mode: "seed", quality: stations.quality, note: "Saved as downloaded; names and aliases cleaned in code" },
        {
          id: "seed:rail-timetable",
          name: `Timetable model (${routes.length} corridors, both ways)`,
          lane: "rail",
          mode: "seed",
          quality: { rowsIn: patterns, rowsOut: patterns, fixed: {}, dropped: {} },
          note: "Modelled service patterns, not a published timetable",
        },
        { id: "seed:rail-fares", name: "Walk-up fares and Advance range", lane: "rail", mode: "seed", quality: fares.quality, note: "Rounded estimates, not an official fares file" },
        {
          id: "seed:rail-performance",
          name: "Punctuality history (synthetic)",
          lane: "rail",
          mode: "seed",
          quality: performance.quality,
          note: performance.rtt.mode ? "Fallback where real history is thin: real Realtime Trains arrivals take precedence" : "Synthetic history generated to look like a messy export",
        },
        ...(performance.rtt.mode
          ? [
              {
                id: "rail:rtt",
                name: `Real arrivals, Realtime Trains (${performance.rtt.routes} route directions, ${performance.rtt.days} days)`,
                lane: "rail" as const,
                mode: performance.rtt.mode,
                ...(performance.rtt.fetchedAt ? { fetchedAt: toIsoUtc(performance.rtt.fetchedAt) } : {}),
                quality: performance.rtt.quality,
                note: "Actual arrival lateness at the destination, the measure Delay Repay uses. Data: realtimetrains.co.uk",
              },
            ]
          : []),
      ];
    },
  };
}
