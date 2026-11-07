import { z } from "zod";
import { londonToUtc, type Signal } from "@tot/shared";
import { bump, downStatus, fetchText, report, type Adapter } from "../util";

const ID = "gov-uk-bank-holidays";
const NAME = "GOV.UK bank holidays";
const URL = "https://www.gov.uk/bank-holidays.json";

/** Main Scottish stations: where Scotland-only holidays bite. */
export const SCOTTISH_STATIONS = ["EDB", "HYM", "GLC", "GLQ", "ABD", "INV", "DEE", "STG", "PTH", "MTH"];

const Feed = z.record(z.string(), z.object({ events: z.array(z.object({ title: z.string(), date: z.string(), notes: z.string().optional() })) }));

/** England & Wales holidays are nationwide; Scotland-only ones sit on Scottish stations; Northern Ireland is out of scope. */
export function parseBankHolidays(text: string): { signals: Signal[]; quality: ReturnType<typeof report> } {
  const feed = Feed.parse(JSON.parse(text));
  const fixed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const signals: Signal[] = [];
  const englandWales = new Set((feed["england-and-wales"]?.events ?? []).map((e) => e.date));
  let rowsIn = 0;

  for (const [division, { events }] of Object.entries(feed)) {
    for (const event of events) {
      rowsIn++;
      if (division === "northern-ireland") {
        bump(dropped, "northern_ireland_out_of_scope");
        continue;
      }
      if (division === "scotland" && englandWales.has(event.date)) {
        bump(dropped, "merged_into_england_and_wales");
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
        bump(dropped, "bad_date");
        continue;
      }
      const title = event.title.replace(/[’‘]/g, "'");
      if (title !== event.title) bump(fixed, "curly_apostrophe_normalised");
      const scottish = division === "scotland";
      signals.push({
        id: `${ID}:${division}:${event.date}`,
        kind: "bank_holiday",
        title: scottish ? `${title} (Scotland)` : title,
        detail: `Holiday timetable and leisure demand${event.notes ? ` · ${event.notes}` : ""}`,
        source: ID,
        start: londonToUtc(event.date, "00:00"),
        end: londonToUtc(event.date, "23:59"),
        scope: scottish ? { stations: SCOTTISH_STATIONS, operators: [], nationwide: false } : { stations: [], operators: [], nationwide: true },
        severity: 0.3,
        confidence: 0.95,
        url: "https://www.gov.uk/bank-holidays",
      });
    }
  }
  return { signals, quality: report(rowsIn, fixed, dropped) };
}

export const bankHolidays: Adapter = async (ctx) => {
  const got = await fetchText(ID, URL, "bank-holidays.json", ctx);
  if (!got) return { signals: [], statuses: [downStatus(ID, NAME, "No live data, cache or seed available")] };
  const { signals, quality } = parseBankHolidays(got.text);
  return { signals, statuses: [{ id: ID, name: NAME, lane: "signals", mode: got.mode, ...(got.fetchedAt ? { fetchedAt: got.fetchedAt } : {}), quality }] };
};
