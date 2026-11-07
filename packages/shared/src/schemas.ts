/**
 * THE CONTRACT, machine-readable half (contract.md is the human-readable half; they change together).
 * Change protocol: contract.md §8. Additive only, in a commit of its own, bump CONTRACT_VERSION + changelog.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "1.2.0";

// ── Primitives ──────────────────────────────────────────────────────────────

/** Instant in UTC with second precision: "2026-11-21T15:00:00Z". Build with toIsoUtc()/londonToUtc(). */
export const IsoUtc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "expected a UTC timestamp like 2026-11-21T15:00:00Z (use toIsoUtc)")
  .refine((s) => !Number.isNaN(Date.parse(s)), "not a real date");
/** Calendar day in Europe/London: "2026-11-21". */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a London date like 2026-11-21");
/** Wall-clock time in Europe/London: "07:30". */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected a London time like 07:30");
/** National Rail 3-letter station code: "EUS". */
export const Crs = z.string().regex(/^[A-Z]{3}$/, "expected a 3-letter CRS code like EUS");
/** Money is integer pence: 1999 = £19.99. Never floats. */
export const Pence = z.number().int().nonnegative();
/** Probability or share, 0..1. */
export const Prob = z.number().min(0).max(1);
/** Score for humans, 0..100, higher is better. */
export const Score = z.number().min(0).max(100);

// ── Stations (A2) ───────────────────────────────────────────────────────────

export const StationSchema = z.object({
  crs: Crs,
  /** Clean display name: "Manchester Piccadilly". */
  name: z.string().min(1),
  lat: z.number().min(49).max(61),
  lon: z.number().min(-9).max(2.5),
  /** Extra search terms: ["Manchester", "Piccadilly"]. */
  aliases: z.array(z.string()),
  /** "england" | "scotland" | "wales". */
  country: z.string().optional(),
});

// ── Signals: messy world data, cleaned (A1) ─────────────────────────────────

export const SIGNAL_KINDS = ["weather", "football", "concert", "event", "strike", "engineering_works", "bank_holiday", "other"] as const;
export const SignalKind = z.enum(SIGNAL_KINDS);

export const SignalSchema = z.object({
  /** Stable and deterministic, "<source>:<record key>": "openfootball:2026-11-21:manchester-city-v-fulham". */
  id: z.string().min(3),
  kind: SignalKind,
  /** Short human title: "Man City v Fulham". */
  title: z.string().min(1),
  /** One line for tooltips: "Etihad Stadium · kick-off 15:00 · 53,400 seats". */
  detail: z.string().optional(),
  /** SourceStatus.id that produced it. */
  source: z.string().min(1),
  /** IMPACT window, not just the event itself (contract.md §4.4). */
  start: IsoUtc,
  end: IsoUtc,
  /** Where it happens, for the map. Optional for nationwide signals. */
  place: z.object({ name: z.string(), lat: z.number(), lon: z.number() }).optional(),
  /** What it touches. A journey is affected per contract.md §5.5. */
  scope: z.object({
    /** CRS codes of the stations affected (nearest or serving stations). */
    stations: z.array(Crs),
    /** ATOC operator codes affected (strikes, works); [] = any operator. */
    operators: z.array(z.string()),
    nationwide: z.boolean(),
  }),
  /** 0..1 using the rubric in contract.md §4.5. */
  severity: Prob,
  /** 0..1, how much we trust this record (conflicting sources, far-off forecasts): contract.md §4.6. */
  confidence: Prob,
  /** Raw numbers worth showing or modelling: { windGustKph: 87 }, { capacity: 53400 }. */
  metrics: z.record(z.string(), z.number()).optional(),
  url: z.string().optional(),
});

// ── Data quality: the messy-data story (A1, A2) ─────────────────────────────

export const QualityReportSchema = z.object({
  /** Raw records read. */
  rowsIn: z.number().int().nonnegative(),
  /** Records emitted. rowsIn − rowsOut = sum of `dropped` (merges count as drops). */
  rowsOut: z.number().int().nonnegative(),
  /** Records repaired, by reason: { team_alias_resolved: 380, kickoff_moved_for_tv: 6 }. */
  fixed: z.record(z.string(), z.number().int().nonnegative()),
  /** Records discarded, by reason: { duplicate: 12, unknown_venue: 3 }. */
  dropped: z.record(z.string(), z.number().int().nonnegative()),
});

