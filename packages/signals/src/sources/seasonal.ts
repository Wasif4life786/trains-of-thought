import { addDays, londonToUtc, type Signal } from "@tot/shared";
import { report, type Adapter } from "../util";

const ID = "seasonal:leaf-fall";
const NAME = "Autumn leaf-fall adhesion (modelled seasonal rule)";

/** Stations on wooded or exposed stretches where leaf mulch costs braking grip (calling points on the modelled corridors). */
export const LEAF_FALL_STATIONS = ["CAR", "LAN", "WGN", "PRE", "DAR", "BWK", "PBO", "DON", "YRK", "WKF", "STA", "SOT", "MAC", "CRE", "RUG", "COV", "DID", "CPM", "BTH", "SWI", "BPW", "GCR", "CNM", "WOS", "BMV", "MIR", "DEW", "HUD"];

/**
 * Leaf-fall season (1 Oct – 30 Nov): wet leaves on the rails make trains brake and accelerate slowly, worst on early
 * mornings. A modelled rule, not a data feed: low severity, low confidence, every day of the season in `years`.
 */
export function buildLeafFall(years: number[]): { signals: Signal[]; quality: ReturnType<typeof report> } {
  const signals: Signal[] = [];
  for (const year of years) {
    for (let date = `${year}-10-01`; date <= `${year}-11-30`; date = addDays(date, 1)) {
      signals.push({
        id: `${ID}:${date}`,
        kind: "weather",
        title: "Autumn leaf-fall: poor rail adhesion on wooded stretches (modelled)",
        detail: "Wet leaves on the line slow braking and acceleration, mostly on early mornings",
        source: ID,
        start: londonToUtc(date, "05:00"),
        end: londonToUtc(date, "10:00"),
        scope: { stations: LEAF_FALL_STATIONS, operators: [], nationwide: false },
        severity: 0.2,
        confidence: 0.4,
      });
    }
  }
  return { signals, quality: report(signals.length, { season_days_generated: signals.length }, {}) };
}

export const seasonal: Adapter = async (ctx) => {
  const year = ctx.now.getUTCFullYear();
  const { signals, quality } = buildLeafFall([year, year + 1]);
  return { signals, statuses: [{ id: ID, name: NAME, lane: "signals", mode: "seed", quality, note: "A modelled seasonal rule, not a feed. Summer heat is covered by the weather adapter's temperature threshold" }] };
};
