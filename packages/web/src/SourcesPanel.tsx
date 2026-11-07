import type { SourceStatus } from "@tot/shared";

const MODE: Record<SourceStatus["mode"], string> = {
  live: "bg-emerald-100 text-emerald-800",
  cache: "bg-sky-100 text-sky-800",
  seed: "bg-slate-200 text-slate-700",
  fixture: "bg-amber-100 text-amber-800",
  down: "bg-rose-100 text-rose-800",
};

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
const words = (reason: string) => reason.replaceAll("_", " ");
const top = (counts: Record<string, number>, n = 3) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);

/** The messy-data story: for every source, how much came in, what we repaired and what we threw away. */
export function SourcesPanel({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) return null;
  const fixes = sources.reduce((n, s) => n + sum(s.quality.fixed), 0);
  const drops = sources.reduce((n, s) => n + sum(s.quality.dropped), 0);
  const rows = sources.reduce((n, s) => n + s.quality.rowsIn, 0);

  return (
    <details className="rounded-2xl bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">
        What we cleaned <span className="font-normal text-slate-500">· {sources.length} sources · {rows.toLocaleString("en-GB")} rows read · {fixes.toLocaleString("en-GB")} repaired · {drops.toLocaleString("en-GB")} discarded</span>
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Rows in → out</th>
              <th className="py-2 pr-3">Repaired</th>
              <th className="py-2">Discarded</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-800">{s.name}</div>
                  {s.note && <div className="text-slate-500">{s.note}</div>}
                </td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${MODE[s.mode]}`}>{s.mode}</span>
                </td>
                <td className="whitespace-nowrap py-2 pr-3">
                  {s.quality.rowsIn.toLocaleString("en-GB")} → {s.quality.rowsOut.toLocaleString("en-GB")}
                </td>
                <td className="py-2 pr-3">
                  <Counts counts={s.quality.fixed} />
                </td>
                <td className="py-2">
                  <Counts counts={s.quality.dropped} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Counts({ counts }: { counts: Record<string, number> }) {
  const shown = top(counts);
  if (shown.length === 0) return <span className="text-slate-400">none</span>;
  const more = Object.keys(counts).length - shown.length;
  return (
    <ul className="space-y-0.5">
      {shown.map(([reason, n]) => (
        <li key={reason}>
          {words(reason)} <span className="font-semibold">×{n.toLocaleString("en-GB")}</span>
        </li>
      ))}
      {more > 0 && <li className="text-slate-400">+{more} more</li>}
    </ul>
  );
}