export const SourceStatusSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Which lane produced it: signals = A1, rail = A2. */
  lane: z.enum(["signals", "rail"]),
  mode: z.enum(["live", "cache", "seed", "fixture", "down"]),
  fetchedAt: IsoUtc.optional(),
  quality: QualityReportSchema,
  note: z.string().optional(),
});

// ── Journeys, fares, reliability (A2) ───────────────────────────────────────

export const TICKET_TYPES = ["advance", "super_off_peak", "off_peak", "anytime"] as const;
export const TicketType = z.enum(TICKET_TYPES);

export const FareSchema = z.object({
  ticketType: TicketType,
  pricePence: Pence,
  /** false = only valid on this train (Advance). */
  flexible: z.boolean(),
});

export const ReliabilityBaselineSchema = z.object({
  /** Historical P(arrives ≤ 15 min late AND not cancelled) for this route × day type × hour. */
  onTimeProb: Prob,
  cancelProb: Prob,
  avgDelayMin: z.number().nonnegative(),
  /** 0 = empty … 1 = crush-loaded (rush hour, leisure peaks). */
  crowding: Prob,
  /** Inside a peak-fare restriction window. */
  peak: z.boolean(),
  /** Observations behind the numbers; 0 = modelled guess. */
  sampleSize: z.number().int().nonnegative(),
});

export const JourneyOptionSchema = z.object({
  /** Deterministic: "EUS-MAN-2026-11-21T09:00:00Z" (origin-destination-departAt). */
  id: z.string().min(1),
  origin: Crs,
  destination: Crs,
  departAt: IsoUtc,
  arriveAt: IsoUtc,
  durationMin: z.number().int().positive(),
  changes: z.number().int().nonnegative(),
  /** ATOC code, e.g. "VT" (see OPERATORS). */
  operator: z.string().min(2),
  /** Intermediate stops in order, excluding origin and destination. */
  callingPoints: z.array(Crs),
  /** What you could buy on the query's bookingDate, cheapest first. At least one. */
  fares: z.array(FareSchema).min(1),
  baseline: ReliabilityBaselineSchema,
});

export const FarePointSchema = z.object({
  /** Booking date. */
  date: IsoDate,
  daysBefore: z.number().int().nonnegative(),
  /** Cheapest fare available if booked that day. */
  pricePence: Pence,
  ticketType: TicketType,
});

export const FareCurveSchema = z.object({
  journeyId: z.string().min(1),
  /** The "today" the curve was computed for. */
  bookingDate: IsoDate,
  /** Ascending by date, from on-sale date to travel day (daily near travel; weekly further out is fine). */
  points: z.array(FarePointSchema).min(1),
  /** When Advance fares go on sale (typically ~12 weeks ahead). */
  advanceOnSale: IsoDate.optional(),
});

// ── Queries ─────────────────────────────────────────────────────────────────

export const SignalQuerySchema = z.object({
  from: IsoUtc,
  to: IsoUtc,
  /** Stations of interest (origin, destination, calling points). Nationwide signals always match. */
  stations: z.array(Crs),
  kinds: z.array(SignalKind).optional(),
});

export const JourneyQuerySchema = z.object({
  origin: Crs,
  destination: Crs,
  dateFrom: IsoDate,
  dateTo: IsoDate,
  /** Departure window, London wall clock, inclusive. */
  earliest: LocalTime,
  latest: LocalTime,
  /** Price fares as if bought on this London date (usually today). */
  bookingDate: IsoDate,
});

export const RecommendationQuerySchema = z.object({
  origin: Crs,
  destination: Crs,
  dateFrom: IsoDate,
  dateTo: IsoDate,
  earliest: LocalTime,
  latest: LocalTime,
  /** 0 = cheapest … 1 = most reliable. */
  priority: Prob,
  /** Defaults to today (London). Set it to replay a scenario. */
  bookingDate: IsoDate.optional(),
});

// ── Recommendations (A3 → A4) ───────────────────────────────────────────────

export const REASON_KINDS = [...SIGNAL_KINDS, "price", "peak", "history", "crowding"] as const;

