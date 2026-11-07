import { formatPence, type FareCurve } from "@tot/shared";

const W = 300;
const H = 64;
const PAD = { left: 4, right: 4, top: 14, bottom: 14 };

/** How the cheapest fare for one train steps up as travel day nears, with today marked. */
export function Sparkline({ curve, bookingDate }: { curve: FareCurve; bookingDate: string }) {
  const points = [...curve.points].sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return null;

  const t = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const [t0, t1] = [t(points[0]!.date), t(points.at(-1)!.date)];
  const prices = points.map((p) => p.pricePence);
  const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
  const x = (date: string) => PAD.left + ((t(date) - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (price: number) => PAD.top + (1 - (price - lo) / Math.max(1, hi - lo)) * (H - PAD.top - PAD.bottom);

  // A fare holds until the next change, so draw it as steps.
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)},${y(p.pricePence).toFixed(1)}${i < points.length - 1 ? ` L${x(points[i + 1]!.date).toFixed(1)},${y(p.pricePence).toFixed(1)}` : ""}`).join(" ");

  // Today: the fare you'd pay now, i.e. the last point on or before the booking date.
  const today = [...points].reverse().find((p) => p.date <= bookingDate) ?? points[0]!;
  const first = points[0]!;
  const last = points.at(-1)!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Fare by booking date: ${formatPence(first.pricePence)} when it goes on sale, ${formatPence(today.pricePence)} today, ${formatPence(last.pricePence)} on the day`} className="mt-2 h-16 w-full max-w-md">
      <path d={path} fill="none" stroke="rgb(5 150 105)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(today.date)} cy={y(today.pricePence)} r="4" fill="rgb(15 23 42)" />
      <text
        x={Math.min(Math.max(x(today.date), 28), W - 28)}
        y={y(today.pricePence) > H / 2 ? y(today.pricePence) - 8 : y(today.pricePence) + 15}
        textAnchor="middle"
        fontSize="9"
        fill="rgb(15 23 42)"
        stroke="rgb(236 253 245)"
        strokeWidth="3"
        paintOrder="stroke"
      >
        today {formatPence(today.pricePence)}
      </text>
      <text x={PAD.left} y={H - 2} fontSize="8" fill="rgb(100 116 139)">
        on sale {formatPence(first.pricePence)}
      </text>
      <text x={W - PAD.right} y={H - 2} textAnchor="end" fontSize="8" fill="rgb(100 116 139)">
        on the day {formatPence(last.pricePence)}
      </text>
    </svg>
  );
}
