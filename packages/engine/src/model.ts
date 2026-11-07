/** The scoring model of contract.md §5.5 as pure functions: no I/O, so every number in it is unit-testable. */
import {
  addMinutes,
  formatPence,
  overlaps,
  utcToLondon,
  type JourneyOption,
  type Reason,
  type ScoredOption,
  type Signal,
  type SignalKind,
  type Verdict,
} from "@tot/shared";

/** How much a signal of this kind disrupts a train it touches, before severity and confidence. */
export const KIND_WEIGHT: Record<SignalKind, number> = {
  strike: 0.9,
  engineering_works: 0.6,
  weather: 0.5,
  football: 0.3,
  concert: 0.2,
  other: 0.2,
  event: 0.1,
  bank_holiday: 0.1,
};

/** Kinds that put more people on the trains (crowding) rather than, or as well as, delaying them. */
const CROWD_KINDS = new Set<SignalKind>(["football", "concert", "event", "bank_holiday"]);

const SIGNAL_EFFECT: Record<SignalKind, string> = {
  weather: "disruption risk",
  football: "match crowds",
  concert: "concert crowds",
  event: "extra crowds",
  strike: "strike action",
  engineering_works: "diversions",
  bank_holiday: "holiday timetable",
  other: "disruption",
};

const NEAR_MIN = 30;

/** How strongly a signal touches a journey: 1 at the origin or destination (or nationwide), 0.6 at a calling point, else 0. */
export function proximity(j: JourneyOption, s: Signal): number {
  if (s.scope.operators.length > 0 && !s.scope.operators.includes(j.operator)) return 0;
  if (s.scope.nationwide) return overlaps(s.start, s.end, addMinutes(j.departAt, -NEAR_MIN), addMinutes(j.arriveAt, NEAR_MIN)) ? 1 : 0;
  const near = (at: string) => overlaps(s.start, s.end, addMinutes(at, -NEAR_MIN), addMinutes(at, NEAR_MIN));
  if (s.scope.stations.includes(j.origin) && near(j.departAt)) return 1;
  if (s.scope.stations.includes(j.destination) && near(j.arriveAt)) return 1;
  const n = j.callingPoints.length;
  const atCallingPoint = j.callingPoints.some((crs, i) => s.scope.stations.includes(crs) && near(addMinutes(j.departAt, Math.round(((i + 1) / (n + 1)) * j.durationMin))));
  return atCallingPoint ? 0.6 : 0;
}

/** Chance this signal ruins this journey: severity × confidence × kind weight × proximity. */
export const risk = (s: Signal, prox: number): number => s.severity * s.confidence * KIND_WEIGHT[s.kind] * prox;

export interface Touch {
  signal: Signal;
  proximity: number;
}

