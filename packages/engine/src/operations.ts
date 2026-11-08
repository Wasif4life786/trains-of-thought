/**
 * The operator model (contract.md §5.6) as pure functions: how late each service is likely to run, what that costs in
 * Delay Repay 15 compensation, which world signals drive it, and which pre-emptive actions pay for themselves.
 * Capacities, claim rate and mitigation costs are modelled assumptions ("(sample)"), not operator data.
 */
import {
  DELAY_BANDS,
  DELAY_REPAY_15,
  utcToLondon,
  type CompensationEstimate,
  type DelayBand,
  type DelayForecast,
  type ExposureCell,
  type JourneyOption,
  type Mitigation,
  type MitigationKind,
  type OperationsTotals,
  type Reason,
  type RiskLevel,
  type ServiceRisk,
  type SignalKind,
} from "@tot/shared";
import { assess, risk, type Touch } from "./model";

/** Seats per train by operator (typical formation, "(sample)"). */
export const CAPACITY: Record<string, number> = { VT: 589, GR: 611, GW: 576, TP: 342, XC: 300, NT: 240, EM: 380, LD: 402, AW: 200 };
const DEFAULT_CAPACITY = 400;
/**
 * Share of eligible passengers who claim Delay Repay. Calibrated to ORR / Transport Focus passenger surveys: about 35% of
 * passengers eligible for any compensation claimed in 2016–18, and 22% of those eligible under Delay Repay 15 in 2020.
 * We use 25% ("(sample)": an operator would replace it with its own claim data).
 */
export const CLAIM_RATE = 0.25;

/** Of the punctuality a signal destroys, how much becomes cancellations rather than late running. */
const CANCEL_SHARE: Record<SignalKind, number> = {
  strike: 0.6,
  engineering_works: 0.25,
  weather: 0.3,
  football: 0.05,
  concert: 0.05,
  event: 0.05,
  bank_holiday: 0.05,
  other: 0.15,
};

/** Mean minutes beyond 15 late for a train a signal makes late (exponential tail). */
const TAIL_MIN: Record<SignalKind, number> = {
  strike: 60,
  engineering_works: 35,
  weather: 40,
  football: 18,
  concert: 15,
  event: 15,
  bank_holiday: 15,
  other: 25,
};

