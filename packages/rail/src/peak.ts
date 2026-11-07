import { clamp01, round } from "./data";

/**
 * Inside a peak-fare restriction window: weekday departures 06:00–09:29 and 16:00–18:59 London time
 * (no Off-Peak or Super Off-Peak tickets on these trains). `time` is London "HH:mm".
 */
export const isPeak = (weekday: number, time: string): boolean => weekday <= 5 && ((time >= "06:00" && time < "09:30") || (time >= "16:00" && time < "19:00"));

/** 0 = empty … 1 = crush-loaded: commuter peaks, the Friday getaway and weekend leisure waves; `bias` is per route. */
export function crowding(weekday: number, time: string, bias: number): number {
  const hour = Number(time.slice(0, 2));
  let c = 0.4;
  if (weekday === 5 && hour >= 15 && hour < 20) c = 0.85;
  else if (isPeak(weekday, time)) c = 0.75;
  else if (weekday === 6 && hour >= 9 && hour < 13) c = 0.65;
  else if (weekday === 7 && hour >= 15 && hour < 20) c = 0.7;
  return round(clamp01(c + bias));
}
