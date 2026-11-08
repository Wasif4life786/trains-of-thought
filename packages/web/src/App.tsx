import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { MAX_NETWORK_DAYS, type InputsResponse, type NetworkResponse, type OperationsResponse, type RouteRef } from "@tot/shared";
import { api, usingFixtures } from "./api";
import { InputsView } from "./InputsView";
import { NetworkView } from "./NetworkView";
import { RouteBoard } from "./RouteBoard";
import { StationPicker } from "./StationPicker";
import { networkQuery, readState, writeState, type FormState, type View } from "./url";

// A4 (Platform) owns this package: redesign freely (contract.md §6.4).

const INPUT = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

type Result = { view: "route"; data: OperationsResponse } | { view: "network"; data: NetworkResponse } | { view: "inputs"; data: InputsResponse };

async function fetchView(s: FormState): Promise<Result> {
  if (s.view === "route") return { view: "route", data: await api.operations(s.query) };
  if (s.view === "network") return { view: "network", data: await api.network(networkQuery(s.query)) };
  return { view: "inputs", data: await api.inputs(networkQuery(s.query)) };
}

export function App() {
  // The form starts from the address bar, so a shared link reproduces the view.
  const [initial] = useState(() => readState(window.location.search));
  const [state, setState] = useState<FormState>(initial);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { view, query } = state;

  async function load(s: FormState) {
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchView(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(initial);
  }, [initial]);

  // Keep the address bar in step with the form (without piling up history entries).
  useEffect(() => {
    window.history.replaceState(null, "", `?${writeState(state)}`);
  }, [state]);

  function switchView(next: View) {
    const s = { ...state, view: next };
    setState(s);
    void load(s);
  }

  function openRoute(route: RouteRef) {
    const s: FormState = { view: "route", query: { ...query, origin: route.origin, destination: route.destination } };
    setState(s);
    void load(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const bind = (key: "dateFrom" | "dateTo") => ({
    value: query[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setState({ ...state, query: { ...query, [key]: e.target.value } }),
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-slate-900">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">🚆 Trains of Thought · Operations</h1>
        <p className="text-slate-600">See the delays coming, price the Delay Repay they'll cost, and act before they happen.</p>
        {usingFixtures && <p className="mt-2 text-sm text-amber-700">Fixture mode: answers come from @tot/shared/fixtures, not the API.</p>}
      </header>

      <div role="tablist" aria-label="View" className="mb-4 inline-flex rounded-lg bg-slate-200 p-1 text-sm font-semibold">
        {(
          [
            ["route", "Route risk board"],
            ["network", "Network alerts"],
            ["inputs", "✨ Data inputs"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => switchView(v)}
            className={`rounded-md px-4 py-1.5 ${view === v ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(state);
        }}
        className="mb-8 grid grid-cols-2 items-end gap-3 sm:grid-cols-5"
      >
        {view === "route" && (
          <>
            <div className="col-span-2 sm:col-span-1">
              <StationPicker label="From" value={query.origin} onChange={(origin) => setState({ ...state, query: { ...query, origin } })} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <StationPicker label="To" value={query.destination} onChange={(destination) => setState({ ...state, query: { ...query, destination } })} />
            </div>
          </>
        )}
        <Field label="First day">
          <input type="date" className={INPUT} {...bind("dateFrom")} />
        </Field>
        <Field label="Last day">
          <input type="date" className={INPUT} min={query.dateFrom} {...bind("dateTo")} />
        </Field>
        <button disabled={loading} className="col-span-2 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-1">
          {loading ? "Forecasting…" : "Forecast"}
        </button>
        {view !== "route" && <p className="col-span-2 self-center text-xs text-slate-500 sm:col-span-2">Sweeps every route; at most {MAX_NETWORK_DAYS} days from the first day.</p>}
      </form>

      {error && <p className="mb-6 rounded-lg bg-rose-50 p-4 text-rose-800">{error}</p>}
      {!result && loading && <Skeleton />}
      {result && (
        <div className={loading ? "opacity-60 transition-opacity" : ""} aria-busy={loading}>
          {result.view === "route" ? (
            <RouteBoard key={result.data.generatedAt + result.data.query.origin + result.data.query.destination} data={result.data} />
          ) : result.view === "network" ? (
            <NetworkView data={result.data} onOpenRoute={openRoute} />
          ) : (
            <InputsView key={result.data.generatedAt + result.data.query.dateFrom + result.data.query.dateTo} data={result.data} />
          )}
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
    <div className="animate-pulse space-y-6" role="status" aria-label="Loading forecast">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-200" />
        ))}
      </div>
      <div className="h-48 rounded-2xl bg-slate-200" />
      <div className="h-64 rounded-2xl bg-slate-200" />
    </div>
  );
}
