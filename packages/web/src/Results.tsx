import { Fragment, useMemo, useState, type ReactNode } from "react";
import { formatPence, operatorName, type BookingAdvice, type Reason, type RecommendationResponse, type ScoredOption } from "@tot/shared";
import { Heatmap, cellKey } from "./Heatmap";
import { ReasonChip } from "./reasons";
import { RAILCARDS, priceWithRailcard, type PricedFare, type Railcard } from "./railcards";
import { SourcesPanel } from "./SourcesPanel";
import { Sparkline } from "./Sparkline";
import { useStationName } from "./stations";
import { trainlineLink, trainlineReturnLink, trainlineRouteLink, type BookingLink } from "./trainline";
import { catchableAfter, legRows, noDataForRoute, pickBest, tripTotals, type Row } from "./trip";

const VERDICT_STYLE: Record<ScoredOption["verdict"], string> = {
  best: "bg-emerald-600 text-white",
  great: "bg-emerald-100 text-emerald-900",
  good: "bg-sky-100 text-sky-900",
  risky: "bg-amber-100 text-amber-900",
  avoid: "bg-rose-100 text-rose-900",
};

const dayTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const percent = (p: number) => `${Math.round(p * 100)}%`;
const at = (iso: string) => dayTime.format(new Date(iso));

type SortKey = "departs" | "price" | "reliable" | "score";
type Dir = "asc" | "desc";

/** Sortable columns; firstDir is the direction a first click sorts in. */
const COLUMNS: { key: SortKey; label: string; firstDir: Dir }[] = [
  { key: "departs", label: "Departs", firstDir: "asc" },
  { key: "price", label: "Price", firstDir: "asc" },
  { key: "reliable", label: "Reliable", firstDir: "desc" },
  { key: "score", label: "Score", firstDir: "desc" },
];

const departMs = (r: Row) => Date.parse(r.option.journey.departAt);
const sortValue = (r: Row, key: SortKey) =>
  key === "departs" ? departMs(r) : key === "price" ? r.price.pricePence : key === "reliable" ? r.option.reliability : r.option.score;

// The engine's price reasons quote normal fares, which would contradict a railcard price on screen.
const reasonsFor = (o: ScoredOption, card: Railcard | null): Reason[] => (card ? o.reasons.filter((r) => !r.text.includes("£")) : o.reasons);

type RowAction = { kind: "book" } | { kind: "select"; selectedId: string | undefined; onSelect: (id: string) => void };

interface Props {
  outbound: RecommendationResponse;
  /** Present for a return trip: the same search run the other way, for the return dates. */
  inbound: RecommendationResponse | null;
  railcardId: string;
  onRailcard: (id: string) => void;
}

