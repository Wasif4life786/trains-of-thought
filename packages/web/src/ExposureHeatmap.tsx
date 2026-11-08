import type { ExposureCell } from "@tot/shared";
import { dateLabel, pounds } from "./ui";

export const cellKey = (cell: { date: string; hour: number }): string => `${cell.date}|${cell.hour}`;

/** Share of the busiest hour's exposure → white … deep red; no trains → grey. */
export const exposureColor = (share: number | null): string => (share === null ? "hsl(210 20% 94%)" : `hsl(${Math.round(35 - 30 * share)} 85% ${Math.round(96 - 46 * share)}%)`);

interface Props {
  cells: ExposureCell[];
  /** The selected cell's key (see cellKey), or null. */
  selected: string | null;
  onSelect: (key: string | null) => void;
}

/** Departure day × hour, coloured by expected Delay Repay cost. Click an hour to filter the services to it. */
export function ExposureHeatmap({ cells, selected, onSelect }: Props) {
  const dates = [...new Set(cells.map((c) => c.date))];
  const hours = [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [cellKey(c), c]));
  const max = Math.max(1, ...cells.map((c) => c.expectedCostPence ?? 0));

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Where the compensation risk sits</h3>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          £0
          <span aria-hidden className="h-2 w-24 rounded-full" style={{ background: `linear-gradient(to right, ${exposureColor(0)}, ${exposureColor(0.5)}, ${exposureColor(1)})` }} />
          {pounds(max)} an hour · grey: no trains
        </p>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <div role="grid" aria-label="Expected compensation by day and hour of departure" className="grid gap-1" style={{ gridTemplateColumns: `5.5rem repeat(${hours.length}, minmax(2.4rem, 1fr))` }}>
          <div />
          {hours.map((h) => (
            <div key={h} role="columnheader" className="text-center text-[10px] text-slate-500">
              {String(h).padStart(2, "0")}
            </div>
          ))}
          {dates.map((date) => (
            <div key={date} role="row" className="contents">
              <div role="rowheader" className="flex items-center text-xs font-medium text-slate-600">
                {dateLabel(date)}
              </div>
              {hours.map((hour) => {
                const key = cellKey({ date, hour });
                const cell = byKey.get(key);
                const cost = cell?.expectedCostPence ?? null;
                const text =
                  cost === null
                    ? `${dateLabel(date)} ${String(hour).padStart(2, "0")}:00: no trains`
                    : `${dateLabel(date)} ${String(hour).padStart(2, "0")}:00 · ${cell!.serviceIds.length} service${cell!.serviceIds.length === 1 ? "" : "s"} · ${pounds(cost)} expected · worst risk ${cell!.worstRisk}`;
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    disabled={cost === null}
                    title={text}
                    aria-label={text}
                    aria-pressed={selected === key}
                    onClick={() => onSelect(selected === key ? null : key)}
                    className={`h-8 rounded text-[10px] font-medium ${cost === null ? "cursor-default text-slate-300" : "hover:brightness-95"} ${selected === key ? "ring-2 ring-slate-900" : ""}`}
                    style={{ backgroundColor: exposureColor(cost === null ? null : cost / max), ...(cost === null ? {} : { color: cost / max > 0.6 ? "#ffffff" : "#1e293b" }) }}
                  >
                    {cost === null ? "·" : cost >= 100_000 ? `${Math.round(cost / 100_000)}k` : Math.round(cost / 100)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
