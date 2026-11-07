import { TICKET_TYPES, parsePounds, type Fare, type QualityReport, type TicketType } from "@tot/shared";
import { bump, hash, parseCsv, readRaw } from "./data";
import { isPeak } from "./peak";

export interface FareTable {
  anytime: number;
  offPeak: number;
  superOffPeak: number;
  /** Advance on-sale price range (pence) across trains on the route. */
  advanceMin: number;
  advanceMax: number;
}

type FareField = keyof FareTable;

/** The spelling the dominant rows use, so we can count how many needed normalising. */
const CANONICAL: Record<FareField, string> = {
  anytime: "Anytime Single",
  offPeak: "Off-Peak Single",
  superOffPeak: "Super Off-Peak Single",
  advanceMin: "Advance from",
  advanceMax: "Advance to",
};

const FIELD_BY_LABEL: Record<string, FareField> = {
  anytime: "anytime",
  anytimesingle: "anytime",
  offpeak: "offPeak",
  offpeaksingle: "offPeak",
  superoffpeak: "superOffPeak",
  superoffpeaksingle: "superOffPeak",
  advance: "advanceMin",
  advancefrom: "advanceMin",
  advancemin: "advanceMin",
  advanceto: "advanceMax",
  advancemax: "advanceMax",
};

export interface FareBook {
  tables: Map<string, FareTable>;
  quality: QualityReport;
}

let cached: FareBook | undefined;

export function loadFares(): FareBook {
  cached ??= parseFares(readRaw("fares.csv"));
  return cached;
}

/** "eus–liv" → "EUS-LIV"; null when it isn't a route code at all. */
function routeKey(raw: string): string | null {
  const m = /^([A-Za-z]{3})\s*[-–—\s]\s*([A-Za-z]{3})$/.exec(raw.trim());
  return m ? `${m[1]!.toUpperCase()}-${m[2]!.toUpperCase()}` : null;
}

export function parseFares(text: string): FareBook {
  const rows = parseCsv(text).slice(1);
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const partial = new Map<string, Partial<FareTable>>();
  let rowsOut = 0;

  for (const row of rows) {
    const [rawRoute = "", rawFare = "", rawAmount = ""] = row.map((c) => c.trim());
    const key = routeKey(rawRoute);
    if (!key) {
      bump(dropped, rawRoute === "" ? "blank_row" : "unknown_route");
      continue;
    }
    const field = FIELD_BY_LABEL[rawFare.toLowerCase().replace(/[^a-z]/g, "")];
    if (!field) {
      bump(dropped, "unsupported_ticket_type");
      continue;
    }
    if (rawAmount === "") {
      bump(dropped, "missing_amount");
      continue;
    }
    const pence = parsePounds(rawAmount);
    if (pence === null) {
      bump(dropped, "unparseable_amount");
      continue;
    }
    const table = partial.get(key) ?? {};
    if (table[field] !== undefined) {
      bump(dropped, "duplicate");
      continue;
    }
    table[field] = pence;
    partial.set(key, table);
    rowsOut++;
    bump(fixed, "pounds_to_pence");
    if (key !== rawRoute) bump(fixed, "route_code_normalised");
    if (rawFare !== CANONICAL[field]) bump(fixed, "fare_label_normalised");
  }

  const tables = new Map<string, FareTable>();
  for (const [key, t] of partial) {
    if (t.anytime !== undefined && t.offPeak !== undefined && t.superOffPeak !== undefined && t.advanceMin !== undefined && t.advanceMax !== undefined) {
      tables.set(key, { anytime: t.anytime, offPeak: t.offPeak, superOffPeak: t.superOffPeak, advanceMin: t.advanceMin, advanceMax: t.advanceMax });
    }
  }
  return { tables, quality: { rowsIn: rows.length, rowsOut, fixed, dropped } };
}

/** Advance fares go on sale about 12 weeks out and step up as travel nears; null = not sold any more. */
export function advanceMultiplier(daysBefore: number): number | null {
  if (daysBefore >= 56) return 1;
  if (daysBefore >= 28) return 1.25;
  if (daysBefore >= 14) return 1.6;
  if (daysBefore >= 7) return 2.2;
  if (daysBefore >= 2) return 3;
  return null;
}

export const ADVANCE_ON_SALE_DAYS = 84;

/**
 * How many days before travel this train's Advance fares sold out (0 = never, they stay on sale until 2 days out).
 * Getaway Fridays and busy Saturday mornings sell out weeks ahead; a few other trains sell out early.
 */
function soldOutDaysBefore(id: string, weekday: number, time: string): number {
  const h = hash(id);
  const busy = (weekday === 5 && time >= "15:00" && time < "19:00") || (weekday === 6 && time >= "10:00" && time < "13:00");
  if (busy) return 14 + (h % 14);
  if (h % 7 === 0) return 7 + ((h >>> 3) % 21);
  return 0;
}

const round10 = (pence: number) => Math.round(pence / 10) * 10;

/** Every fare you could buy for one train `daysBefore` days ahead, cheapest first. */
export function faresFor(table: FareTable, id: string, weekday: number, time: string, daysBefore: number): Fare[] {
  const fares: Fare[] = [];
  const multiplier = advanceMultiplier(daysBefore);
  if (multiplier !== null && daysBefore <= ADVANCE_ON_SALE_DAYS && daysBefore > soldOutDaysBefore(id, weekday, time)) {
    const u = (hash(`${id}:advance`) % 1000) / 999;
    const onSale = round10(table.advanceMin + (table.advanceMax - table.advanceMin) * u);
    fares.push({ ticketType: "advance", pricePence: round10(onSale * multiplier), flexible: false });
  }
  if (!isPeak(weekday, time)) {
    if (weekday >= 6 || (time >= "10:00" && time < "15:30") || time >= "19:00") {
      fares.push({ ticketType: "super_off_peak", pricePence: table.superOffPeak, flexible: true });
    }
    fares.push({ ticketType: "off_peak", pricePence: table.offPeak, flexible: true });
  }
  fares.push({ ticketType: "anytime", pricePence: table.anytime, flexible: true });
  const order = (t: TicketType) => TICKET_TYPES.indexOf(t);
  return fares.sort((a, b) => a.pricePence - b.pricePence || order(a.ticketType) - order(b.ticketType));
}
