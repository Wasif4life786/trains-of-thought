import { z } from "zod";
import { addMinutes, type Signal } from "@tot/shared";
import { bump, downStatus, fetchText, leadConfidence, readRaw, report, round, type Adapter } from "../util";

const ID = "open-meteo";
const NAME = "Open-Meteo hourly forecast";

export interface WeatherPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stations: string[];
}

const Points = z.object({ points: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number(), stations: z.array(z.string()) })) });
const Hourly = z.object({
  time: z.array(z.string()),
  temperature_2m: z.array(z.number().nullable()),
  precipitation: z.array(z.number().nullable()),
  wind_gusts_10m: z.array(z.number().nullable()),
  snowfall: z.array(z.number().nullable()),
});
/** Open-Meteo answers with an array for several coordinates, one object for a single one. */
const Forecast = z.union([z.array(z.object({ hourly: Hourly })), z.object({ hourly: Hourly }).transform((one) => [one])]);

const KMH_PER_MPH = 1.609344;

type Cause = "gusts" | "rain" | "snow" | "heat";
interface Hazard {
  cause: Cause;
  severity: number;
  /** The number that earned the severity, in the unit shown to people. */
  value: number;
}

/** The worst thing happening in one hour, by the rubric of contract.md §4.5; null when nothing reaches a threshold. */
export function hazardFor(gustKmh: number, rainMm: number, snowCm: number, tempC: number): Hazard | null {
  const gust = gustKmh / KMH_PER_MPH;
  const candidates: Hazard[] = [];
  if (gust >= 40) candidates.push({ cause: "gusts", severity: gust >= 70 ? 1 : gust >= 60 ? 0.8 : gust >= 50 ? 0.6 : 0.2, value: gust });
  if (snowCm >= 0.2) candidates.push({ cause: "snow", severity: snowCm >= 10 ? 1 : snowCm >= 3 ? 0.8 : snowCm >= 1 ? 0.6 : 0.4, value: snowCm });
  if (rainMm >= 2) candidates.push({ cause: "rain", severity: rainMm >= 15 ? 0.8 : rainMm >= 8 ? 0.6 : rainMm >= 4 ? 0.4 : 0.2, value: rainMm });
  if (tempC >= 27) candidates.push({ cause: "heat", severity: tempC >= 33 ? 0.8 : tempC >= 30 ? 0.6 : 0.2, value: tempC });
  return candidates.reduce<Hazard | null>((worst, h) => (!worst || h.severity > worst.severity ? h : worst), null);
}

const TITLE: Record<Cause, (v: number) => string> = {
  gusts: (v) => `Strong winds, gusts to ${Math.round(v)} mph`,
  rain: (v) => `Heavy rain, ${round(v, 1)} mm an hour`,
  snow: (v) => `Snow, ${round(v, 1)} cm an hour`,
  heat: (v) => `Hot weather, ${Math.round(v)} °C`,
};
const METRIC: Record<Cause, string> = { gusts: "windGustMph", rain: "precipitationMmPerHour", snow: "snowfallCmPerHour", heat: "temperatureC" };

interface Window {
  cause: Cause;
  firstIdx: number;
  lastIdx: number;
  severity: number;
  peak: number;
}

/**
 * Hourly forecast → weather signals: hours above a threshold merge into windows (gaps of one hour are bridged), each
 * window is a signal covering the hours plus an hour for the railway to recover. `asOf` is when the forecast was made.
 */
export function buildWeather(points: WeatherPoint[], forecast: z.infer<typeof Forecast>, asOf: Date): { signals: Signal[]; quality: ReturnType<typeof report> } {
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const signals: Signal[] = [];
  let rowsIn = 0;

  forecast.forEach((location, p) => {
    const point = points[p];
    const h = location.hourly;
    rowsIn += h.time.length;
    if (!point) {
      bump(dropped, "no_matching_point", h.time.length);
      return;
    }
    const windows: Window[] = [];
    let open: Window | undefined;

    h.time.forEach((time, i) => {
      if (Date.parse(`${time}:00Z`) < asOf.getTime()) return void bump(dropped, "past_hours");
      const [gust, rain, snow, temp] = [h.wind_gusts_10m[i], h.precipitation[i], h.snowfall[i], h.temperature_2m[i]];
      if (gust == null || rain == null || snow == null || temp == null) return void bump(dropped, "missing_values");
      bump(fixed, "kmh_to_mph");
      const hazard = hazardFor(gust, rain, snow, temp);
      if (!hazard) return void bump(dropped, "below_threshold");
      if (open && open.cause === hazard.cause && i - open.lastIdx <= 2) {
        open.lastIdx = i;
        open.severity = Math.max(open.severity, hazard.severity);
        open.peak = Math.max(open.peak, hazard.value);
        bump(dropped, "merged_into_window");
      } else {
        open = { cause: hazard.cause, firstIdx: i, lastIdx: i, severity: hazard.severity, peak: hazard.value };
        windows.push(open);
      }
    });

    for (const w of windows) {
      const start = `${h.time[w.firstIdx]}:00Z`;
      const leadDays = (Date.parse(start) - asOf.getTime()) / 86_400_000;
      signals.push({
        id: `${ID}:${point.id}:${h.time[w.firstIdx]!.slice(0, 13)}:${w.cause}`,
        kind: "weather",
        title: TITLE[w.cause](w.peak),
        detail: `${point.name}: forecast ${Math.max(0, Math.round(leadDays))} day${Math.round(leadDays) === 1 ? "" : "s"} ahead`,
        source: ID,
        start: start as Signal["start"],
        end: addMinutes(`${h.time[w.lastIdx]}:00Z`, 120),
        place: { name: point.name, lat: point.lat, lon: point.lon },
        scope: { stations: point.stations, operators: [], nationwide: false },
        severity: w.severity,
        confidence: leadConfidence(leadDays),
        metrics: { [METRIC[w.cause]]: round(w.peak, 1) },
        url: "https://open-meteo.com/",
      });
    }
  });
  return { signals, quality: report(rowsIn, fixed, dropped) };
}

export const weather: Adapter = async (ctx) => {
  const { points } = Points.parse(JSON.parse(readRaw("weather-points.json")));
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p.lat).join(",")}&longitude=${points.map((p) => p.lon).join(",")}` +
    "&hourly=temperature_2m,precipitation,wind_gusts_10m,snowfall&timezone=UTC&forecast_days=16";
  const got = await fetchText(ID, url, "open-meteo-forecast.json", ctx);
  if (!got) return { signals: [], statuses: [downStatus(ID, NAME, "No live data, cache or seed available")] };
  const forecast = Forecast.parse(JSON.parse(got.text));
  // A forecast fetched now is as of now; the checked-in seed is as of the start of its first day.
  const asOf = got.fetchedAt ? new Date(got.fetchedAt) : new Date(`${forecast[0]!.hourly.time[0]}:00Z`);
  const { signals, quality } = buildWeather(points, forecast, asOf);
  return { signals, statuses: [{ id: ID, name: NAME, lane: "signals", mode: got.mode, ...(got.fetchedAt ? { fetchedAt: got.fetchedAt } : {}), quality }] };
};
