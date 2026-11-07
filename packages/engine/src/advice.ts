import { addDays, daysBetween, formatPence, utcToLondon, type BookingAdvice, type FareCurve, type HeatmapCell, type ScoredOption } from "@tot/shared";

/** One cell per (London date, hour) from the window's first hour to its last, holding the cell's best-scoring train. */
export function buildHeatmap(options: ScoredOption[], dates: string[], earliest: string, latest: string): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  const firstHour = Number(earliest.slice(0, 2));
  const lastHour = Number(latest.slice(0, 2));
  const byCell = new Map<string, ScoredOption[]>();
  for (const o of options) {
    const local = utcToLondon(o.journey.departAt);
    const key = `${local.date}|${local.hour}`;
    byCell.set(key, [...(byCell.get(key) ?? []), o]);
  }
  for (const date of dates) {
    for (let hour = firstHour; hour <= lastHour; hour++) {
      const inCell = byCell.get(`${date}|${hour}`) ?? [];
      const top = inCell.reduce<ScoredOption | null>((acc, o) => (!acc || o.score > acc.score ? o : acc), null);
      cells.push({
        date,
        hour,
        score: top?.score ?? null,
        minPricePence: inCell.length > 0 ? Math.min(...inCell.map((o) => o.pricePence)) : null,
        reliability: top?.reliability ?? null,
        optionIds: inCell.map((o) => o.journey.id),
      });
    }
  }
  return cells;
}

/** Book now or wait, from how this train's cheapest fare moves between today and travel day. */
export function adviseBooking(best: ScoredOption, curve: FareCurve, bookingDate: string): BookingAdvice {
  const travelDate = utcToLondon(best.journey.departAt).date;
  const current = best.pricePence;
  const base = { journeyId: best.journey.id, currentPricePence: current, curve };

  if (daysBetween(bookingDate, travelDate) > 84) {
    return { ...base, action: "not_on_sale_yet", headline: `Advance fares for this train go on sale on ${curve.advanceOnSale ?? addDays(travelDate, -84)}` };
  }
  if (best.ticketType !== "advance") {
    return { ...base, action: "wait", headline: "No rush: Advance tickets have sold out, and walk-up fares don't change before travel", expectedPricePence: current };
  }
  const inAWeek = curve.points.find((p) => p.date >= addDays(bookingDate, 7)) ?? curve.points.at(-1)!;
  if (inAWeek.pricePence >= current * 1.1) {
    const nextRise = curve.points.find((p) => p.date > bookingDate && p.pricePence > current);
    return {
      ...base,
      action: "book_now",
      headline: `Book now: this fare usually rises to ${formatPence(inAWeek.pricePence)} within a week`,
      expectedPricePence: inAWeek.pricePence,
      ...(nextRise ? { bookBy: addDays(nextRise.date, -1) < bookingDate ? bookingDate : addDays(nextRise.date, -1) } : {}),
    };
  }
  return { ...base, action: "wait", headline: "No rush: this fare looks stable for the next week", expectedPricePence: inAWeek.pricePence };
}