/** What a mitigation does to the model: scale one signal's risk, the background lateness, or the load. */
export interface Levers {
  /** signal id → multiplier on its risk (0.3 = removes 70% of its effect). */
  signalScale?: Record<string, number>;
  /** Multiplier on the background (history) late mass. */
  baseLateScale?: number;
  /** Multiplier on passengers carried (comms moving people to other trains). */
  passengerScale?: number;
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** P(delay lands in each band) for late running whose excess over 15 minutes is exponential with mean `tail`. */
export function bandShares(tail: number): Record<DelayBand, number> {
  const over = (minutesLate: number) => Math.exp(-(minutesLate - 15) / tail);
  return { "15_29": 1 - over(30), "30_59": over(30) - over(60), "60_119": over(60) - over(120), "120_plus": over(120) };
}

/** Delay forecast for one service given the signals that touch it. */
export function forecastDelay(j: JourneyOption, touching: Touch[], levers: Levers = {}): DelayForecast {
  const base = j.baseline;
  const baseLate = Math.max(0, 1 - base.onTimeProb - base.cancelProb) * (levers.baseLateScale ?? 1);
  const bands: Record<DelayBand, number> = { "15_29": 0, "30_59": 0, "60_119": 0, "120_plus": 0 };
  const addLate = (mass: number, tail: number) => {
    const shares = bandShares(tail);
    for (const b of DELAY_BANDS) bands[b] += mass * shares[b];
  };

  addLate(baseLate, Math.max(10, 2 * base.avgDelayMin + 6));
  let cancel = base.cancelProb;
  let onTime = 1 - baseLate - cancel;
  for (const t of touching) {
    const r = risk(t.signal, t.proximity) * (levers.signalScale?.[t.signal.id] ?? 1);
    const lost = onTime * clamp01(r);
    onTime -= lost;
    cancel += lost * CANCEL_SHARE[t.signal.kind];
    addLate(lost * (1 - CANCEL_SHARE[t.signal.kind]), TAIL_MIN[t.signal.kind]);
  }

  const tailMean = (b: DelayBand) => ({ "15_29": 22, "30_59": 44, "60_119": 85, "120_plus": 150 })[b];
  const expectedDelayMin = onTime * Math.min(base.avgDelayMin, 7) + cancel * 60 + DELAY_BANDS.reduce((s, b) => s + bands[b] * tailMean(b), 0);
  return {
    onTimeProb: round(clamp01(onTime)),
    cancelProb: round(clamp01(cancel)),
    bands: { "15_29": round(bands["15_29"]), "30_59": round(bands["30_59"]), "60_119": round(bands["60_119"]), "120_plus": round(bands["120_plus"]) },
    expectedDelayMin: round(expectedDelayMin, 1),
  };
}

/** Average single fare paid: most passengers (85%) hold the cheapest ticket (Advance, railcard, season), the rest the cheapest walk-up. */
export function averageFare(j: JourneyOption): number {
  const cheapest = j.fares[0]!.pricePence;
  const walkUp = j.fares.find((f) => f.flexible)?.pricePence ?? cheapest;
  return Math.round(0.85 * cheapest + 0.15 * walkUp);
}

export const capacityOf = (operator: string) => CAPACITY[operator] ?? DEFAULT_CAPACITY;

/**
 * Passengers on board. The crowding score (0 = empty … 1 = crush-loaded) becomes a load factor: an ordinary off-peak intercity
 * train is about 35–45% full, a commuter peak about 70%, a crush-loaded Friday getaway full. Calibrated so an Avanti West Coast
 * service averages roughly £250–£350 of Delay Repay (the DfT table has Avanti paying about £33M in 2023/24 on roughly 130k services).
 */
export const passengersFor = (operator: string, crowding: number, scale = 1) => Math.round(capacityOf(operator) * Math.min(1.05, 0.15 + 0.85 * Math.pow(Math.max(0, crowding), 1.5)) * scale);

/** Expected Delay Repay 15 payout, in pence, for a delay forecast. */
export function payout(delay: DelayForecast, passengers: number, avgFarePence: number): number {
  const share = DELAY_BANDS.reduce((s, b) => s + delay.bands[b] * DELAY_REPAY_15[b], 0) + delay.cancelProb * DELAY_REPAY_15["60_119"];
  return Math.round(passengers * CLAIM_RATE * avgFarePence * share);
}

/** Expected compensation for a service, with and without the signals. */
export function costOf(j: JourneyOption, touching: Touch[], crowding: number, levers: Levers = {}): { delay: DelayForecast; cost: number; passengers: number } {
  const delay = forecastDelay(j, touching, levers);
  const passengers = passengersFor(j.operator, crowding, levers.passengerScale);
  return { delay, cost: payout(delay, passengers, averageFare(j)), passengers };
}

export function riskLevelFor(delay: DelayForecast): RiskLevel {
  const disrupted = 1 - delay.onTimeProb;
  if (disrupted >= 0.45) return "severe";
  if (disrupted >= 0.3) return "high";
  if (disrupted >= 0.2) return "elevated";
  return "low";
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, elevated: 1, high: 2, severe: 3 };
export const worstRisk = (levels: RiskLevel[]): RiskLevel | null => levels.reduce<RiskLevel | null>((w, l) => (!w || RISK_ORDER[l] > RISK_ORDER[w] ? l : w), null);

const hhmm = (iso: string) => utcToLondon(iso).time;

interface Candidate {
  kind: MitigationKind;
  title: string;
  detail: string;
  signalId?: string;
  costPence: number;
  levers: Levers;
}

const CROWD_KINDS = new Set<SignalKind>(["football", "concert", "event", "bank_holiday"]);

/** Every pre-emptive action that could apply to this service, before costing it out. */
function candidates(j: JourneyOption, touching: Touch[], passengers: number, name: (crs: string) => string): Candidate[] {
  const out: Candidate[] = [];
  const where = (t: Touch) => {
    const hit = t.signal.scope.stations.filter((crs) => [j.origin, j.destination, ...j.callingPoints].includes(crs));
    return t.signal.scope.nationwide ? "across the route" : `at ${(hit.length ? hit : t.signal.scope.stations).slice(0, 2).map(name).join(" & ")}`;
  };
  const window = (t: Touch) => `${hhmm(t.signal.start)}–${hhmm(t.signal.end)}`;
  const only = (id: string, scale: number): Levers => ({ signalScale: { [id]: scale } });

  for (const t of touching) {
    const s = t.signal;
    switch (s.kind) {
      case "strike":
        out.push({ kind: "contingency_timetable", title: "Publish a strike timetable by 22:00 the day before", detail: `${s.title}: Delay Repay is then measured against the reduced timetable, not the normal one`, signalId: s.id, costPence: 20_000, levers: only(s.id, 0.3) });
        break;
      case "engineering_works":
        out.push({ kind: "engineering_contingency", title: "Retime around the works and add diversion running time", detail: `${s.title} ${where(t)}, ${window(t)}: publish the retimed path by 22:00 the day before`, signalId: s.id, costPence: 15_000, levers: only(s.id, 0.35) });
        break;
      case "weather":
        out.push({ kind: "standby_stock", title: "Position a rescue loco and standby crew", detail: `${s.title} ${where(t)}, ${window(t)}: cuts recovery time when a train fails`, signalId: s.id, costPence: 45_000, levers: only(s.id, 0.6) });
        if (s.severity >= 0.6) out.push({ kind: "contingency_timetable", title: "Run a reduced, slower weather timetable", detail: `${s.title}: publish by 22:00 the day before so delays are measured against it`, signalId: s.id, costPence: 20_000, levers: only(s.id, 0.35) });
        break;
      case "football":
      case "concert":
      case "event":
      case "bank_holiday":
        out.push({ kind: "crowd_management", title: "Queue barriers and extra platform staff", detail: `${s.title} ${where(t)}, ${window(t)}: faster boarding, shorter dwell times`, signalId: s.id, costPence: 25_000, levers: only(s.id, 0.5) });
        if (passengers >= 0.9 * capacityOf(j.operator)) {
          out.push({ kind: "extra_capacity", title: "Strengthen the train (extra coaches)", detail: `${s.title}: about ${passengers} people on board for ${capacityOf(j.operator)} seats`, signalId: s.id, costPence: 120_000, levers: { signalScale: { [s.id]: 0.4 } } });
        }
        break;
      case "other":
        out.push({ kind: "standby_crew", title: "Roster a standby crew", detail: `${s.title} ${where(t)}, ${window(t)}`, signalId: s.id, costPence: 20_000, levers: only(s.id, 0.7) });
        break;
    }
  }
  if (j.baseline.onTimeProb <= 0.85) {
    out.push({ kind: "standby_crew", title: "Roster a standby crew at the origin", detail: `Only ${Math.round(j.baseline.onTimeProb * 100)}% of these trains arrive within 15 minutes: covers late crew changes and slow turnarounds`, costPence: 20_000, levers: { baseLateScale: 0.8 } });
  }
  if (touching.some((t) => CROWD_KINDS.has(t.signal.kind) || t.signal.severity >= 0.5)) {
    out.push({ kind: "passenger_comms", title: "Warn ticket holders and offer free transfers", detail: "Email and app alerts a few days ahead so flexible travellers move to quieter trains", costPence: 5_000, levers: { passengerScale: 0.85 } });
  }
  return out;
}

export interface ServiceInput {
  journey: JourneyOption;
  touching: Touch[];
}

/** One service's full risk picture: delay bands, compensation, drivers with their cost, and mitigations that pay. */
export function assessService({ journey: j, touching }: ServiceInput, name: (crs: string) => string): ServiceRisk {
  const a = assess(j, touching, name);
  const full = costOf(j, touching, a.crowding);
  const baseline = costOf(j, [], j.baseline.crowding);

  const marginal = (signalId: string) => full.cost - costOf(j, touching, a.crowding, { signalScale: { [signalId]: 0 } }).cost;
  const reasons: Reason[] = a.reasons
    .filter((r) => r.kind !== "price" && r.kind !== "peak")
    .map((r) => (r.signalId ? { ...r, compensationPence: Math.max(0, marginal(r.signalId)) } : r.kind === "history" && r.effect === "bad" ? { ...r, compensationPence: baseline.cost } : r))
    .sort((x, y) => (y.compensationPence ?? 0) - (x.compensationPence ?? 0) || Math.abs(y.reliabilityDelta ?? 0) - Math.abs(x.reliabilityDelta ?? 0));

  const mitigations: Mitigation[] = candidates(j, touching, full.passengers, name)
    .map((c) => {
      const saving = Math.max(0, full.cost - costOf(j, touching, a.crowding, c.levers).cost);
      return { kind: c.kind, title: c.title, detail: c.detail, ...(c.signalId ? { signalId: c.signalId } : {}), costPence: c.costPence, savingPence: saving, netPence: saving - c.costPence };
    })
    .filter((m) => m.netPence > 0)
    .sort((x, y) => y.netPence - x.netPence);

  const compensation: CompensationEstimate = {
    passengers: full.passengers,
    claimRate: CLAIM_RATE,
    avgFarePence: averageFare(j),
    expectedClaims: round(full.passengers * CLAIM_RATE * (1 - full.delay.onTimeProb), 1),
    expectedCostPence: full.cost,
    baselineCostPence: baseline.cost,
  };
  return { journey: j, delay: full.delay, compensation, riskLevel: riskLevelFor(full.delay), reasons, mitigations };
}

export function totalsOf(services: ServiceRisk[]): OperationsTotals {
  const best = services.flatMap((s) => (s.mitigations[0] ? [s.mitigations[0]] : []));
  return {
    services: services.length,
    highRiskServices: services.filter((s) => s.riskLevel === "high" || s.riskLevel === "severe").length,
    expectedCostPence: services.reduce((n, s) => n + s.compensation.expectedCostPence, 0),
    baselineCostPence: services.reduce((n, s) => n + s.compensation.baselineCostPence, 0),
    mitigationCostPence: best.reduce((n, m) => n + m.costPence, 0),
    mitigationSavingPence: best.reduce((n, m) => n + m.savingPence, 0),
  };
}

/** One cell per (London date, hour) from the window's first hour to its last: the hour's total expected compensation. */
export function buildExposure(services: ServiceRisk[], dates: string[], earliest: string, latest: string): ExposureCell[] {
  const byCell = new Map<string, ServiceRisk[]>();
  for (const s of services) {
    const local = utcToLondon(s.journey.departAt);
    const key = `${local.date}|${local.hour}`;
    byCell.set(key, [...(byCell.get(key) ?? []), s]);
  }
  const cells: ExposureCell[] = [];
  for (const date of dates) {
    for (let hour = Number(earliest.slice(0, 2)); hour <= Number(latest.slice(0, 2)); hour++) {
      const inCell = byCell.get(`${date}|${hour}`) ?? [];
      cells.push({
        date,
        hour,
        expectedCostPence: inCell.length ? inCell.reduce((n, s) => n + s.compensation.expectedCostPence, 0) : null,
        worstRisk: worstRisk(inCell.map((s) => s.riskLevel)),
        serviceIds: inCell.map((s) => s.journey.id),
      });
    }
  }
  return cells;
}
