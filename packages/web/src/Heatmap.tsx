import { formatPence, type HeatmapCell } from "@tot/shared";

const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const label = (date: string) => dayLabel.format(new Date(`${date}T12:00:00Z`));

/** Score 0–100 → a light red → amber → green fill; no trains → grey. */
export const scoreColor = (score: number | null): string => (score === null ? "hsl(210 20% 94%)" : `hsl(${Math.round(score * 1.2)} 70% 82%)`);

export const cellKey = (cell: { date: string; hour: number }): string => `${cell.date}|${cell.hour}`;

interface Props {
  cells: HeatmapCell[];
  /** The selected cell's key (see cellKey), or null. */
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Price of a departure after any railcard, so the tooltip agrees with the table. */
  priceOf: (journeyId: string) => number | undefined;
}

/** Departure day × hour, coloured by the best score in the slot. Click a slot to filter the list to it, click again to clear. */
export function Heatmap({ cells, selected, onSelect, priceOf }: Props) {
  const dates = [...new Set(cells.map((c) => c.date))];
  const hours = [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [cellKey(c), c]));

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">When to go</h3>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          worse
          <span aria-hidden className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, hsl(0 70% 82%), hsl(60 70% 82%), hsl(120 70% 82%))" }} />
          better · grey: no trains
        </p>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <div role="grid" aria-label="Score by day and hour of departure" className="grid gap-1" style={{ gridTemplateColumns: `5.5rem repeat(${hours.length}, minmax(1.9rem, 1fr))` }}>
          <div />
          {hours.map((h) => (
            <div key={h} role="columnheader" className="text-center text-[10px] text-slate-500">
              {String(h).padStart(2, "0")}
            </div>
          ))}
          {dates.map((date) => (
            <Row key={date} date={date} hours={hours} byKey={byKey} selected={selected} onSelect={onSelect} priceOf={priceOf} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ date, hours, byKey, selected, onSelect, priceOf }: { date: string; hours: number[] } & Pick<Props, "selected" | "onSelect" | "priceOf"> & { byKey: Map<string, HeatmapCell> }) {
  return (
    <>
      <div role="rowheader" className="flex items-center text-xs font-medium text-slate-600">
        {label(date)}
      </div>
      {hours.map((hour) => {
        const cell = byKey.get(cellKey({ date, hour }));
        const key = cellKey({ date, hour });
        const prices = (cell?.optionIds ?? []).map(priceOf).filter((p): p is number => p !== undefined);
        const from = prices.length > 0 ? Math.min(...prices) : cell?.minPricePence;
        const empty = !cell || cell.score === null;
        const text = empty
          ? `${label(date)} ${String(hour).padStart(2, "0")}:00: no trains`
          : `${label(date)} ${String(hour).padStart(2, "0")}:00 · ${cell.optionIds.length} train${cell.optionIds.length === 1 ? "" : "s"} · from ${from != null ? formatPence(from) : "?"} · ${Math.round((cell.reliability ?? 0) * 100)}% reliable · score ${cell.score}`;
        return (
          <button
            key={key}
            type="button"
            role="gridcell"
            disabled={empty}
            title={text}
            aria-label={text}
            aria-pressed={selected === key}
            onClick={() => onSelect(selected === key ? null : key)}
            className={`h-8 rounded text-[11px] font-medium text-slate-800 ${empty ? "cursor-default text-slate-300" : "hover:brightness-95"} ${selected === key ? "ring-2 ring-slate-900" : ""}`}
            style={{ backgroundColor: scoreColor(cell?.score ?? null) }}
          >
            {empty ? "·" : cell.score}
          </button>
        );
      })}
    </>
  );
}
