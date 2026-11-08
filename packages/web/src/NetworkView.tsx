import { operatorName, type DisruptionAlert, type NetworkResponse, type RouteRef } from "@tot/shared";
import { REASON_ICON } from "./reasons";
import { SourcesPanel } from "./SourcesPanel";
import { useStationName } from "./stations";
import { MitigationCard, RiskBadge, Stat, Warnings, at, dateLabel, pounds } from "./ui";

interface Props {
  data: NetworkResponse;
  /** Open one route direction on the risk board. */
  onOpenRoute: (route: RouteRef) => void;
}

/** Every world signal that adds Delay Repay cost across the network, biggest first, plus routes ranked by exposure. */
export function NetworkView({ data, onOpenRoute }: Props) {
  const { totals, alerts, routes, query } = data;
  return (
    <section className="space-y-6">
      <Warnings warnings={data.warnings} />
      <h2 className="text-lg font-bold">
        Network outlook <span className="font-medium text-slate-500">· {dateLabel(query.dateFrom)}{query.dateTo !== query.dateFrom ? ` – ${dateLabel(query.dateTo)}` : ""}</span>
      </h2>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expected Delay Repay" value={pounds(totals.expectedCostPence)} tone="bad" note={`${totals.services} services on ${routes.length} route directions`} />
        <Stat label="Added by world signals" value={pounds(Math.max(0, totals.expectedCostPence - totals.baselineCostPence))} note={`${alerts.length} disruption alert${alerts.length === 1 ? "" : "s"}`} />
        <Stat label="High-risk services" value={`${totals.highRiskServices}`} note={`of ${totals.services}`} />
        <Stat label="Avoidable with actions" value={pounds(totals.mitigationSavingPence)} tone="good" note={`for ${pounds(totals.mitigationCostPence)} spent`} />
      </div>

      <div>
        <h3 className="mb-3 text-base font-bold">Disruption alerts</h3>
        {alerts.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">No world signals add compensation risk in this window.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {alerts.map((a) => (
              <AlertCard key={a.id} alert={a} onOpenRoute={onOpenRoute} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-base font-bold">Routes by exposure</h3>
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="p-3">Route</th>
                <th className="p-3">Services</th>
                <th className="p-3">High risk</th>
                <th className="p-3">Expected payout</th>
                <th className="p-3">Avoidable</th>
                <th className="p-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={`${r.origin}-${r.destination}`} className="border-t border-slate-100">
                  <td className="p-3">
                    <RouteLabel route={r} />
                    <span className="block text-xs text-slate-500">{operatorName(r.operator)}</span>
                  </td>
                  <td className="p-3">{r.services}</td>
                  <td className="p-3">{r.highRiskServices}</td>
                  <td className="p-3 font-semibold">{pounds(r.expectedCostPence)}</td>
                  <td className="p-3 text-emerald-700">{pounds(r.mitigationSavingPence)}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => onOpenRoute(r)} className="text-xs font-semibold text-slate-700 underline">
                      Risk board →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SourcesPanel sources={data.sources} />
      <p className="text-xs text-slate-500">contract v{data.contractVersion} · passenger loads, claim rate and action costs are modelled (sample)</p>
    </section>
  );
}

function AlertCard({ alert, onOpenRoute }: { alert: DisruptionAlert; onOpenRoute: (route: RouteRef) => void }) {
  const s = alert.signal;
  return (
    <article className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            <span aria-hidden>{REASON_ICON[s.kind]} </span>
            {s.title}
          </p>
          <p className="text-xs text-slate-500">
            {at(s.start)} – {at(s.end)}
            {s.confidence < 0.6 ? " · low confidence" : ""}
          </p>
          {s.detail && <p className="mt-1 text-xs text-slate-600">{s.detail}</p>}
        </div>
        <RiskBadge level={alert.riskLevel} />
      </div>
      <p className="text-sm">
        <span className="text-xl font-bold text-rose-700">+{pounds(alert.expectedCostPence)}</span> expected Delay Repay across {alert.affectedServices} service{alert.affectedServices === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap gap-2">
        {alert.routes.map((r) => (
          <button key={`${r.origin}-${r.destination}`} type="button" onClick={() => onOpenRoute(r)} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
            <RouteLabel route={r} />
          </button>
        ))}
      </div>
      {alert.action ? <MitigationCard m={alert.action} /> : <p className="text-xs text-slate-500">No pre-emptive action costs less than the compensation it would avoid.</p>}
    </article>
  );
}

function RouteLabel({ route }: { route: RouteRef }) {
  return (
    <>
      {useStationName(route.origin)} → {useStationName(route.destination)}
    </>
  );
}
