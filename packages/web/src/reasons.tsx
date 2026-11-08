import type { Reason } from "@tot/shared";
import { pounds } from "./ui";

/** One icon per reason kind (contract.md §6.4). */
export const REASON_ICON: Record<Reason["kind"], string> = {
  football: "⚽",
  weather: "🌧",
  concert: "🎤",
  event: "🎉",
  bank_holiday: "🎉",
  engineering_works: "🛠",
  strike: "✊",
  price: "💷",
  peak: "⏱",
  history: "⏱",
  crowding: "👥",
  other: "⚠️",
};

const TONE: Record<Reason["effect"], string> = {
  good: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  bad: "bg-amber-50 text-amber-900 ring-amber-200",
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
};

/** A reason as a coloured chip: green helps, amber hurts. The full sentence is the text; the icon is decoration. */
export function ReasonChip({ reason }: { reason: Reason }) {
  return (
    <span className={`inline-flex items-start gap-1.5 rounded-lg px-2 py-1 text-xs ring-1 ${TONE[reason.effect]}`}>
      <span aria-hidden>{REASON_ICON[reason.kind]}</span>
      <span>
        {reason.text}
        {reason.compensationPence ? <span className="font-semibold"> · +{pounds(reason.compensationPence)} exposure</span> : null}
      </span>
    </span>
  );
}
