import type { ReactNode } from "react";
import { formatPence, type Mitigation, type RiskLevel } from "@tot/shared";

const dayTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "Sat 21 Nov, 09:00" in London time. */
export const at = (iso: string) => dayTime.format(new Date(iso));
/** "11:08" in London time. */
export const hhmm = (iso: string) => clock.format(new Date(iso));
/** A London calendar date ("2026-11-21") → "Sat 21 Nov". */
export const dateLabel = (date: string) => dayLabel.format(new Date(`${date}T12:00:00Z`));
export const percent = (p: number) => `${Math.round(p * 100)}%`;
/** Whole pounds for big totals: "£12,345". */
export const pounds = (pence: number) => formatPence(Math.round(pence / 100) * 100).replace(/\.00$/, "");

export const RISK_STYLE: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-800",
  elevated: "bg-sky-100 text-sky-800",
  high: "bg-amber-100 text-amber-900",
  severe: "bg-rose-100 text-rose-800",
};

export const RISK_RANK: Record<RiskLevel, number> = { low: 0, elevated: 1, high: 2, severe: 3 };

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${RISK_STYLE[level]}`}>{level}</span>;
}

export function Stat({ label, value, note, tone = "plain" }: { label: string; value: string; note?: ReactNode; tone?: "plain" | "bad" | "good" }) {
  const color = tone === "bad" ? "text-rose-700" : tone === "good" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
      {warnings.map((w) => (
        <li key={w}>⚠️ {w}</li>
      ))}
    </ul>
  );
}

const ACTION_ICON: Record<Mitigation["kind"], string> = {
  contingency_timetable: "🗓",
  engineering_contingency: "🛠",
  standby_stock: "🚂",
  standby_crew: "👷",
  crowd_management: "🚧",
  extra_capacity: "➕",
  passenger_comms: "📣",
};

/** A costed pre-emptive action: what to do, where, what it costs and what it saves. */
export function MitigationCard({ m, compact = false }: { m: Mitigation; compact?: boolean }) {
  return (
    <div className={`rounded-lg bg-emerald-50 ring-1 ring-emerald-200 ${compact ? "p-2" : "p-3"}`}>
      <p className="font-semibold text-emerald-900">
        <span aria-hidden>{ACTION_ICON[m.kind]} </span>
        {m.title}
      </p>
      {!compact && <p className="mt-0.5 text-xs text-emerald-900/80">{m.detail}</p>}
      <p className="mt-1 text-xs text-emerald-900">
        costs {pounds(m.costPence)} · saves {pounds(m.savingPence)} · <span className="font-semibold">net +{pounds(m.netPence)}</span>
      </p>
    </div>
  );
}
