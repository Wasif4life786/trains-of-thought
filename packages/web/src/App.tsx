import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { formatPence, operatorName, type RecommendationQuery, type RecommendationResponse, type ScoredOption } from "@tot/shared";
import { api, usingFixtures } from "./api";
import { StationPicker } from "./StationPicker";

// Starter UI so the whole pipeline is visible from minute one. A4 (Platform) owns this package: redesign freely (contract.md §6.4).

const START: RecommendationQuery = {
  origin: "EUS",
  destination: "MAN",
  dateFrom: "2026-11-20",
  dateTo: "2026-11-22",
  earliest: "06:00",
  latest: "22:00",
  priority: 0.5,
};

const VERDICT_STYLE: Record<ScoredOption["verdict"], string> = {
  best: "bg-emerald-600 text-white",
  great: "bg-emerald-100 text-emerald-900",
  good: "bg-sky-100 text-sky-900",
  risky: "bg-amber-100 text-amber-900",
  avoid: "bg-rose-100 text-rose-900",
};

const INPUT = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const dayTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const percent = (p: number) => `${Math.round(p * 100)}%`;

export function App() {
  const [query, setQuery] = useState(START);
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(q: RecommendationQuery) {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.recommendations(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void search(START);
  }, []);

  const bind = (key: "dateFrom" | "dateTo") => ({
    value: query[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setQuery({ ...query, [key]: e.target.value }),
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 text-slate-900">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">🚆 Trains of Thought</h1>
        <p className="text-slate-600">The cheapest train that won't let you down, and when to book it.</p>
        {usingFixtures && <p className="mt-2 text-sm text-amber-700">Fixture mode: answers come from @tot/shared/fixtures, not the API.</p>}
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
        className="mb-8 grid grid-cols-2 items-end gap-3 sm:grid-cols-6"
      >
        <div className="col-span-2 sm:col-span-1">
          <StationPicker label="From" value={query.origin} onChange={(origin) => setQuery({ ...query, origin })} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <StationPicker label="To" value={query.destination} onChange={(destination) => setQuery({ ...query, destination })} />
        </div>
        <Field label="First day">
          <input type="date" className={INPUT} {...bind("dateFrom")} />
        </Field>
        <Field label="Last day">
          <input type="date" className={INPUT} {...bind("dateTo")} />
        </Field>
        <Field label={`Cheapest ↔ Reliable (${query.priority})`}>
          <input type="range" min={0} max={1} step={0.1} value={query.priority} onChange={(e) => setQuery({ ...query, priority: Number(e.target.value) })} />
        </Field>
        <button disabled={loading} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="mb-6 rounded-lg bg-rose-50 p-4 text-rose-800">{error}</p>}
      {result && <Results result={result} />}
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}

function Results({ result }: { result: RecommendationResponse }) {
  const { best, options, warnings, bookingAdvice } = result;
  return (
    <section className="space-y-6">
      {warnings.length > 0 && (
        <ul className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          {warnings.map((w) => (
            <li key={w}>⚠️ {w}</li>
          ))}
        </ul>
      )}

      {best && (
        <article className="rounded-2xl border-2 border-emerald-600 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Best pick</p>
          <h2 className="mt-1 text-2xl font-bold">
            {dayTime.format(new Date(best.journey.departAt))} → {clock.format(new Date(best.journey.arriveAt))}
          </h2>
          <p className="text-slate-600">
            {operatorName(best.journey.operator)} · {formatPence(best.pricePence)} {best.ticketType.replaceAll("_", " ")} · {percent(best.reliability)} reliable · score {best.score}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {best.reasons.slice(0, 3).map((r) => (
              <li key={r.text}>
                {r.effect === "good" ? "✅" : "⚠️"} {r.text}
              </li>
            ))}
          </ul>
          {bookingAdvice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-900">💷 {bookingAdvice.headline}</p>}
        </article>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-3">Departs</th>
              <th className="p-3">Price</th>
              <th className="p-3">Reliable</th>
              <th className="p-3">Score</th>
              <th className="p-3">Main reason</th>
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.journey.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap p-3">{dayTime.format(new Date(o.journey.departAt))}</td>
                <td className="p-3">{formatPence(o.pricePence)}</td>
                <td className="p-3">{percent(o.reliability)}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLE[o.verdict]}`}>
                    {o.score} {o.verdict}
                  </span>
                </td>
                <td className="p-3 text-slate-600">{o.reasons[0]?.text ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {result.sources.length} data sources · contract v{result.contractVersion}
      </p>
    </section>
  );
}
