import { Fragment, useMemo, useState } from "react";
import { DELAY_BANDS, operatorName, type DelayForecast, type OperationsResponse, type ServiceRisk } from "@tot/shared";
import { ExposureHeatmap, cellKey } from "./ExposureHeatmap";
import { ReasonChip } from "./reasons";
import { SourcesPanel } from "./SourcesPanel";
import { useStationName } from "./stations";
import { MitigationCard, RISK_RANK, RiskBadge, Stat, Warnings, at, hhmm, percent, pounds } from "./ui";

const PAGE_SIZE = 10;

type SortKey = "departs" | "risk" | "cost" | "net";
type Dir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; firstDir: Dir }[] = [
  { key: "departs", label: "Departs", firstDir: "asc" },
  { key: "risk", label: "Risk", firstDir: "desc" },
  { key: "cost", label: "Expected payout", firstDir: "desc" },
  { key: "net", label: "Best action", firstDir: "desc" },
];

const disrupted = (s: ServiceRisk) => 1 - s.delay.onTimeProb;
const departMs = (s: ServiceRisk) => Date.parse(s.journey.departAt);
const sortValue = (s: ServiceRisk, key: SortKey) =>
  key === "departs" ? departMs(s) : key === "risk" ? RISK_RANK[s.riskLevel] * 10 + disrupted(s) : key === "cost" ? s.compensation.expectedCostPence : (s.mitigations[0]?.netPence ?? 0);

export function RouteBoard({ data }: { data: OperationsResponse }) {
  const { totals, services } = data;
  const [cell, setCell] = useState<string | null>(null);
  const cellIds = useMemo(() => {
    const found = data.heatmap.find((c) => cellKey(c) === cell);
    return found ? new Set(found.serviceIds) : null;
  }, [data.heatmap, cell]);
  const visible = cellIds ? services.filter((s) => cellIds.has(s.journey.id)) : services;
  const extra = Math.max(0, totals.expectedCostPence - totals.baselineCostPence);

  return (
    <section className="space-y-6">
      <Warnings warnings={data.warnings} />

      <h2 className="text-lg font-bold">
        <RouteName origin={data.query.origin} destination={data.query.destination} />
        {services[0] && <span className="font-medium text-slate-500"> · {operatorName(services[0].journey.operator)}</span>}
      </h2>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expected Delay Repay" value={pounds(totals.expectedCostPence)} tone="bad" note={`${totals.services} services in the window`} />
        <Stat label="Added by world signals" value={pounds(extra)} note={`on top of ${pounds(totals.baselineCostPence)} from punctuality history`} />
        <Stat label="High-risk services" value={`${totals.highRiskServices}`} note={`of ${totals.services}: 30%+ chance of a 15-minute delay or cancellation`} />
        <Stat
          label="Avoidable with actions"
          value={pounds(totals.mitigationSavingPence)}
          tone="good"
          note={`for ${pounds(totals.mitigationCostPence)} spent: net +${pounds(totals.mitigationSavingPence - totals.mitigationCostPence)}`}
        />
      </div>

      {data.heatmap.length > 0 && services.length > 0 && <ExposureHeatmap cells={data.heatmap} selected={cell} onSelect={setCell} />}
      {cell && (
        <p className="text-sm text-slate-600">
          Showing one hour.{" "}
          <button type="button" onClick={() => setCell(null)} className="font-semibold text-slate-900 underline">
            Show all services
          </button>
        </p>
      )}
      <ServiceTable services={visible} empty={cell ? "No services in that hour." : "No services found for these dates."} />

      <SourcesPanel sources={data.sources} />
      <p className="text-xs text-slate-500">
        contract v{data.contractVersion} · Delay Repay 15 bands · passenger loads, claim rate and action costs are modelled (sample)
      </p>
    </section>
  );
}

function RouteName({ origin, destination }: { origin: string; destination: string }) {
  return (
    <>
      {useStationName(origin)} → {useStationName(destination)}
    </>
  );
}

