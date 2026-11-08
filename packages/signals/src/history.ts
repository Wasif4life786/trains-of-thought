// npm run history -w @tot/signals -- 2026-10-01 2026-10-31
// Observed weather from Open-Meteo's archive run through the same hazard rules as the forecast, so delays can be
// back-tested against what actually happened (contract.md A1.12). Needs the network: the archive isn't checked in.
import { isOffline, utcToLondon, type Signal } from "@tot/shared";
import { Forecast, Points, buildWeather } from "./sources/weather";
import { readRaw } from "./util";

/** Weather windows that really happened between two London dates (inclusive), per the archive. Confidence is high (0.95). */
export async function historicalWeather(from: string, to: string): Promise<{ signals: Signal[]; rowsIn: number }> {
  if (isOffline()) throw new Error("Historical weather needs the network; unset TOT_OFFLINE");
  const { points } = Points.parse(JSON.parse(readRaw("weather-points.json")));
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${points.map((p) => p.lat).join(",")}&longitude=${points.map((p) => p.lon).join(",")}` +
    `&start_date=${from}&end_date=${to}&hourly=temperature_2m,precipitation,wind_gusts_10m,snowfall&timezone=UTC`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Open-Meteo archive answered HTTP ${res.status}`);
  const forecast = Forecast.parse(await res.json());
  const { signals, quality } = buildWeather(points, forecast, new Date(`${from}T00:00:00Z`), { confidence: 0.95 });
  return { signals, rowsIn: quality.rowsIn };
}

if (process.argv[1]?.endsWith("history.ts")) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error("usage: npm run history -w @tot/signals -- <from YYYY-MM-DD> <to YYYY-MM-DD>");
    process.exit(1);
  }
  const { signals, rowsIn } = await historicalWeather(from, to);
  console.log(`${rowsIn} hourly rows read → ${signals.length} weather windows\n`);
  console.table(signals.map((s) => ({ day: utcToLondon(s.start).date, from: utcToLondon(s.start).time, to: utcToLondon(s.end).time, what: s.title, where: s.scope.stations.slice(0, 3).join(","), severity: s.severity })));
}
