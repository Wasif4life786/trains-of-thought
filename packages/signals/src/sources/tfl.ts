import { z } from "zod";
import { addDays, addMinutes, londonToday, toIsoUtc, type Signal } from "@tot/shared";
import { bump, downStatus, fetchText, report, slug, type Adapter } from "../util";

const ID = "tfl-status";
const NAME = "TfL line status near the London termini";

/** Which of our London termini each Underground / Elizabeth line serves. */
export const LINE_STATIONS: Record<string, string[]> = {
  northern: ["EUS", "KGX", "STP"],
  victoria: ["EUS", "KGX", "STP"],
  piccadilly: ["KGX", "STP"],
  bakerloo: ["PAD", "EUS"],
  circle: ["KGX", "STP", "PAD"],
  metropolitan: ["KGX", "STP"],
  "hammersmith-city": ["KGX", "STP", "PAD"],
  district: ["PAD"],
  elizabeth: ["PAD"],
};

const Feed = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    lineStatuses: z.array(
      z.object({
        statusSeverity: z.number(),
        statusSeverityDescription: z.string(),
        reason: z.string().nullish(),
        validityPeriods: z.array(z.object({ fromDate: z.string(), toDate: z.string() })).nullish(),
      }),
    ),
  }),
);

/**
 * A closed or delayed tube line doesn't delay an intercity train: it crowds the terminus and stretches onward journeys.
 * So these are deliberately low-severity "other" signals, not engineering works.
 */
const severityOf = (status: number): number => (status === 9 ? 0.1 : 0.2);
const PLANNED = new Set([1, 4, 5]);

/** TfL line statuses → one signal per validity period of every status that isn't Good Service. */
export function buildTfl(text: string, now: Date): { signals: Signal[]; quality: ReturnType<typeof report> } {
  const feed = Feed.parse(JSON.parse(text));
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const signals: Signal[] = [];
  let rowsIn = 0;

  for (const line of feed) {
    const stations = LINE_STATIONS[line.id];
    for (const status of line.lineStatuses) {
      const periods = status.validityPeriods?.length ? status.validityPeriods : [null];
      for (const period of periods) {
        rowsIn++;
        if (status.statusSeverity >= 10) {
          bump(dropped, "good_service");
          continue;
        }
        if (!stations) {
          bump(dropped, "line_not_near_our_termini");
          continue;
        }
        let start: string;
        let end: string;
        if (period) {
          start = toIsoUtc(new Date(period.fromDate));
          end = toIsoUtc(new Date(period.toDate));
        } else {
          // A status with no published period is in force now: assume the next three hours.
          start = toIsoUtc(now);
          end = addMinutes(start, 180);
          bump(fixed, "open_ended_status_given_a_window");
        }
        if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
          bump(dropped, "bad_date");
          continue;
        }
        const reason = (status.reason ?? "").replace(/\s+/g, " ").trim();
        if (reason !== (status.reason ?? "")) bump(fixed, "reason_text_tidied");
        signals.push({
          id: `${ID}:${line.id}:${start}:${slug(status.statusSeverityDescription)}`,
          kind: "other",
          title: `${line.name} line: ${status.statusSeverityDescription.toLowerCase()} (TfL)`,
          ...(reason ? { detail: reason.slice(0, 220) } : {}),
          source: ID,
          start: start as Signal["start"],
          end: end as Signal["end"],
          scope: { stations, operators: [], nationwide: false },
          severity: severityOf(status.statusSeverity),
          confidence: PLANNED.has(status.statusSeverity) ? 0.9 : 0.6,
          url: "https://tfl.gov.uk/tube-dlr-overground/status/",
        });
      }
    }
  }
  return { signals, quality: report(rowsIn, fixed, dropped) };
}

export const tfl: Adapter = async (ctx) => {
  const from = londonToday(ctx.now);
  const url = `https://api.tfl.gov.uk/Line/${Object.keys(LINE_STATIONS).join(",")}/Status/${from}/to/${addDays(from, 14)}`;
  const got = await fetchText(ID, url, "tfl-status.json", ctx);
  if (!got) return { signals: [], statuses: [downStatus(ID, NAME, "No live data, cache or seed available")] };
  const { signals, quality } = buildTfl(got.text, got.fetchedAt ? new Date(got.fetchedAt) : ctx.now);
  return { signals, statuses: [{ id: ID, name: NAME, lane: "signals", mode: got.mode, ...(got.fetchedAt ? { fetchedAt: got.fetchedAt } : {}), quality, note: "Planned closures near the termini add crowding, not train delays" }] };
};
