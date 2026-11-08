import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { SIGNAL_KINDS, addMinutes, operatorName, type InputsResponse, type SignalImpact, type SignalKind, type Station } from "@tot/shared";
import { exposureColor } from "./ExposureHeatmap";
import { KIND_COLOR, KIND_LABEL, MAP_HEIGHT, MAP_WIDTH, outlinePath, project } from "./geo";
import { REASON_ICON } from "./reasons";
import { SourcesPanel } from "./SourcesPanel";
import { Warnings, at, percent, pounds } from "./ui";

const hourLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayShort = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric" });
const HOUR_MS = 3_600_000;
const PLAY_MS = 260;

/** Is the signal's impact window open during the hour starting at `iso`? */
const activeAt = (s: SignalImpact, iso: string) => s.signal.start < addMinutes(iso, 60) && s.signal.end > iso;

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * The data behind the forecast, played back hour by hour: rail corridors heat up with expected Delay Repay while the
 * world signals that drive it pulse on the map, swim along the timeline, and add up in the £ curve underneath.
 */
export function InputsView({ data }: { data: InputsResponse }) {
  const { timeline, signals, corridors } = data;
  // Open on the hour where world signals add the most: the moment worth showing first.
  const hottest = timeline.reduce((best, p, i) => (p.expectedCostPence - p.baselineCostPence > timeline[best]!.expectedCostPence - timeline[best]!.baselineCostPence ? i : best), 0);
  const [index, setIndex] = useState(hottest);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const hour = timeline[Math.min(index, timeline.length - 1)];

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= timeline.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, PLAY_MS);
    return () => clearInterval(timer);
  }, [playing, timeline.length]);

  const active = useMemo(() => (hour ? signals.filter((s) => activeAt(s, hour.at)) : []), [signals, hour]);
  const runningTotal = useMemo(() => timeline.slice(0, index + 1).reduce((n, p) => n + p.expectedCostPence, 0), [timeline, index]);
  const total = timeline.reduce((n, p) => n + p.expectedCostPence, 0);
  const fromSignals = signals.reduce((n, s) => n + s.expectedCostPence, 0);

  if (!hour || corridors.length === 0) {
    return (
      <section className="space-y-6">
        <Warnings warnings={data.warnings} />
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">No corridors or signals to show for these dates.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <Warnings warnings={data.warnings} />
      <Pipeline data={data} fromSignals={fromSignals} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div className="rounded-2xl bg-slate-900 p-3 shadow-sm">
          <NetworkMap data={data} hourIndex={index} active={active} focus={focus} onFocus={setFocus} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Now playing</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{hourLabel.format(new Date(hour.at))}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500">Expected payout, trains leaving this hour</p>
                <p className="text-xl font-bold tabular-nums text-rose-700">{pounds(hour.expectedCostPence)}</p>
                <p className="text-xs text-slate-500">
                  {hour.services} services · history alone {pounds(hour.baselineCostPence)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Running total</p>
                <p className="text-xl font-bold tabular-nums">{pounds(runningTotal)}</p>
                <div className="mt-1 h-1.5 rounded-full bg-slate-200">
                  <div className="h-1.5 rounded-full bg-rose-600 transition-[width]" style={{ width: `${total ? (runningTotal / total) * 100 : 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">of {pounds(total)} over the window</p>
              </div>
            </div>
            <Controls index={index} max={timeline.length - 1} playing={playing} onPlay={() => (index >= timeline.length - 1 ? (setIndex(0), setPlaying(true)) : setPlaying((p) => !p))} onSeek={(i) => (setPlaying(false), setIndex(i))} />
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signals live this hour ({active.length})</p>
            {active.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nothing unusual: punctuality history only.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {active.map((s) => (
                  <li key={s.signal.id} onMouseEnter={() => setFocus(s.signal.id)} onMouseLeave={() => setFocus(null)} className={`rounded-lg p-2 ring-1 ${focus === s.signal.id ? "bg-slate-50 ring-slate-400" : "ring-slate-200"}`}>
                    <SignalLine s={s} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Timeline data={data} index={index} focus={focus} onFocus={setFocus} onSeek={(i) => (setPlaying(false), setIndex(i))} />
      <SignalTable signals={signals} focus={focus} onFocus={setFocus} />
      <SourcesPanel sources={data.sources} />
      <p className="text-xs text-slate-500">
        contract v{data.contractVersion} · map outline is approximate · anything marked (sample) is invented for the demo · loads, claim rate and costs are modelled (sample)
      </p>
    </section>
  );
}

/** The messy-data story as one line: rows read → repaired → discarded → signals → £ they add. */
function Pipeline({ data, fromSignals }: { data: InputsResponse; fromSignals: number }) {
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const rows = data.sources.reduce((n, s) => n + s.quality.rowsIn, 0);
  const fixed = data.sources.reduce((n, s) => n + sum(s.quality.fixed), 0);
  const dropped = data.sources.reduce((n, s) => n + sum(s.quality.dropped), 0);
  const steps: [string, string, string][] = [
    [`${data.sources.length}`, "sources", "weather, fixtures, events, works, fares, timetables, punctuality"],
    [rows.toLocaleString("en-GB"), "raw rows read", "as published, untouched"],
    [fixed.toLocaleString("en-GB"), "repairs", "names, time zones, duplicates, units"],
    [dropped.toLocaleString("en-GB"), "discarded", "irrelevant, broken or merged"],
    [`${data.signals.length}`, "signals on our corridors", `${data.corridors.length} corridors · ${data.stations.length} stations`],
    [pounds(fromSignals), "Delay Repay they add", "on top of punctuality history"],
  ];
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">From messy data to £ at risk</h2>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map(([value, label, note], i) => (
          <li key={label} className="relative rounded-xl bg-slate-50 p-3">
            <p className={`text-xl font-bold tabular-nums ${i === steps.length - 1 ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
            <p className="text-xs font-semibold text-slate-700">{label}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{note}</p>
            {i < steps.length - 1 && (
              <svg aria-hidden viewBox="0 0 10 10" className="absolute -right-2.5 top-1/2 z-10 hidden h-3 w-3 -translate-y-1/2 fill-slate-400 lg:block">
                <path d="M2 1 L8 5 L2 9 Z" />
              </svg>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Controls({ index, max, playing, onPlay, onSeek }: { index: number; max: number; playing: boolean; onPlay: () => void; onSeek: (i: number) => void }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <button type="button" onClick={onPlay} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700" aria-label={playing ? "Pause" : "Play the window hour by hour"}>
        <span className="inline-flex items-center gap-2">
          <svg aria-hidden viewBox="0 0 10 10" className="h-3 w-3 fill-current">
            {playing ? (
              <path d="M1.5 1 h2.5 v8 h-2.5Z M6 1 h2.5 v8 h-2.5Z" />
            ) : (
              <path d="M2 1 L9 5 L2 9 Z" />
            )}
          </svg>
          {playing ? "Pause" : "Play"}
        </span>
      </button>
      <input type="range" min={0} max={max} value={index} onChange={(e) => onSeek(Number(e.target.value))} aria-label="Hour" className="w-full accent-rose-600" />
    </div>
  );
}

function SignalLine({ s }: { s: SignalImpact }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[s.signal.kind] }} />
      <div className="min-w-0">
        <p className="font-medium">
          <span aria-hidden>{REASON_ICON[s.signal.kind]} </span>
          {s.signal.title}
        </p>
        <p className="text-xs text-slate-500">
          {KIND_LABEL[s.signal.kind]} · severity {percent(s.signal.severity)} · confidence {percent(s.signal.confidence)} ·{" "}
          {s.expectedCostPence > 0 ? (
            <span className="font-semibold text-rose-700">+{pounds(s.expectedCostPence)} over {s.affectedServices} services</span>
          ) : (
            "adds nothing"
          )}
        </p>
      </div>
    </div>
  );
}

// ── Map ─────────────────────────────────────────────────────────────────────

/** Fit the map to the network and its signals (with room for labels), never narrower than 3:4. */
function fitView(data: InputsResponse, byCrs: Map<string, Station>) {
  const pts = [...data.stations.map((s) => project(s.lon, s.lat)), ...data.signals.flatMap((s): [number, number][] => {
    const p = signalPoint(s, byCrs);
    return p ? [p] : [];
  })];
  if (pts.length === 0) return { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let x = Math.min(...xs) - 60;
  let y = Math.min(...ys) - 50;
  let w = Math.max(...xs) - x + 170;
  let h = Math.max(...ys) - y + 50;
  if (w < h * 0.75) {
    x -= (h * 0.75 - w) / 2;
    w = h * 0.75;
  }
  return { x, y, w, h };
}

/** City-level labels for the corridor ends, skipping any that would sit on top of one already placed. */
function placeLabels(stations: Station[], ends: Set<string>, k: number): Map<string, string> {
  const placed: [number, number][] = [];
  const out = new Map<string, string>();
  const city = (name: string) => (name.startsWith("London ") ? "London" : name.replace(/ (Piccadilly|Lime Street|New Street|Temple Meads|Waverley|Central)$/, ""));
  const seen = new Set<string>();
  for (const st of [...stations].filter((s) => ends.has(s.crs)).sort((a, b) => a.crs.localeCompare(b.crs))) {
    const p = project(st.lon, st.lat);
    const label = city(st.name);
    if (seen.has(label) || placed.some((q) => Math.abs(q[0] - p[0]) < 60 * k && Math.abs(q[1] - p[1]) < 16 * k)) continue;
    seen.add(label);
    placed.push(p);
    out.set(st.crs, label);
  }
  return out;
}

/** Where to draw a signal: its own place, else the middle of the stations it touches that we can place. */
function signalPoint(s: SignalImpact, byCrs: Map<string, Station>): [number, number] | null {
  if (s.signal.place) return project(s.signal.place.lon, s.signal.place.lat);
  const known = s.signal.scope.stations.flatMap((crs) => {
    const st = byCrs.get(crs);
    return st ? [project(st.lon, st.lat)] : [];
  });
  if (known.length === 0) return s.signal.scope.nationwide ? [MAP_WIDTH / 2, MAP_HEIGHT / 2] : null;
  return [known.reduce((n, p) => n + p[0], 0) / known.length, known.reduce((n, p) => n + p[1], 0) / known.length];
}

function NetworkMap({ data, hourIndex, active, focus, onFocus }: { data: InputsResponse; hourIndex: number; active: SignalImpact[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const byCrs = useMemo(() => new Map(data.stations.map((s) => [s.crs, s])), [data.stations]);
  const maxHour = useMemo(() => Math.max(1, ...data.corridors.flatMap((c) => c.exposureByHour)), [data.corridors]);
  const activeIds = new Set(active.map((s) => s.signal.id));
  const ends = new Set(data.corridors.flatMap((c) => [c.origin, c.destination]));
  const outline = useMemo(outlinePath, []);
  const view = useMemo(() => fitView(data, byCrs), [data, byCrs]);
  const labels = useMemo(() => placeLabels(data.stations, ends, view.w / 600), [data.stations, ends, view.w]);
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const showTip = (e: MouseEvent, content: ReactNode) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content });
  };

  // Works along the line are drawn on the line itself: the stretch between the first and last stop they name.
  const worksSegments = data.signals.flatMap((s) => {
    if (s.signal.kind !== "engineering_works") return [];
    return data.corridors.flatMap((c) => {
      const idx = c.stops.map((crs, i) => (s.signal.scope.stations.includes(crs) ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 2) return [];
      const stops = c.stops.slice(Math.min(...idx), Math.max(...idx) + 1).flatMap((crs) => (byCrs.get(crs) ? [byCrs.get(crs)!] : []));
      return stops.length >= 2 ? [{ s, key: `${s.signal.id}|${c.origin}-${c.destination}`, points: stops.map((st) => project(st.lon, st.lat).join(",")).join(" ") }] : [];
    });
  });
  const segmentFor = new Set(worksSegments.map((w) => w.s.signal.id));

  return (
    <div ref={box} className="relative">
      <svg viewBox={`${view.x.toFixed(0)} ${view.y.toFixed(0)} ${view.w.toFixed(0)} ${view.h.toFixed(0)}`} className="mx-auto block max-h-[44rem] w-full" role="img" aria-label="Map of the rail corridors and the world signals touching them">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <path d={outline} fill="#1e293b" stroke="#334155" strokeWidth={1.5} />

        {data.corridors.map((c) => {
          const pts = c.stops.flatMap((crs) => (byCrs.get(crs) ? [project(byCrs.get(crs)!.lon, byCrs.get(crs)!.lat).join(",")] : [])).join(" ");
          const share = (c.exposureByHour[hourIndex] ?? 0) / maxHour;
          const color = exposureColor(share);
          return (
            <g key={`${c.origin}-${c.destination}`} onMouseMove={(e) => showTip(e, <CorridorTip c={c} hourIndex={hourIndex} byCrs={byCrs} />)} onMouseLeave={() => setTip(null)}>
              <polyline points={pts} fill="none" stroke="#475569" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
              {share > 0.02 && <polyline points={pts} fill="none" stroke={color} strokeWidth={6 + 14 * share} strokeOpacity={0.55} filter="url(#glow)" />}
              <polyline points={pts} fill="none" stroke={share > 0.02 ? color : "#64748b"} strokeWidth={2 + 5 * share} strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-200" />
              <polyline points={pts} fill="none" stroke="transparent" strokeWidth={18} />
            </g>
          );
        })}

        {worksSegments.map(({ s, key, points }) => {
          const live = activeIds.has(s.signal.id);
          return (
            <polyline
              key={key}
              points={points}
              fill="none"
              stroke={KIND_COLOR.engineering_works}
              strokeWidth={focus === s.signal.id ? 9 : 7}
              strokeDasharray="10 7"
              strokeOpacity={live ? 1 : 0.3}
              className={live ? "tot-march" : ""}
              onMouseEnter={() => onFocus(s.signal.id)}
              onMouseMove={(e) => showTip(e, <SignalLine s={s} />)}
              onMouseLeave={() => (onFocus(null), setTip(null))}
            />
          );
        })}

        {data.signals.map((s) => {
          if (segmentFor.has(s.signal.id)) return null;
          const p = signalPoint(s, byCrs);
          if (!p) return null;
          const live = activeIds.has(s.signal.id);
          const r = 7 + 13 * s.signal.severity;
          const color = KIND_COLOR[s.signal.kind];
          const focused = focus === s.signal.id;
          return (
            <g
              key={s.signal.id}
              transform={`translate(${p[0].toFixed(1)},${p[1].toFixed(1)})`}
              opacity={live || focused ? 1 : 0.28}
              onMouseEnter={() => onFocus(s.signal.id)}
              onMouseMove={(e) => showTip(e, <SignalLine s={s} />)}
              onMouseLeave={() => (onFocus(null), setTip(null))}
              className="cursor-default"
            >
              {live && <circle r={r} fill="none" stroke={color} strokeWidth={3} className="tot-pulse" />}
              <circle r={r} fill={color} fillOpacity={0.25 + 0.5 * s.signal.confidence} stroke={focused ? "#ffffff" : "#0f172a"} strokeWidth={2} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={r * 1.05}>
                {REASON_ICON[s.signal.kind]}
              </text>
            </g>
          );
        })}
        {data.stations.map((st) => {
          const [x, y] = project(st.lon, st.lat);
          const major = ends.has(st.crs);
          const k = view.w / 600;
          const label = labels.get(st.crs);
          return (
            <g key={st.crs} pointerEvents="none">
              <circle cx={x} cy={y} r={(major ? 5 : 3) * k} fill="#f8fafc" stroke="#0f172a" strokeWidth={1.5 * k} />
              {label && (
                <text x={x + 9 * k} y={y + 4.5 * k} fontSize={13 * k} fontWeight={600} fill="#e2e8f0" stroke="#0f172a" strokeWidth={3 * k} paintOrder="stroke">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-slate-300">
        <span className="flex items-center gap-2">
          line: £ expected this hour
          <span aria-hidden className="h-2 w-20 rounded-full" style={{ background: `linear-gradient(to right, ${exposureColor(0)}, ${exposureColor(0.5)}, ${exposureColor(1)})` }} />
        </span>
        <span>circle size: severity · fill strength: confidence · pulsing: live now</span>
      </div>
      {tip && (
        <div className="pointer-events-none absolute z-20 w-72 rounded-lg bg-white p-2 text-slate-900 shadow-lg ring-1 ring-slate-200" style={{ left: Math.min(tip.x + 14, (box.current?.clientWidth ?? 400) - 290), top: tip.y + 14 }}>
          {tip.content}
        </div>
      )}
    </div>
  );
}

function CorridorTip({ c, hourIndex, byCrs }: { c: InputsResponse["corridors"][number]; hourIndex: number; byCrs: Map<string, Station> }) {
  const name = (crs: string) => byCrs.get(crs)?.name ?? crs;
  return (
    <div className="text-sm">
      <p className="font-semibold">
        {name(c.origin)} ⇄ {name(c.destination)}
      </p>
      <p className="text-xs text-slate-500">
        {operatorName(c.operator)} · {c.services} services · {percent(c.onTimeProb)} on time historically
      </p>
      <p className="mt-1 text-xs">
        This hour: <span className="font-semibold text-rose-700">{pounds(c.exposureByHour[hourIndex] ?? 0)}</span> expected · window total {pounds(c.exposureByHour.reduce((a, b) => a + b, 0))}
      </p>
    </div>
  );
}

// ── Timeline: signal swimlanes over the £ curve ─────────────────────────────

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(640, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const LABEL_W = 132;
const ROW_H = 18;
const CURVE_H = 150;

function Timeline({ data, index, focus, onFocus, onSeek }: { data: InputsResponse; index: number; focus: string | null; onFocus: (id: string | null) => void; onSeek: (i: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const { timeline, signals } = data;
  const t0 = Date.parse(timeline[0]!.at);
  const t1 = Date.parse(timeline.at(-1)!.at) + HOUR_MS;
  const plotW = width - LABEL_W - 8;
  const x = (ms: number) => LABEL_W + ((Math.min(t1, Math.max(t0, ms)) - t0) / (t1 - t0)) * plotW;
  const slotW = plotW / timeline.length;

  // One lane per kind present, each signal on the first sub-row where it doesn't overlap.
  const lanes = SIGNAL_KINDS.flatMap((kind) => {
    const inKind = signals.filter((s) => s.signal.kind === kind);
    if (inKind.length === 0) return [];
    const rows: SignalImpact[][] = [];
    for (const s of inKind) {
      const row = rows.find((r) => r.every((o) => o.signal.end <= s.signal.start || o.signal.start >= s.signal.end));
      if (row) row.push(s);
      else rows.push([s]);
    }
    return [{ kind, rows }];
  });
  let y = 22;
  const laneLayout = lanes.map((l) => {
    const top = y;
    y += l.rows.length * ROW_H + 8;
    return { ...l, top };
  });
  const lanesBottom = y;
  const curveTop = lanesBottom + 14;
  const height = curveTop + CURVE_H + 24;

  const maxCost = Math.max(1, ...timeline.map((p) => p.expectedCostPence));
  const yCost = (p: number) => curveTop + CURVE_H - (p / maxCost) * CURVE_H;
  const midX = (i: number) => LABEL_W + (i + 0.5) * slotW;
  const area = (key: "expectedCostPence" | "baselineCostPence") =>
    `M${midX(0)},${curveTop + CURVE_H} ${timeline.map((p, i) => `L${midX(i).toFixed(1)},${yCost(p[key]).toFixed(1)}`).join(" ")} L${midX(timeline.length - 1)},${curveTop + CURVE_H}Z`;
  const line = (key: "expectedCostPence" | "baselineCostPence") => timeline.map((p, i) => `${i ? "L" : "M"}${midX(i).toFixed(1)},${yCost(p[key]).toFixed(1)}`).join(" ");
  const days = timeline.flatMap((p, i) => (i === 0 || new Date(p.at).toLocaleDateString("en-GB", { timeZone: "Europe/London" }) !== new Date(timeline[i - 1]!.at).toLocaleDateString("en-GB", { timeZone: "Europe/London" }) ? [i] : []));

  const slotAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const i = Math.floor((clientX - r.left + (ref.current?.scrollLeft ?? 0) - LABEL_W) / slotW);
    return i >= 0 && i < timeline.length ? i : null;
  };
  const shown = hover ?? index;
  const p = timeline[shown]!;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Every signal in the window, and the £ it drives</h3>
        <p className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-0.5 w-5 bg-rose-700" /> expected Delay Repay
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2 w-5 rounded-sm bg-slate-300" /> punctuality history alone
          </span>
          <span>click to jump</span>
        </p>
      </div>
      <p className="mt-2 text-xs tabular-nums text-slate-600" aria-live="polite">
        {hover !== null ? "Pointing at" : "Playhead"}: <span className="font-semibold text-slate-900">{at(p.at)}</span> · <span className="font-semibold text-rose-700">{pounds(p.expectedCostPence)}</span> expected · history alone {pounds(p.baselineCostPence)} · {p.services} services
      </p>
      <div ref={ref} className="relative mt-2 overflow-x-auto">
        <svg
          width={width}
          height={height}
          className="block"
          onMouseMove={(e) => setHover(slotAt(e.clientX))}
          onMouseLeave={() => (setHover(null), setTip(null))}
          onClick={(e) => {
            const i = slotAt(e.clientX);
            if (i !== null) onSeek(i);
          }}
          role="img"
          aria-label="Signal impact windows by kind, above expected Delay Repay by hour"
        >
          {days.map((i) => (
            <g key={i}>
              <line x1={LABEL_W + i * slotW} x2={LABEL_W + i * slotW} y1={14} y2={curveTop + CURVE_H} className="stroke-slate-200" />
              <text x={LABEL_W + i * slotW + 4} y={11} fontSize={11} className="fill-slate-500">
                {dayShort.format(new Date(timeline[i]!.at))}
              </text>
            </g>
          ))}

          {laneLayout.map((lane) => (
            <g key={lane.kind}>
              <text x={0} y={lane.top + 13} fontSize={12} className="fill-slate-700" fontWeight={600}>
                {REASON_ICON[lane.kind as SignalKind]} {KIND_LABEL[lane.kind as SignalKind]}
              </text>
              {lane.rows.map((row, r) =>
                row.map((s) => {
                  const x0 = x(Date.parse(s.signal.start));
                  const x1 = Math.max(x0 + 4, x(Date.parse(s.signal.end)));
                  const focused = focus === s.signal.id;
                  return (
                    <g
                      key={s.signal.id}
                      onMouseEnter={(e) => {
                        onFocus(s.signal.id);
                        const rect = ref.current!.getBoundingClientRect();
                        setTip({ x: e.clientX - rect.left + ref.current!.scrollLeft, y: e.clientY - rect.top, content: <SignalLine s={s} /> });
                      }}
                      onMouseLeave={() => (onFocus(null), setTip(null))}
                    >
                      <rect
                        x={x0}
                        y={lane.top + r * ROW_H + 2}
                        width={x1 - x0}
                        height={ROW_H - 4}
                        rx={4}
                        fill={KIND_COLOR[s.signal.kind]}
                        fillOpacity={0.35 + 0.6 * s.signal.confidence}
                        className={focused ? "stroke-slate-900" : "stroke-white"}
                        strokeWidth={2}
                      />
                      {x1 - x0 > 90 && (
                        <text x={x0 + 6} y={lane.top + r * ROW_H + 13} fontSize={10.5} className="fill-slate-900" pointerEvents="none">
                          {s.signal.title.length > (x1 - x0) / 6.2 ? `${s.signal.title.slice(0, Math.floor((x1 - x0) / 6.2) - 1)}…` : s.signal.title}
                        </text>
                      )}
                    </g>
                  );
                }),
              )}
            </g>
          ))}

          <text x={0} y={curveTop + 12} fontSize={12} fill="#334155" fontWeight={600}>
            💷 Delay Repay
          </text>
          <text x={0} y={curveTop + 27} fontSize={11} className="fill-slate-500">
            by departure hour
          </text>
          <text x={LABEL_W - 6} y={curveTop + 4} fontSize={10} className="fill-slate-400" textAnchor="end">
            {pounds(maxCost)}
          </text>
          <line x1={LABEL_W} x2={width - 8} y1={curveTop + CURVE_H} y2={curveTop + CURVE_H} className="stroke-slate-300" />
          <path d={area("expectedCostPence")} className="fill-rose-600" fillOpacity={0.12} />
          <path d={area("baselineCostPence")} className="fill-slate-300" />
          <path d={line("expectedCostPence")} fill="none" className="stroke-rose-700" strokeWidth={2} strokeLinejoin="round" />

          <line x1={midX(index)} x2={midX(index)} y1={14} y2={curveTop + CURVE_H} className="stroke-slate-900" strokeWidth={2} />
          <circle cx={midX(index)} cy={yCost(timeline[index]!.expectedCostPence)} r={5} className="fill-rose-700 stroke-white" strokeWidth={2} />
          {hover !== null && hover !== index && <line x1={midX(hover)} x2={midX(hover)} y1={14} y2={curveTop + CURVE_H} className="stroke-slate-400" strokeDasharray="3 3" />}
        </svg>
        {tip && (
          <div className="pointer-events-none absolute z-20 w-72 rounded-lg bg-white p-2 shadow-lg ring-1 ring-slate-200" style={{ left: Math.min(tip.x + 14, width - 290), top: tip.y + 14 }}>
            {tip.content}
          </div>
        )}
      </div>
    </div>
  );
}

// ── The same evidence as a table (accessibility, and for the judges who want numbers) ──

function SignalTable({ signals, focus, onFocus }: { signals: SignalImpact[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const sorted = [...signals].sort((a, b) => b.expectedCostPence - a.expectedCostPence || a.signal.start.localeCompare(b.signal.start));
  return (
    <details className="rounded-2xl bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">
        Every signal as a table <span className="font-normal text-slate-500">· {signals.length} signals, biggest £ first</span>
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2 pr-3">Signal</th>
              <th className="py-2 pr-3">Kind</th>
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Severity</th>
              <th className="py-2 pr-3">Confidence</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Services</th>
              <th className="py-2">Adds</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.signal.id} onMouseEnter={() => onFocus(s.signal.id)} onMouseLeave={() => onFocus(null)} className={`border-t border-slate-100 ${focus === s.signal.id ? "bg-slate-50" : ""}`}>
                <td className="py-2 pr-3 font-medium">{s.signal.title}</td>
                <td className="whitespace-nowrap py-2 pr-3">
                  <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLOR[s.signal.kind] }} />
                  {REASON_ICON[s.signal.kind]} {KIND_LABEL[s.signal.kind]}
                </td>
                <td className="whitespace-nowrap py-2 pr-3">
                  {at(s.signal.start)} – {at(s.signal.end)}
                </td>
                <td className="py-2 pr-3">{percent(s.signal.severity)}</td>
                <td className="py-2 pr-3">{percent(s.signal.confidence)}</td>
                <td className="py-2 pr-3">{s.signal.source}</td>
                <td className="py-2 pr-3">{s.affectedServices}</td>
                <td className="py-2 font-semibold text-rose-700">{s.expectedCostPence ? pounds(s.expectedCostPence) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
