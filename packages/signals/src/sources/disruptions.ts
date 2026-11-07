import { z } from "zod";
import { OPERATORS, addMinutes, londonToUtc, type Signal } from "@tot/shared";
import { bump, readRaw, report, slug, type Adapter } from "../util";

const ID = "seed:disruptions";
const NAME = "Strikes and engineering works (curated sample)";

const Item = z.object({
  type: z.enum(["engineering", "strike"]),
  title: z.string(),
  operators: z.array(z.string()),
  stations: z.array(z.string()),
  from: z.string(),
  to: z.string(),
  impact: z.string(),
  detail: z.string().optional(),
  status: z.string(),
});

/** Operator names as people write them → ATOC codes. Built from the shared list plus the spellings seen in notices. */
const OPERATOR_CODES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(OPERATORS).map(([code, name]) => [name.toLowerCase(), code])),
  tpe: "TP",
  "london north eastern railway": "GR",
  "london northwestern": "LN",
  "london northwestern railway": "LN",
  "virgin trains": "VT",
  gwr: "GW",
};

export function operatorCode(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (OPERATOR_CODES[key]) return OPERATOR_CODES[key]!;
  return /^[A-Z]{2}$/.test(name.trim()) ? name.trim() : null;
}

const ENGINEERING_SEVERITY: Record<string, number> = { "late night only": 0.2, "reduced service": 0.4, diversions: 0.6, "partial closure": 0.8, "line closed": 1 };
const STRIKE_SEVERITY: Record<string, number> = { "overtime ban": 0.4, partial: 0.6, "full walkout": 0.8, national: 1 };

/** "2026-11-22 14:00" → UTC instant; a bare date means the start (or end) of that London day. */
function parseWhen(raw: string, endOfDay: boolean): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(raw.trim());
  return m ? londonToUtc(m[1]!, m[2] ?? (endOfDay ? "23:59" : "00:00")) : null;
}

/** Curated notices → signals. Engineering works keep their published times; a strike covers each strike day plus the morning after. */
export function buildDisruptions(json: string): { signals: Signal[]; quality: ReturnType<typeof report> } {
  const items = z.object({ items: z.array(Item) }).parse(JSON.parse(json)).items;
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const signals: Signal[] = [];

  for (const item of items) {
    if (item.status === "cancelled") {
      bump(dropped, "cancelled");
      continue;
    }
    const severity = (item.type === "strike" ? STRIKE_SEVERITY : ENGINEERING_SEVERITY)[item.impact];
    if (severity === undefined) {
      bump(dropped, "unknown_impact");
      continue;
    }
    const start = parseWhen(item.from, false);
    let end = parseWhen(item.to, true);
    if (!start || !end) {
      bump(dropped, "bad_date");
      continue;
    }
    const operators = item.operators.map(operatorCode);
    if (operators.some((o) => o === null)) {
      bump(dropped, "unknown_operator");
      continue;
    }
    bump(fixed, "operator_name_to_atoc", item.operators.length);
    if (item.type === "strike") {
      // The railway feels a strike until the morning after: trains and crews are out of place until about 10:00.
      end = addMinutes(londonToUtc(item.to.slice(0, 10), "23:59"), 600);
      bump(fixed, "strike_window_extended");
    }
    const nationwide = item.stations.length === 0;
    signals.push({
      id: `${ID}:${item.type}:${start.slice(0, 10)}:${slug(item.title)}`,
      kind: item.type === "strike" ? "strike" : "engineering_works",
      title: `${item.title} (sample)`,
      ...(item.detail ? { detail: item.detail } : {}),
      source: ID,
      start,
      end,
      scope: { stations: item.stations, operators: operators as string[], nationwide },
      severity,
      confidence: item.status === "confirmed" || item.status === "announced" ? 0.9 : 0.5,
    });
  }
  return { signals, quality: report(items.length, fixed, dropped) };
}

export const disruptions: Adapter = async () => {
  const { signals, quality } = buildDisruptions(readRaw("disruptions.json"));
  return { signals, statuses: [{ id: ID, name: NAME, lane: "signals", mode: "seed", quality, note: "Invented sample notices, labelled (sample)" }] };
};
