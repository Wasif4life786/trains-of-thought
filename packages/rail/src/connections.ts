import { TICKET_TYPES, addMinutes, type Fare, type JourneyOption } from "@tot/shared";
import { round } from "./data";
import { loadRoutes, servicesOn, type Route, type Service } from "./routes";

/** Shortest and longest wait at the interchange (minutes) for a connection we'll offer. */
export const MIN_CONNECTION_MIN = 10;
export const MAX_CONNECTION_MIN = 90;

export interface Connection {
  hub: string;
  first: { route: Route; service: Service };
  second: { route: Route; service: Service };
}

/**
 * One-change itineraries from `origin` to `destination` on a London date: two routes that meet at a hub (an end of both).
 * For each first-leg departure the earliest workable second leg, and per departure the hub that gets there soonest, so every
 * departure appears once. Journeys that need more than one change are not offered.
 */
export function findConnections(
  origin: string,
  destination: string,
  date: string,
  /** Where each leg's trains come from: the real timetable in the provider, the modelled pattern by default. */
  services: (route: Route, reverse: boolean, date: string) => Service[] = servicesOn,
): Connection[] {
  const routes = loadRoutes();
  const best = new Map<string, Connection>();
  for (const r1 of routes) {
    if (r1.from !== origin && r1.to !== origin) continue;
    const reverse1 = r1.to === origin;
    const hub = reverse1 ? r1.from : r1.to;
    if (hub === destination) continue;
    for (const r2 of routes) {
      if (r2 === r1 || (r2.from !== hub && r2.to !== hub)) continue;
      const reverse2 = r2.to === hub;
      if ((reverse2 ? r2.from : r2.to) !== destination) continue;
      const firsts = services(r1, reverse1, date);
      const seconds = services(r2, reverse2, date);
      for (const first of firsts) {
        const earliest = Date.parse(addMinutes(first.arriveAt, MIN_CONNECTION_MIN));
        const latest = Date.parse(addMinutes(first.arriveAt, MAX_CONNECTION_MIN));
        const second = seconds.find((s) => Date.parse(s.departAt) >= earliest && Date.parse(s.departAt) <= latest);
        if (!second) continue;
        const current = best.get(first.departAt);
        if (!current || second.arriveAt < current.second.service.arriveAt) best.set(first.departAt, { hub, first: { route: r1, service: first }, second: { route: r2, service: second } });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.first.service.departAt.localeCompare(b.first.service.departAt));
}

const order = (f: Fare) => TICKET_TYPES.indexOf(f.ticketType);

/** Adds two legs' fares by ticket type: a type needs to exist on both, and it's flexible only if both are. Cheapest first. */
export function combineFares(a: Fare[], b: Fare[]): Fare[] {
  const second = new Map(b.map((f) => [f.ticketType, f]));
  return a
    .flatMap((f) => {
      const g = second.get(f.ticketType);
      return g ? [{ ticketType: f.ticketType, pricePence: f.pricePence + g.pricePence, flexible: f.flexible && g.flexible }] : [];
    })
    .sort((x, y) => x.pricePence - y.pricePence || order(x) - order(y));
}

/** Two single-leg journeys joined at `hub` as one itinerary with one change. */
export function mergeLegs(a: JourneyOption, b: JourneyOption, hub: string): JourneyOption {
  const durationMin = Math.round((Date.parse(b.arriveAt) - Date.parse(a.departAt)) / 60_000);
  return {
    id: `${a.origin}-${b.destination}-${a.departAt}`,
    origin: a.origin,
    destination: b.destination,
    departAt: a.departAt,
    arriveAt: b.arriveAt,
    durationMin,
    changes: 1,
    operator: a.operator,
    callingPoints: [...a.callingPoints, hub, ...b.callingPoints],
    fares: combineFares(a.fares, b.fares),
    baseline: {
      // Both trains have to run: the chances multiply (a missed connection is folded into the second leg's lateness).
      onTimeProb: round(a.baseline.onTimeProb * b.baseline.onTimeProb, 3),
      cancelProb: round(1 - (1 - a.baseline.cancelProb) * (1 - b.baseline.cancelProb), 3),
      avgDelayMin: round(a.baseline.avgDelayMin + b.baseline.avgDelayMin, 1),
      crowding: Math.max(a.baseline.crowding, b.baseline.crowding),
      peak: a.baseline.peak || b.baseline.peak,
      sampleSize: Math.min(a.baseline.sampleSize, b.baseline.sampleSize),
    },
  };
}
