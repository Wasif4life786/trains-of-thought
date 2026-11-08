import { MAX_NETWORK_DAYS, addDays, parseOperationsQuery, toSearchParams, type NetworkQuery, type OperationsQuery } from "@tot/shared";

export type View = "network" | "route" | "inputs";
const VIEWS: readonly View[] = ["route", "network", "inputs"];

/** Everything the dashboard holds, mirrored into the address bar so a link reproduces the view. */
export interface FormState {
  view: View;
  /** The route board's query; the network view uses its dates. */
  query: OperationsQuery;
}

export const DEFAULT_STATE: FormState = {
  view: "route",
  query: { origin: "EUS", destination: "MAN", dateFrom: "2026-11-20", dateTo: "2026-11-22", earliest: "05:00", latest: "23:30" },
};

/** A query string → state; anything missing or invalid falls back to the defaults, never an error. */
export function readState(search: string, fallback: FormState = DEFAULT_STATE): FormState {
  const params = new URLSearchParams(search);
  let query = fallback.query;
  if (params.has("origin") && params.has("destination") && params.has("dateFrom")) {
    try {
      query = parseOperationsQuery(params);
    } catch {
      // keep the defaults for a malformed link
    }
  }
  const view = VIEWS.find((v) => v === params.get("view")) ?? "route";
  return { view, query };
}

/** State → query string, using the same names the API takes so the two stay readable side by side. */
export function writeState({ view, query }: FormState): string {
  return toSearchParams({
    view: view === "route" ? undefined : view,
    origin: query.origin,
    destination: query.destination,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    earliest: query.earliest,
    latest: query.latest,
  }).toString();
}

/** The network view sweeps every route, so it covers at most MAX_NETWORK_DAYS from the first day. */
export function networkQuery(q: OperationsQuery): NetworkQuery {
  const last = addDays(q.dateFrom, MAX_NETWORK_DAYS - 1);
  return { dateFrom: q.dateFrom, dateTo: q.dateTo < last ? q.dateTo : last };
}