export function Results({ outbound, inbound, railcardId, onRailcard }: Props) {
  const [pickedOut, setPickedOut] = useState<string>();
  const [pickedBack, setPickedBack] = useState<string>();
  const card = RAILCARDS.find((c) => c.id === railcardId) ?? null;
  const isReturn = inbound !== null;

  const outRows = useMemo(() => legRows(outbound, card), [outbound, card]);
  const backRows = useMemo(() => (inbound ? legRows(inbound, card) : []), [inbound, card]);
  const routeMissing = noDataForRoute(outbound) || (inbound !== null && noDataForRoute(inbound));

  const chosenOut = outRows.find((r) => r.option.journey.id === pickedOut) ?? pickBest(outRows);
  const catchable = useMemo(() => catchableAfter(backRows, chosenOut?.option.journey.arriveAt), [backRows, chosenOut]);
  const chosenBack = catchable.find((r) => r.option.journey.id === pickedBack) ?? pickBest(catchable);

  const warnings = [...new Set([...outbound.warnings, ...(inbound?.warnings ?? [])])];
  const advice = outbound.bookingAdvice?.journeyId === chosenOut?.option.journey.id ? outbound.bookingAdvice : null;

  return (
    <section className="space-y-6">
      {warnings.length > 0 && (
        <ul className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          {warnings.map((w) => (
            <li key={w}>⚠️ {w}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white px-4 py-3 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          Railcard
          <select value={railcardId} onChange={(e) => onRailcard(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">
            <option value="">None</option>
            {RAILCARDS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">
          {card ? `${card.note} Estimates: minimum-fare rules and bank holidays aren't modelled.` : "Pick a railcard to see prices with its discount."}
        </p>
      </div>

      {routeMissing ? (
        <NoRouteData outbound={outbound} inbound={inbound} />
      ) : isReturn ? (
        <>
          <TripSummary outward={chosenOut} back={chosenBack} card={card} advice={advice} />
          <LegSection
            key={`out-${outbound.generatedAt}`}
            title="1 · Choose your outbound train"
            route={outbound.query}
            response={outbound}
            rows={outRows}
            shown={outRows}
            card={card}
            action={{ kind: "select", selectedId: chosenOut?.option.journey.id, onSelect: setPickedOut }}
            empty="No outbound trains found for these dates."
          />
          <LegSection
            key={`back-${inbound.generatedAt}`}
            title="2 · Choose your return train"
            route={inbound.query}
            note="Only trains that leave after your outbound train arrives."
            response={inbound}
            rows={backRows}
            shown={catchable}
            card={card}
            action={{ kind: "select", selectedId: chosenBack?.option.journey.id, onSelect: setPickedBack }}
            empty="No return trains found after you arrive. Try later return dates."
          />
        </>
      ) : (
        <>
          {outbound.best && <BestPick best={outbound.best} card={card} advice={outbound.bookingAdvice} />}
          <LegSection key={`out-${outbound.generatedAt}`} response={outbound} rows={outRows} shown={outRows} card={card} action={{ kind: "book" }} empty="No trains found for these dates." />
        </>
      )}

      <SourcesPanel sources={outbound.sources} />
      <p className="text-xs text-slate-500">
        contract v{outbound.contractVersion} · we don't sell tickets: the Book links open Trainline
      </p>
    </section>
  );
}

function RouteName({ origin, destination }: { origin: string; destination: string }) {
  const from = useStationName(origin);
  const to = useStationName(destination);
  return (
    <>
      {from} → {to}
    </>
  );
}

/** One direction of travel: its heatmap, then its table, filtered to a time slot when one is clicked. */
function LegSection(props: {
  title?: string;
  route?: { origin: string; destination: string };
  note?: string;
  response: RecommendationResponse;
  /** Every departure for this direction (priced), for the heatmap. */
  rows: Row[];
  /** The departures the table may show (for a return: only those after the outbound arrives). */
  shown: Row[];
  card: Railcard | null;
  action: RowAction;
  empty: string;
}) {
  const { title, route, note, response, rows, shown, card, action, empty } = props;
  const [cell, setCell] = useState<string | null>(null);
  const priceById = useMemo(() => new Map(rows.map((r) => [r.option.journey.id, r.price.pricePence])), [rows]);
  const cellIds = useMemo(() => {
    const found = response.heatmap.find((c) => cellKey(c) === cell);
    return found ? new Set(found.optionIds) : null;
  }, [response.heatmap, cell]);
  const visible = cellIds ? shown.filter((r) => cellIds.has(r.option.journey.id)) : shown;

  return (
    <div className="space-y-3">
      {title && route && (
        <h2 className="text-lg font-bold">
          {title}{" "}
          <span className="font-medium text-slate-500">
            <RouteName {...route} />
          </span>
        </h2>
      )}
      {note && <p className="text-sm text-slate-600">{note}</p>}
      {rows.length > 0 && response.heatmap.length > 0 && <Heatmap cells={response.heatmap} selected={cell} onSelect={setCell} priceOf={(id) => priceById.get(id)} />}
      {cell && (
        <p className="text-sm text-slate-600">
          Showing one time slot.{" "}
          <button type="button" onClick={() => setCell(null)} className="font-semibold text-slate-900 underline">
            Show all trains
          </button>
        </p>
      )}
      <LegTable rows={visible} card={card} action={action} empty={cell ? "No trains in that slot." : empty} />
    </div>
  );
}

/** The API answered, but with trains for some other route: we have no data for what was asked, so say so instead of showing them. */
function NoRouteData({ outbound, inbound }: { outbound: RecommendationResponse; inbound: RecommendationResponse | null }) {
  const { origin, destination, dateFrom, earliest } = outbound.query;
  const link = trainlineRouteLink({ origin, destination, date: dateFrom, time: earliest }, inbound ? { date: inbound.query.dateFrom, time: inbound.query.earliest } : undefined);
  return (
    <article className="rounded-2xl border-2 border-amber-400 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">
        No train data for <RouteName origin={origin} destination={destination} /> yet
      </h2>
      <p className="mt-2 text-slate-700">
        We don't have timetable, fare or punctuality data for this route yet, so we can't score trains or prices for it. You can still look the journey up on Trainline.
      </p>
      <BookLink link={link} className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-700">
        {inbound ? "Search the return on Trainline ↗" : "Search this journey on Trainline ↗"}
      </BookLink>
    </article>
  );
}

function BestPick({ best, card, advice }: { best: ScoredOption; card: Railcard | null; advice: BookingAdvice | null }) {
  const price = priceWithRailcard(best.journey, card);
  return (
    <article className="rounded-2xl border-2 border-emerald-600 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Best pick</p>
      <h2 className="mt-1 text-2xl font-bold">
        {at(best.journey.departAt)} → {clock.format(new Date(best.journey.arriveAt))}
      </h2>
      <p className="text-slate-600">
        {operatorName(best.journey.operator)} · <Price price={price} card={card} /> {price.ticketType.replaceAll("_", " ")} · {percent(best.reliability)} reliable · score {best.score}
      </p>
      {price.applied && card && (
        <p className="text-sm font-medium text-emerald-700">
          {card.name} saves you {formatPence(price.fullPence - price.pricePence)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {reasonsFor(best, card)
          .slice(0, 4)
          .map((r) => (
            <ReasonChip key={r.text} reason={r} />
          ))}
      </div>
      {advice && <Advice advice={advice} card={card} />}
      <BookLink link={trainlineLink(best.journey)} className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
        Book on Trainline ↗
      </BookLink>
    </article>
  );
}

function Advice({ advice, card }: { advice: BookingAdvice; card: Railcard | null }) {
  return (
    <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-emerald-900">
      <p className="font-medium">
        💷 {advice.headline}
        {card && <span className="font-normal text-emerald-800"> (prices before railcard)</span>}
      </p>
      <Sparkline curve={advice.curve} bookingDate={advice.curve.bookingDate} />
    </div>
  );
}

function TripSummary({ outward, back, card, advice }: { outward: Row | undefined; back: Row | undefined; card: Railcard | null; advice: BookingAdvice | null }) {
  if (!outward) return null;
  const totals = back ? tripTotals(outward, back) : null;
  return (
    <article className="rounded-2xl border-2 border-emerald-600 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Your return trip</p>
      <LegLine label="Outbound" row={outward} card={card} />
      {back ? (
        <LegLine label="Return" row={back} card={card} />
      ) : (
        <p className="mt-2 text-sm text-amber-800">No return train leaves after you arrive within the return dates you chose. Try later return dates.</p>
      )}
      {totals && back && (
        <>
          <p className="mt-4 text-2xl font-bold">
            Total{" "}
            {totals.applied ? (
              <>
                <span className="text-emerald-700">{formatPence(totals.pricePence)}</span> <s className="text-base font-normal text-slate-400">{formatPence(totals.fullPence)}</s>
              </>
            ) : (
              formatPence(totals.pricePence)
            )}
          </p>
          {totals.applied && card && <p className="text-sm font-medium text-emerald-700">{card.name} saves you {formatPence(totals.fullPence - totals.pricePence)}</p>}
          <p className="text-sm text-slate-600">
            {percent(totals.reliability)} chance both trains run without significant disruption. Priced as two single fares: a return ticket can cost less, and Trainline will show
            it.
          </p>
          {advice && <Advice advice={advice} card={card} />}
          <BookLink
            link={trainlineReturnLink(outward.option.journey, back.option.journey)}
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
          >
            Book return on Trainline ↗
          </BookLink>
        </>
      )}
    </article>
  );
}

function LegLine({ label, row, card }: { label: string; row: Row; card: Railcard | null }) {
  const { journey, reliability } = row.option;
  return (
    <p className="mt-2 text-slate-700">
      <span className="inline-block w-20 font-semibold">{label}</span>
      {at(journey.departAt)} → {clock.format(new Date(journey.arriveAt))} · {operatorName(journey.operator)} · <Price price={row.price} card={card} /> · {percent(reliability)} reliable
    </p>
  );
}

function LegTable({ rows, card, action, empty }: { rows: Row[]; card: Railcard | null; action: RowAction; empty: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "departs", dir: "asc" });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const sorted = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * sign || departMs(a) - departMs(b));
  }, [rows, sort]);

  function toggleSort(key: SortKey, firstDir: Dir) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir }));
  }
  function toggleOpen(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  if (rows.length === 0) return <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">{empty}</p>;

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="w-full min-w-[46rem] text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            {COLUMNS.map((c) => (
              <SortHeader key={c.key} label={c.label} active={sort.key === c.key ? sort.dir : null} onClick={() => toggleSort(c.key, c.firstDir)} />
            ))}
            <th scope="col" className="p-3">
              Main reason
            </th>
            <th scope="col" className="p-3">
              {action.kind === "book" ? "Book" : "Choose"}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const { option: o, price } = row;
            const selected = action.kind === "select" && action.selectedId === o.journey.id;
            const reasons = reasonsFor(o, card);
            const expanded = open.has(o.journey.id);
            return (
              <Fragment key={o.journey.id}>
                <tr className={`border-t border-slate-100 ${selected ? "bg-emerald-50" : ""}`}>
                  <td className="whitespace-nowrap p-3">{at(o.journey.departAt)}</td>
                  <td className="whitespace-nowrap p-3">
                    <Price price={price} card={card} />
                  </td>
                  <td className="p-3">{percent(o.reliability)}</td>
                  <td className="p-3">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLE[o.verdict]}`}>
                      {o.score} {o.verdict}
                    </span>
                  </td>
                  <td className="p-3">
                    {reasons[0] && <ReasonChip reason={reasons[0]} />}
                    {reasons.length > 1 && (
                      <button type="button" aria-expanded={expanded} onClick={() => toggleOpen(o.journey.id)} className="ml-2 text-xs font-semibold text-slate-600 underline">
                        {expanded ? "hide" : `+${reasons.length - 1} more`}
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {action.kind === "book" ? (
                      <BookLink link={trainlineLink(o.journey)} className="font-semibold text-emerald-700 hover:underline">
                        Book ↗
                      </BookLink>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => action.onSelect(o.journey.id)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold ${selected ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`}
                      >
                        {selected ? "✓ Selected" : "Select"}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="px-3 pb-3 pt-1">
                      <div className="flex flex-wrap gap-2">
                        {reasons.map((r) => (
                          <ReasonChip key={r.text} reason={r} />
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
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

function Price({ price, card }: { price: PricedFare; card: Railcard | null }) {
  if (price.applied) {
    return (
      <>
        <span className="font-semibold text-emerald-700">{formatPence(price.pricePence)}</span> <s className="text-xs text-slate-400">{formatPence(price.fullPence)}</s>
      </>
    );
  }
  return (
    <>
      {formatPence(price.pricePence)}
      {price.blocked && card && (
        <span className="ml-1 text-xs text-amber-700" title={`${card.name} isn't valid on this train. ${card.note}`}>
          card n/a
        </span>
      )}
    </>
  );
}

function BookLink({ link, className, children }: { link: BookingLink; className: string; children: ReactNode }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.prefilled ? "Opens Trainline with this route and time filled in" : "Opens Trainline: search for this journey there"}
      className={className}
    >
      {children}
    </a>
  );
}