/** Every signal that touches a journey, with how strongly. */
export function touches(j: JourneyOption, signals: Signal[]): Touch[] {
  return signals.flatMap((signal) => {
    const p = proximity(j, signal);
    return p > 0 ? [{ signal, proximity: p }] : [];
  });
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Where a signal bites on a journey, in words: "Manchester Piccadilly & Stockport". */
function whereText(j: JourneyOption, t: Touch, name: (crs: string) => string): string {
  if (t.signal.scope.nationwide) return "nationwide";
  const wanted = t.proximity === 1 ? [j.origin, j.destination] : j.callingPoints;
  const hit = t.signal.scope.stations.filter((crs) => wanted.includes(crs));
  return (hit.length > 0 ? hit : t.signal.scope.stations).slice(0, 2).map(name).join(" & ");
}

const hhmm = (iso: string) => utcToLondon(iso).time;

export interface Assessment {
  reliability: number;
  crowding: number;
  reasons: Reason[];
}

/** Reliability, crowding and reasons for one journey, given the signals that touch it. */
export function assess(j: JourneyOption, touching: Touch[], name: (crs: string) => string): Assessment {
  let reliability = j.baseline.onTimeProb;
  let crowding = j.baseline.crowding;
  const reasons: Reason[] = [];

  for (const t of touching) {
    const r = risk(t.signal, t.proximity);
    reliability *= 1 - r;
    if (CROWD_KINDS.has(t.signal.kind)) crowding += t.signal.severity * 0.4 * t.proximity;
    reasons.push({
      kind: t.signal.kind,
      signalId: t.signal.id,
      text: `${t.signal.title}: ${SIGNAL_EFFECT[t.signal.kind]} at ${whereText(j, t, name)}, ${hhmm(t.signal.start)}–${hhmm(t.signal.end)}`,
      effect: "bad",
      reliabilityDelta: -round(j.baseline.onTimeProb * r, 3),
    });
  }

  const cheapest = j.fares[0]!;
  const walkUp = j.fares.find((f) => f.flexible);
  if (cheapest.ticketType === "advance" && walkUp && walkUp.pricePence - cheapest.pricePence >= 1000) {
    const saving = walkUp.pricePence - cheapest.pricePence;
    reasons.push({ kind: "price", text: `Advance ticket ${formatPence(cheapest.pricePence)}: ${formatPence(saving)} less than the cheapest walk-up fare`, effect: "good", priceDeltaPence: -saving });
  }
  if (!j.fares.some((f) => f.ticketType === "advance")) reasons.push({ kind: "price", text: "Advance tickets sold out or not yet on sale: walk-up fares only", effect: "bad" });
  if (j.baseline.peak) {
    const anytime = j.fares.find((f) => f.ticketType === "anytime");
    const offPeak = j.fares.find((f) => f.ticketType === "off_peak") ?? anytime;
    const extra = anytime && offPeak ? anytime.pricePence - offPeak.pricePence : 0;
    reasons.push({
      kind: "peak",
      text: `Peak train: ${anytime ? `Anytime ${formatPence(anytime.pricePence)}` : "full fare"} unless you have an Advance`,
      effect: "bad",
      ...(extra > 0 ? { priceDeltaPence: extra } : {}),
    });
  }
  if (j.baseline.onTimeProb >= 0.9) reasons.push({ kind: "history", text: `Usually punctual: ${pct(j.baseline.onTimeProb)} on time historically`, effect: "good" });
  else if (j.baseline.onTimeProb <= 0.82) reasons.push({ kind: "history", text: `Often late: only ${pct(j.baseline.onTimeProb)} arrive within 15 minutes`, effect: "bad" });
  if (crowding >= 0.75) reasons.push({ kind: "crowding", text: "Busy train: expect to stand", effect: "bad" });

  return { reliability: round(clamp01(reliability), 3), crowding: round(clamp01(crowding)), reasons };
}

const impact = (r: Reason) => Math.abs(r.reliabilityDelta ?? 0) * 100 + Math.abs(r.priceDeltaPence ?? 0) / 200 + (r.reliabilityDelta === undefined && r.priceDeltaPence === undefined ? 2 : 0);

export function verdictFor(score: number): Verdict {
  if (score >= 70) return "great";
  if (score >= 55) return "good";
  if (score >= 40) return "risky";
  return "avoid";
}

/**
 * Scores every journey 0–100: (1 − priority) × (cheapest price ÷ this price) + priority × reliability rescaled from 55–95%.
 * The top score is the single `best`; ties go to the earliest departure (journeys must arrive sorted by departure).
 */
export function scoreAll(journeys: JourneyOption[], assessments: Assessment[], priority: number): ScoredOption[] {
  const prices = journeys.map((j) => j.fares[0]!.pricePence);
  const minPrice = Math.min(...prices);
  const scored: ScoredOption[] = journeys.map((journey, i) => {
    const a = assessments[i]!;
    const priceScore = minPrice / prices[i]!;
    const reliabilityScore = clamp01((a.reliability - 0.55) / 0.4);
    const score = Math.round(100 * ((1 - priority) * priceScore + priority * reliabilityScore));
    return {
      journey,
      pricePence: prices[i]!,
      ticketType: journey.fares[0]!.ticketType,
      reliability: a.reliability,
      crowding: a.crowding,
      score,
      verdict: verdictFor(score),
      reasons: [...a.reasons].sort((x, y) => impact(y) - impact(x)),
    };
  });
  const top = Math.max(...scored.map((o) => o.score));
  const best = scored.find((o) => o.score === top);
  if (best) best.verdict = "best";
  return scored;
}