function ServiceTable({ services, empty }: { services: ServiceRisk[]; empty: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "cost", dir: "desc" });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(0);
  const [prevServices, setPrevServices] = useState(services);
  if (services !== prevServices) {
    setPrevServices(services);
    setPage(0);
  }

  const sorted = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...services].sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * sign || departMs(a) - departMs(b));
  }, [services, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey, firstDir: Dir) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir }));
    setPage(0);
  }
  function toggleOpen(id: string) {
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  if (services.length === 0) return <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">{empty}</p>;

  return (
    <div className="rounded-2xl bg-white shadow-sm">
      <div className="overflow-x-auto rounded-t-2xl">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              {COLUMNS.slice(0, 3).map((c) => (
                <SortHeader key={c.key} label={c.label} active={sort.key === c.key ? sort.dir : null} onClick={() => toggleSort(c.key, c.firstDir)} />
              ))}
              <th scope="col" className="p-3">
                Main driver
              </th>
              <SortHeader label={COLUMNS[3]!.label} active={sort.key === "net" ? sort.dir : null} onClick={() => toggleSort("net", "desc")} />
              <th scope="col" className="p-3">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((s) => {
              const id = s.journey.id;
              const expanded = open.has(id);
              const driver = s.reasons.find((r) => r.effect === "bad");
              const action = s.mitigations[0];
              return (
                <Fragment key={id}>
                  <tr className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap p-3">
                      <span className="font-medium">{at(s.journey.departAt)}</span>
                      <span className="block text-xs text-slate-500">arr {hhmm(s.journey.arriveAt)} · ~{s.compensation.passengers} on board</span>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <RiskBadge level={s.riskLevel} />
                      <span className="block pt-1 text-xs text-slate-500">{percent(disrupted(s))} late 15+ or cancelled</span>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <span className="font-semibold">{pounds(s.compensation.expectedCostPence)}</span>
                      <span className="block text-xs text-slate-500">baseline {pounds(s.compensation.baselineCostPence)}</span>
                    </td>
                    <td className="p-3">{driver ? <ReasonChip reason={driver} /> : <span className="text-xs text-slate-400">nothing unusual</span>}</td>
                    <td className="p-3">
                      {action ? (
                        <span className="text-xs">
                          <span className="font-semibold text-emerald-800">{action.title}</span>
                          <span className="block text-emerald-700">net +{pounds(action.netPence)}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">none pays off</span>
                      )}
                    </td>
                    <td className="p-3">
                      <button type="button" aria-expanded={expanded} onClick={() => toggleOpen(id)} className="text-xs font-semibold text-slate-600 underline">
                        {expanded ? "hide" : "details"}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-3 pb-4 pt-2">
                        <ServiceDetail s={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE_SIZE && (
        <nav aria-label="Service pages" className="flex items-center justify-between gap-2 border-t border-slate-100 p-3 text-sm text-slate-600">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className={PAGER}>
            ← Previous
          </button>
          <span>
            Showing {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, sorted.length)} of {sorted.length} services
          </span>
          <button type="button" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} className={PAGER}>
            Next →
          </button>
        </nav>
      )}
    </div>
  );
}

const PAGER = "rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40";

function ServiceDetail({ s }: { s: ServiceRisk }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delay forecast</h4>
        <DelayBars delay={s.delay} />
        <p className="mt-2 text-xs text-slate-600">
          ~{s.compensation.expectedClaims} claims expected · average fare {pounds(s.compensation.avgFarePence)} · {percent(s.compensation.claimRate)} of eligible passengers claim (sample)
        </p>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">What drives it</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          {s.reasons.length ? s.reasons.map((r) => <ReasonChip key={r.text} reason={r} />) : <span className="text-xs text-slate-500">Nothing beyond normal running.</span>}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pre-emptive actions</h4>
        <div className="mt-2 space-y-2 text-sm">
          {s.mitigations.length ? s.mitigations.map((m) => <MitigationCard key={`${m.kind}|${m.signalId ?? ""}`} m={m} />) : <p className="text-xs text-slate-500">No action costs less than the compensation it would avoid.</p>}
        </div>
      </div>
    </div>
  );
}

const BAND_LABEL: Record<(typeof DELAY_BANDS)[number], string> = { "15_29": "15–29 min (25%)", "30_59": "30–59 min (50%)", "60_119": "60–119 min (100%)", "120_plus": "120+ min (return)" };

/** The Delay Repay bands as horizontal bars, with on-time and cancelled for scale. */
function DelayBars({ delay }: { delay: DelayForecast }) {
  const rows: [string, number, string][] = [
    ["On time (under 15)", delay.onTimeProb, "bg-emerald-400"],
    ...DELAY_BANDS.map((b): [string, number, string] => [BAND_LABEL[b], delay.bands[b], "bg-amber-400"]),
    ["Cancelled", delay.cancelProb, "bg-rose-400"],
  ];
  return (
    <dl className="mt-2 space-y-1 text-xs">
      {rows.map(([label, p, color]) => (
        <div key={label} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2">
          <dt className="text-slate-600">{label}</dt>
          <dd className="h-2 rounded-full bg-slate-200">
            <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.max(p > 0 ? 2 : 0, p * 100)}%` }} />
          </dd>
          <dd className="text-right tabular-nums text-slate-700">{(p * 100).toFixed(p < 0.1 ? 1 : 0)}%</dd>
        </div>
      ))}
    </dl>
  );
}

function SortHeader({ label, active, onClick }: { label: string; active: Dir | null; onClick: () => void }) {
  return (
    <th scope="col" aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"} className="p-3">
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900">
        {label}
        <span aria-hidden className={active ? "text-slate-900" : "text-slate-300"}>
          {active === "asc" ? "▲" : active === "desc" ? "▼" : "↕"}
        </span>
      </button>
    </th>
  );
}
