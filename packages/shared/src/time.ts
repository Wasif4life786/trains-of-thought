/**
 * Time rules (contract.md §4.2): instants are ISO UTC strings ("…Z", second precision);
 * anything a user sees or types is Europe/London. Use these helpers; never do offset maths by hand.
 */
export const LONDON_TZ = "Europe/London";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const offsetFormat = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON_TZ, timeZoneName: "shortOffset" });
const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

/** Date → "2026-11-21T15:00:00Z" (drops milliseconds: the contract wants second precision). */
export function toIsoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Minutes London is ahead of UTC at an instant: 0 (GMT) or 60 (BST). */
export function londonOffsetMinutes(at: Date): number {
  const label = offsetFormat.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

/** London wall clock → UTC instant: londonToUtc("2026-07-01", "09:00") === "2026-07-01T08:00:00Z". */
export function londonToUtc(date: string, time = "00:00"): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  const guess = wall - londonOffsetMinutes(new Date(wall)) * 60_000;
  return toIsoUtc(new Date(wall - londonOffsetMinutes(new Date(guess)) * 60_000));
}

export interface LondonParts {
  /** "2026-11-21" */
  date: string;
  /** "15:00" */
  time: string;
  hour: number;
  minute: number;
  /** 1 = Monday … 7 = Sunday */
  weekday: number;
}

/** UTC instant → London calendar parts. */
export function utcToLondon(iso: string): LondonParts {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday ?? "") + 1,
  };
}

/** Today's date in London. */
export function londonToday(now: Date = new Date()): string {
  return utcToLondon(toIsoUtc(now)).date;
}

/** Inclusive list of dates: datesBetween("2026-11-20", "2026-11-22") → 3 dates. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function addMinutes(iso: string, minutes: number): string {
  return toIsoUtc(new Date(Date.parse(iso) + minutes * 60_000));
}

/** Do the closed intervals [aStart, aEnd] and [bStart, bEnd] overlap? (ISO UTC strings) */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) <= Date.parse(bEnd) && Date.parse(bStart) <= Date.parse(aEnd);
}
