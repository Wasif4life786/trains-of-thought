import { z } from "zod";
import { Crs, LocalTime, addMinutes, londonToUtc, utcToLondon } from "@tot/shared";
import { readRaw } from "./data";

const Pattern = z.object({
  minute: z.number().int().min(0).max(59),
  durationMin: z.number().int().positive(),
  callingPoints: z.array(Crs),
  /** Hours this pattern runs (default: every hour between first and last departure). */
  hours: z.array(z.number().int().min(0).max(23)).optional(),
  operator: z.string().optional(),
});

const DayTimes = z.object({ weekday: LocalTime, saturday: LocalTime, sunday: LocalTime });

const RouteSchema = z.object({
  id: z.string(),
  from: Crs,
  to: Crs,
  operator: z.string(),
  first: DayTimes,
  last: DayTimes,
  patterns: z.array(Pattern).min(1),
  /** Only used to generate the synthetic punctuality history. */
  onTimeBase: z.number().min(0).max(1),
  crowdingBias: z.number().min(-0.5).max(0.5),
});

export type Route = z.infer<typeof RouteSchema>;
export type DayType = "weekday" | "saturday" | "sunday";

/** ISO weekday (1 = Monday … 7 = Sunday) → the day type timetables are written for. */
export const dayType = (weekday: number): DayType => (weekday <= 5 ? "weekday" : weekday === 6 ? "saturday" : "sunday");

export interface Service {
  routeId: string;
  origin: string;
  destination: string;
  operator: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  /** Intermediate stops in running order for this direction. */
  callingPoints: string[];
  /** London calendar date and departure time. */
  date: string;
  time: string;
  /** ISO weekday of `date`. */
  weekday: number;
}

let cached: Route[] | undefined;

export function loadRoutes(): Route[] {
  cached ??= z.object({ routes: z.array(RouteSchema) }).parse(JSON.parse(readRaw("routes.json"))).routes;
  return cached;
}

/** Routes joining two stations, in either direction. */
export function findRoutes(origin: string, destination: string): { route: Route; reverse: boolean }[] {
  return loadRoutes().flatMap<{ route: Route; reverse: boolean }>((route) => {
    if (route.from === origin && route.to === destination) return [{ route, reverse: false }];
    if (route.from === destination && route.to === origin) return [{ route, reverse: true }];
    return [];
  });
}

/** Every departure on one London date, earliest first. */
export function servicesOn(route: Route, reverse: boolean, date: string): Service[] {
  const weekday = utcToLondon(londonToUtc(date, "12:00")).weekday;
  const type = dayType(weekday);
  const first = route.first[type];
  const last = route.last[type];
  const out: Service[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const p of route.patterns) {
      if (p.hours && !p.hours.includes(hour)) continue;
      const time = `${String(hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
      if (time < first || time > last) continue;
      const departAt = londonToUtc(date, time);
      out.push({
        routeId: route.id,
        origin: reverse ? route.to : route.from,
        destination: reverse ? route.from : route.to,
        operator: p.operator ?? route.operator,
        departAt,
        arriveAt: addMinutes(departAt, p.durationMin),
        durationMin: p.durationMin,
        callingPoints: reverse ? [...p.callingPoints].reverse() : p.callingPoints,
        date,
        time,
        weekday,
      });
    }
  }
  return out.sort((a, b) => a.departAt.localeCompare(b.departAt));
}

const ID = /^([A-Z]{3})-([A-Z]{3})-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/;

/** "EUS-MAN-2026-11-21T09:00:00Z" → its parts, or null. */
export function parseJourneyId(id: string): { origin: string; destination: string; departAt: string } | null {
  const m = ID.exec(id);
  return m ? { origin: m[1]!, destination: m[2]!, departAt: m[3]! } : null;
}
