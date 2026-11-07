/**
 * Writes data/raw/rail/performance.csv: a SYNTHETIC punctuality history (source id seed:rail-performance) for the modelled
 * routes, April–October 2026, deliberately messy the way real exports are: mixed date and time formats, delays written as
 * text, route names instead of codes, blank and junk rows, duplicates. Deterministic: same file every run.
 * Run: npm run generate:performance -w @tot/rail   (the output is raw data: don't hand-edit it, regenerate it).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addDays, datesBetween, utcToLondon, londonToUtc } from "@tot/shared";
import { hash } from "./data";
import { isPeak } from "./peak";
import { loadRoutes, servicesOn } from "./routes";
import { loadStations } from "./stations";

const OUT = fileURLToPath(new URL("../../../data/raw/rail/performance.csv", import.meta.url));
const OBS_PER_CELL = 24;
const FIRST_DAY = "2026-04-01";
const LAST_DAY = "2026-10-31";

/** A stable "random" number in [0, 1) for a string. */
const u = (key: string) => (hash(key) % 100003) / 100003;
const pick = <T>(key: string, items: readonly T[]): T => items[hash(key) % items.length]!;

const classOf = (weekday: number) => (weekday <= 4 ? "mon-thu" : weekday === 5 ? "fri" : weekday === 6 ? "sat" : "sun");
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The hidden truth the synthetic history is drawn from. The baseline model has to recover it from noisy rows. */
function truth(base: number, routeDir: string, weekday: number, time: string) {
  const hour = Number(time.slice(0, 2));
  let onTime = base + (u(`${routeDir}|${classOf(weekday)}|${hour}`) - 0.5) * 0.04;
  if (isPeak(weekday, time)) onTime -= 0.04;
  if (weekday === 5 && hour >= 15 && hour < 20) onTime -= 0.05;
  if (weekday === 7) onTime -= 0.03;
  if (hour >= 20) onTime -= 0.02;
  const cancel = 0.015 + (isPeak(weekday, time) ? 0.01 : 0) + (weekday === 7 ? 0.01 : 0);
  return { onTime, cancel };
}

function writeRow(key: string, routeCode: string, names: string, date: string, time: string, delayMin: number, cancelled: boolean): string {
  const [y, m, d] = date.split("-") as [string, string, string];
  const routeText = pick(`${key}:route`, [routeCode, routeCode, routeCode, routeCode, routeCode, routeCode, routeCode, routeCode.toLowerCase(), names, routeCode.replace("-", " ")]);
  const dateText = pick(`${key}:date`, [date, date, date, date, date, date, date, `${d}/${m}/${y}`, `${d}/${m}/${y}`, `${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}`]);
  const [hh, mm] = time.split(":") as [string, string];
  const timeText = pick(`${key}:time`, [time, time, time, time, time, time, time, time, `${Number(hh)}:${mm}`, `${hh}${mm}`]);

  const v = hash(`${key}:delay`) % 100;
  let delay: string;
  let status: string;
  if (cancelled) {
    delay = pick(`${key}:cancel`, ["cancelled", "CANC", "", "-"]);
    status = v < 90 ? pick(`${key}:cs`, ["CANCELLED", "CANCELLED", "Cancelled"]) : "";
  } else {
    const verdict = delayMin > 15 ? "LATE" : "ON TIME";
    status = v % 5 === 0 ? "" : verdict;
    if (v < 55) delay = String(delayMin);
    else if (v < 70) delay = `${delayMin} mins`;
    else if (v < 80) delay = `${delayMin}m`;
    else if (v < 85) delay = `${delayMin} min`;
    else if (v < 90) delay = "";
    else if (v < 93) delay = "-";
    else if (v < 96) {
      delay = "-";
      status = "";
    } else delay = delayMin === 0 ? "-1" : String(delayMin);
  }
  return [routeText, dateText, timeText, delay, status].join(",");
}

const stations = loadStations();
const names = (crs: string) => stations.byCrs.get(crs)?.name ?? crs;

const days: string[] = [];
for (const date of datesBetween(FIRST_DAY, LAST_DAY)) days.push(date);
const weekdayOf = (date: string) => utcToLondon(londonToUtc(date, "12:00")).weekday;

const lines: string[] = ["route,date,planned,delay,status"];
for (const route of loadRoutes()) {
  for (const reverse of [false, true]) {
    const origin = reverse ? route.to : route.from;
    const destination = reverse ? route.from : route.to;
    const routeCode = `${origin}-${destination}`;
    for (const cls of ["mon-thu", "fri", "sat", "sun"]) {
      const classDays = days.filter((d) => classOf(weekdayOf(d)) === cls);
      for (let hour = 6; hour <= 22; hour++) {
        const used = new Set<string>();
        for (let i = 0; i < OBS_PER_CELL; i++) {
          const key = `${routeCode}|${cls}|${hour}|${i}`;
          // A date and train not already sampled for this cell, so duplicates in the file are only the deliberate ones.
          let date = "";
          let service: ReturnType<typeof servicesOn>[number] | undefined;
          for (let attempt = 0; attempt < 30 && !service; attempt++) {
            date = classDays[hash(`${key}:day:${attempt}`) % classDays.length]!;
            const services = servicesOn(route, reverse, date).filter((s) => Number(s.time.slice(0, 2)) === hour);
            const candidate = services.length > 0 ? services[hash(`${key}:train:${attempt}`) % services.length] : undefined;
            if (candidate && !used.has(`${date}|${candidate.time}`)) {
              used.add(`${date}|${candidate.time}`);
              service = candidate;
            } else if (services.length === 0) break;
          }
          if (!service) break;
          const t = truth(route.onTimeBase, routeCode, service.weekday, service.time);
          const cancelled = u(`${key}:cancel`) < t.cancel;
          const onTime = u(`${key}:late`) < t.onTime / (1 - t.cancel);
          const r = u(`${key}:delay`);
          const delayMin = onTime ? (r < 0.55 ? 0 : r < 0.9 ? 1 + Math.floor(((r - 0.55) / 0.35) * 5) : 6 + Math.floor(((r - 0.9) / 0.1) * 10)) : Math.min(120, 16 + Math.floor(-Math.log(1 - r) * 14));
          const row = writeRow(key, routeCode, `${names(origin)} to ${names(destination)}`, date, service.time, delayMin, cancelled);
          lines.push(row);
          if (hash(`${key}:dup`) % 50 === 0) lines.push(row);
          if (lines.length % 400 === 0) lines.push("");
          if (lines.length % 1500 === 0) lines.push("route,date,planned,delay,status");
        }
      }
    }
  }
}
lines.push("EUS-ZZZ,2026-05-01,09:00,3,ON TIME", "Total,,,,");

writeFileSync(OUT, `${lines.join("\n")}\n`);
console.log(`performance.csv: ${lines.length - 1} data lines → ${OUT.replace(process.cwd() + "/", "")} (${addDays(FIRST_DAY, 0)} … ${LAST_DAY})`);
