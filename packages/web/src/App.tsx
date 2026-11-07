import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import type { RecommendationQuery, RecommendationResponse } from "@tot/shared";
import { api, usingFixtures } from "./api";
import { Results } from "./Results";
import { StationPicker } from "./StationPicker";
import { readState, writeState, type ReturnDates, type Trip } from "./url";

// A4 (Platform) owns this package: redesign freely (contract.md §6.4).

const INPUT = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

export function App() {
  // The form starts from the address bar, so a shared link reproduces the search.
  const [initial] = useState(() => readState(window.location.search));
  const [query, setQuery] = useState(initial.query);
  const [trip, setTrip] = useState<Trip>(initial.trip);
  const [returnDates, setReturnDates] = useState(initial.returnDates);
  const [railcard, setRailcard] = useState(initial.railcard);
  const [result, setResult] = useState<{ outbound: RecommendationResponse; inbound: RecommendationResponse | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(q: RecommendationQuery, mode: Trip, ret: ReturnDates) {
    setLoading(true);
    setError(null);
    try {
      // A return is two searches: the way there, and the same trip run backwards for the return dates.
      const wayBack: RecommendationQuery = { ...q, origin: q.destination, destination: q.origin, dateFrom: ret.from, dateTo: ret.to };
      const [outbound, inbound] = await Promise.all([api.recommendations(q), mode === "return" ? api.recommendations(wayBack) : null]);
      setResult({ outbound, inbound });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void search(initial.query, initial.trip, initial.returnDates);
  }, [initial]);

  // Keep the address bar in step with the form (without piling up history entries).
  useEffect(() => {
    window.history.replaceState(null, "", `?${writeState({ query, trip, returnDates, railcard })}`);
  }, [query, trip, returnDates, railcard]);

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
          void search(query, trip, returnDates);
        }}
        className="mb-8 grid grid-cols-2 items-end gap-3 sm:grid-cols-6"
      >
        <div role="radiogroup" aria-label="Trip type" className="col-span-2 inline-flex w-fit rounded-lg bg-slate-200 p-1 text-sm font-semibold sm:col-span-6">
          {(["single", "return"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={trip === t}
              onClick={() => setTrip(t)}
              className={`rounded-md px-4 py-1.5 ${trip === t ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {t === "single" ? "One way" : "Return"}
            </button>
          ))}
        </div>
        <div className="col-span-2 sm:col-span-1">
          <StationPicker label="From" value={query.origin} onChange={(origin) => setQuery({ ...query, origin })} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <StationPicker label="To" value={query.destination} onChange={(destination) => setQuery({ ...query, destination })} />
        </div>
        <Field label={trip === "return" ? "Out: first day" : "First day"}>
          <input type="date" className={INPUT} {...bind("dateFrom")} />
        </Field>
        <Field label={trip === "return" ? "Out: last day" : "Last day"}>
          <input type="date" className={INPUT} {...bind("dateTo")} />
        </Field>
        <Field label={`Cheapest ↔ Reliable (${query.priority})`}>
          <input type="range" min={0} max={1} step={0.1} value={query.priority} onChange={(e) => setQuery({ ...query, priority: Number(e.target.value) })} />
        </Field>
        <button disabled={loading} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {loading ? "Searching…" : "Search"}
        </button>
        {trip === "return" && (
          <>
            <div className="sm:col-start-3">
              <Field label="Back: first day">
                <input type="date" className={INPUT} min={query.dateFrom} value={returnDates.from} onChange={(e) => setReturnDates({ ...returnDates, from: e.target.value })} />
              </Field>
            </div>
            <Field label="Back: last day">
              <input type="date" className={INPUT} min={returnDates.from} value={returnDates.to} onChange={(e) => setReturnDates({ ...returnDates, to: e.target.value })} />
            </Field>
          </>
        )}
      </form>

      {error && <p className="mb-6 rounded-lg bg-rose-50 p-4 text-rose-800">{error}</p>}
      {!result && loading && <Skeleton />}
      {result && (
        <div className={loading ? "opacity-60 transition-opacity" : ""} aria-busy={loading}>
          <Results outbound={result.outbound} inbound={result.inbound} railcardId={railcard} onRailcard={setRailcard} />
        </div>
      )}
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

/** Placeholder shapes while the first answer loads. */
function Skeleton() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label="Loading trains">
      <div className="h-12 rounded-lg bg-slate-200" />
      <div className="h-48 rounded-2xl bg-slate-200" />
      <div className="h-40 rounded-2xl bg-slate-200" />
      <div className="h-64 rounded-2xl bg-slate-200" />
    </div>
  );
}
