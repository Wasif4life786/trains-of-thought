/** HTTP contract helpers (contract.md §5.3), used by @tot/api and @tot/web so a URL means the same thing on both sides. */
import { z } from "zod";
import {
  ApiErrorSchema,
  HealthSchema,
  InputsResponseSchema,
  NetworkQuerySchema,
  NetworkResponseSchema,
  OperationsQuerySchema,
  OperationsResponseSchema,
  RecommendationQuerySchema,
  RecommendationResponseSchema,
  SignalQuerySchema,
  SignalSchema,
  SourceStatusSchema,
  StationSchema,
  type NetworkQuery,
  type OperationsQuery,
  type RecommendationQuery,
  type SignalQuery,
} from "./schemas";
import { daysBetween } from "./time";

export const API_ROUTES = {
  health: "/api/health",
  stations: "/api/stations",
  recommendations: "/api/recommendations",
  signals: "/api/signals",
  sources: "/api/sources",
  operations: "/api/operations",
  network: "/api/network",
  inputs: "/api/inputs",
} as const;

export const RECOMMENDATION_DEFAULTS = { earliest: "06:00", latest: "22:00", priority: 0.5 } as const;
export const MAX_RANGE_DAYS = 14;
/** The operator board covers the whole operating day by default. */
export const OPERATIONS_DEFAULTS = { earliest: "05:00", latest: "23:30" } as const;
/** The network view sweeps every route, so its window is shorter. */
export const MAX_NETWORK_DAYS = 7;

type Params = URLSearchParams | Record<string, string | undefined>;
type QueryValues = Record<string, string | number | readonly string[] | undefined>;

const reader = (params: Params) => (key: string) => {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return value == null || value.trim() === "" ? undefined : value.trim();
};

const RecommendationParams = RecommendationQuerySchema.refine((q) => q.dateTo >= q.dateFrom, {
  message: "dateTo must be on or after dateFrom",
  path: ["dateTo"],
})
  .refine((q) => daysBetween(q.dateFrom, q.dateTo) < MAX_RANGE_DAYS, { message: `at most ${MAX_RANGE_DAYS} days per search`, path: ["dateTo"] })
  .refine((q) => q.earliest <= q.latest, { message: "earliest must not be after latest", path: ["latest"] });

/** Query string → RecommendationQuery with defaults filled in. Throws a ZodError (HTTP 400) on bad input. */
export function parseRecommendationQuery(params: Params): RecommendationQuery {
  const get = reader(params);
  const dateFrom = get("dateFrom");
  const priority = get("priority");
  return RecommendationParams.parse({
    origin: get("origin")?.toUpperCase(),
    destination: get("destination")?.toUpperCase(),
    dateFrom,
    dateTo: get("dateTo") ?? dateFrom,
    earliest: get("earliest") ?? RECOMMENDATION_DEFAULTS.earliest,
    latest: get("latest") ?? RECOMMENDATION_DEFAULTS.latest,
    priority: priority === undefined ? RECOMMENDATION_DEFAULTS.priority : Number(priority),
    bookingDate: get("bookingDate"),
  });
}

const OperationsParams = OperationsQuerySchema.refine((q) => q.dateTo >= q.dateFrom, { message: "dateTo must be on or after dateFrom", path: ["dateTo"] })
  .refine((q) => daysBetween(q.dateFrom, q.dateTo) < MAX_RANGE_DAYS, { message: `at most ${MAX_RANGE_DAYS} days per search`, path: ["dateTo"] })
  .refine((q) => q.earliest <= q.latest, { message: "earliest must not be after latest", path: ["latest"] });

/** Query string → OperationsQuery with defaults filled in (the whole operating day). Throws a ZodError (HTTP 400). */
export function parseOperationsQuery(params: Params): OperationsQuery {
  const get = reader(params);
  const dateFrom = get("dateFrom");
  return OperationsParams.parse({
    origin: get("origin")?.toUpperCase(),
    destination: get("destination")?.toUpperCase(),
    dateFrom,
    dateTo: get("dateTo") ?? dateFrom,
    earliest: get("earliest") ?? OPERATIONS_DEFAULTS.earliest,
    latest: get("latest") ?? OPERATIONS_DEFAULTS.latest,
    bookingDate: get("bookingDate"),
  });
}

const NetworkParams = NetworkQuerySchema.refine((q) => q.dateTo >= q.dateFrom, { message: "dateTo must be on or after dateFrom", path: ["dateTo"] }).refine(
  (q) => daysBetween(q.dateFrom, q.dateTo) < MAX_NETWORK_DAYS,
  { message: `at most ${MAX_NETWORK_DAYS} days for the network view`, path: ["dateTo"] },
);

/** Query string → NetworkQuery. Throws a ZodError (HTTP 400). */
export function parseNetworkQuery(params: Params): NetworkQuery {
  const get = reader(params);
  const dateFrom = get("dateFrom");
  return NetworkParams.parse({ dateFrom, dateTo: get("dateTo") ?? dateFrom, bookingDate: get("bookingDate") });
}

/** Query string → SignalQuery: from/to are ISO UTC, stations and kinds are comma lists. */
export function parseSignalQuery(params: Params): SignalQuery {
  const get = reader(params);
  const list = (value?: string) => value?.split(",").map((s) => s.trim()).filter(Boolean);
  return SignalQuerySchema.parse({
    from: get("from"),
    to: get("to"),
    stations: (list(get("stations")) ?? []).map((s) => s.toUpperCase()),
    kinds: list(get("kinds")),
  });
}

/** Plain object → URLSearchParams, skipping undefined; arrays become comma lists. */
export function toSearchParams(values: QueryValues): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    out.set(key, typeof value === "object" ? value.join(",") : String(value));
  }
  return out;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiClientOptions {
  /** "" for same-origin (the Vite proxy), or e.g. "http://localhost:8787". */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Typed client for the HTTP API. Every response is validated against the contract, so drift fails loudly. */
export function createApiClient({ baseUrl = "", fetch: doFetch = (input, init) => fetch(input, init) }: ApiClientOptions = {}) {
  async function get<S extends z.ZodType>(path: string, params: QueryValues, schema: S): Promise<z.output<S>> {
    const qs = toSearchParams(params).toString();
    const res = await doFetch(`${baseUrl}${path}${qs ? `?${qs}` : ""}`);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = ApiErrorSchema.safeParse(body);
      if (parsed.success) throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
      throw new ApiError(res.status, "internal", `HTTP ${res.status}`);
    }
    return schema.parse(body);
  }

  return {
    health: () => get(API_ROUTES.health, {}, HealthSchema),
    stations: (q: string, limit = 8) => get(API_ROUTES.stations, { q, limit }, z.array(StationSchema)),
    recommendations: (q: RecommendationQuery) => get(API_ROUTES.recommendations, { ...q }, RecommendationResponseSchema),
    signals: (q: SignalQuery) => get(API_ROUTES.signals, { from: q.from, to: q.to, stations: q.stations, kinds: q.kinds }, z.array(SignalSchema)),
    sources: () => get(API_ROUTES.sources, {}, z.array(SourceStatusSchema)),
    operations: (q: OperationsQuery) => get(API_ROUTES.operations, { ...q }, OperationsResponseSchema),
    network: (q: NetworkQuery) => get(API_ROUTES.network, { ...q }, NetworkResponseSchema),
    inputs: (q: NetworkQuery) => get(API_ROUTES.inputs, { ...q }, InputsResponseSchema),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
