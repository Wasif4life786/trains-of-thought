import { parseRecommendationQuery, toSearchParams, type RecommendationQuery } from "@tot/shared";

export type Trip = "single" | "return";

export interface ReturnDates {
  from: string;
  to: string;
}

/** Everything the search form holds, mirrored into the address bar so a link reproduces the search. */
export interface FormState {
  query: RecommendationQuery;
  trip: Trip;
  returnDates: ReturnDates;
  /** Railcard id from railcards.ts, "" for none. */
  railcard: string;
}

export const DEFAULT_STATE: FormState = {
  query: { origin: "EUS", destination: "MAN", dateFrom: "2026-11-20", dateTo: "2026-11-22", earliest: "06:00", latest: "22:00", priority: 0.5 },
  trip: "single",
  returnDates: { from: "2026-11-22", to: "2026-11-22" },
  railcard: "",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A query string → form state; anything missing or invalid falls back to the defaults, never an error. */
export function readState(search: string, fallback: FormState = DEFAULT_STATE): FormState {
  const params = new URLSearchParams(search);
  let query = fallback.query;
  if (params.has("origin") && params.has("destination") && params.has("dateFrom")) {
    try {
      query = parseRecommendationQuery(params);
    } catch {
      // keep the defaults for a malformed link
    }
  }
  const returnFrom = params.get("returnFrom");
  const returnTo = params.get("returnTo");
  const valid = returnFrom !== null && returnTo !== null && DATE.test(returnFrom) && DATE.test(returnTo) && returnTo >= returnFrom;
  return {
    query,
    trip: params.get("trip") === "return" ? "return" : "single",
    returnDates: valid ? { from: returnFrom, to: returnTo } : fallback.returnDates,
    railcard: params.get("railcard") ?? "",
  };
}

/** Form state → query string, using the same names the API takes so the two stay readable side by side. */
export function writeState(state: FormState): string {
  const { query } = state;
  return toSearchParams({
    origin: query.origin,
    destination: query.destination,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    earliest: query.earliest,
    latest: query.latest,
    priority: query.priority,
    trip: state.trip === "return" ? "return" : undefined,
    returnFrom: state.trip === "return" ? state.returnDates.from : undefined,
    returnTo: state.trip === "return" ? state.returnDates.to : undefined,
    railcard: state.railcard || undefined,
  }).toString();
}