export const ReasonSchema = z.object({
  kind: z.enum(REASON_KINDS),
  /** Set when the reason comes from a Signal, so the UI can link it; must be in the response's `signals`. */
  signalId: z.string().optional(),
  /** Human sentence: "Man City v Fulham (KO 15:00): crowds at Manchester Piccadilly 12:00–18:00". */
  text: z.string().min(1),
  effect: z.enum(["good", "bad", "neutral"]),
  /** Change in reliability caused by this factor, e.g. -0.12. */
  reliabilityDelta: z.number().min(-1).max(1).optional(),
  /** Change in price caused by this factor, signed pence. */
  priceDeltaPence: z.number().int().optional(),
});

export const VERDICTS = ["best", "great", "good", "risky", "avoid"] as const;
export const Verdict = z.enum(VERDICTS);

export const ScoredOptionSchema = z.object({
  journey: JourneyOptionSchema,
  /** Cheapest fare you would actually pay. */
  pricePence: Pence,
  ticketType: TicketType,
  /** Final P(no significant disruption) after signals. */
  reliability: Prob,
  crowding: Prob,
  score: Score,
  verdict: Verdict,
  /** Most important first. */
  reasons: z.array(ReasonSchema),
});

export const HeatmapCellSchema = z.object({
  /** London date of departure. */
  date: IsoDate,
  /** London hour of departure. */
  hour: z.number().int().min(0).max(23),
  /** Best score in the cell; null = no trains. */
  score: Score.nullable(),
  minPricePence: Pence.nullable(),
  /** Reliability of the best-scoring option in the cell. */
  reliability: Prob.nullable(),
  optionIds: z.array(z.string()),
});

export const BookingAdviceSchema = z.object({
  journeyId: z.string().min(1),
  action: z.enum(["book_now", "wait", "not_on_sale_yet"]),
  /** "Book now: this fare usually rises to £61.60 within a week". */
  headline: z.string().min(1),
  currentPricePence: Pence,
  expectedPricePence: Pence.optional(),
  bookBy: IsoDate.optional(),
  curve: FareCurveSchema,
});

export const RecommendationResponseSchema = z.object({
  contractVersion: z.string(),
  generatedAt: IsoUtc,
  /** Echo of the request, with defaults filled in. */
  query: RecommendationQuerySchema,
  /** Highest score; null when there are no options. */
  best: ScoredOptionSchema.nullable(),
  /** Every option in the window, sorted by departAt. */
  options: z.array(ScoredOptionSchema),
  /** One cell per (London date, hour) in the window, sorted by date then hour. */
  heatmap: z.array(HeatmapCellSchema),
  /** Every signal cited by a reason, plus other relevant context. */
  signals: z.array(SignalSchema),
  /** Advice for `best`. */
  bookingAdvice: BookingAdviceSchema.nullable(),
  sources: z.array(SourceStatusSchema),
  /** Plain-English caveats shown to the user. */
  warnings: z.array(z.string()),
});

// ── HTTP envelope (A3 → A4) ─────────────────────────────────────────────────

export const HealthSchema = z.object({
  ok: z.boolean(),
  contractVersion: z.string(),
  time: IsoUtc,
  /** Which implementation each lane has wired in; "fixture" until that lane ships. */
  providers: z.object({ signals: z.string(), rail: z.string(), engine: z.string() }),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(["bad_request", "not_found", "internal"]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// ── Types ───────────────────────────────────────────────────────────────────

export type Station = z.infer<typeof StationSchema>;
export type SignalKind = z.infer<typeof SignalKind>;
export type Signal = z.infer<typeof SignalSchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export type TicketType = z.infer<typeof TicketType>;
export type Fare = z.infer<typeof FareSchema>;
export type ReliabilityBaseline = z.infer<typeof ReliabilityBaselineSchema>;
export type JourneyOption = z.infer<typeof JourneyOptionSchema>;
export type FarePoint = z.infer<typeof FarePointSchema>;
export type FareCurve = z.infer<typeof FareCurveSchema>;
export type SignalQuery = z.infer<typeof SignalQuerySchema>;
export type JourneyQuery = z.infer<typeof JourneyQuerySchema>;
export type RecommendationQuery = z.infer<typeof RecommendationQuerySchema>;
export type Reason = z.infer<typeof ReasonSchema>;
export type Verdict = z.infer<typeof Verdict>;
export type ScoredOption = z.infer<typeof ScoredOptionSchema>;
export type HeatmapCell = z.infer<typeof HeatmapCellSchema>;
export type BookingAdvice = z.infer<typeof BookingAdviceSchema>;
export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
