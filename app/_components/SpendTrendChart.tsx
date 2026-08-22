import { formatMonthShort, formatMonthLong, monthOf, type Day } from '@/core/dates.ts';
import { formatEur, formatEurCompact, sum, type Cents } from '@/core/money.ts';
import type { MonthlySpend } from '@/numbers/timeline.ts';
import { niceMax, TOOLTIP_GAP, TOOLTIP_WIDTH, tooltipHeight } from '../_lib/chart.ts';

export interface SpendTrendChartProps {
  /** `monthlySpendTimeline(ledger)` — every month the ledger has, ascending. */
  readonly months: readonly MonthlySpend[];
  /** Marks the in-progress month distinctly, by actual calendar month rather than array position — same role as ContributionsChart's prop. */
  readonly referenceDay: Day;
}

const CHART_HEIGHT = 140;
const AXIS_ROOM = 26;
const TOP_ROOM = 14; // above the 100% gridline, so its label isn't clipped by the viewBox
const LEFT_AXIS_WIDTH = 56;
const POINT_GAP = 34;
const MARKER_R = 4;

/**
 * Total household spend, one line across the whole ledger, against its own
 * mean — trend over time against a single reference value, the line-chart
 * row of the dataviz skill's form table. A single series needs no legend
 * box; the chart's own `aria-label` and the caption below it carry identity
 * instead. The average figure is a plain HTML caption rather than inline
 * SVG text next to the dashed line: an in-chart label anchored to the
 * line's own y-position collides with whichever data point happens to sit
 * near the mean, at any number of months — a fixed caption never does.
 */
export function SpendTrendChart({ months, referenceDay }: SpendTrendChartProps) {
  if (months.length === 0) {
    return <p className="chart-empty">No spending recorded yet.</p>;
  }

  const currentMonth = monthOf(referenceDay);

  // The in-progress month reads lower than a finished one by construction —
  // averaging it in at full weight would silently pull "average X / month"
  // down every time this renders mid-month. Excluded from the mean, not
  // just dimmed in the line: `completeMonths` falls back to `months` only
  // for the degenerate case of a ledger that has nothing but its first,
  // in-progress month.
  const completeMonths = months.filter((m) => m.month !== currentMonth);
  const meanSource = completeMonths.length > 0 ? completeMonths : months;
  const mean = Math.round(sum(meanSource.map((m) => m.total)) / meanSource.length);
  const axisMax = niceMax(Math.max(...months.map((m) => m.total), mean, 1));
  const scale = (cents: Cents): number => (cents / axisMax) * CHART_HEIGHT;

  const chartWidth = months.length * POINT_GAP;
  const width = LEFT_AXIS_WIDTH + chartWidth;
  const svgHeight = TOP_ROOM + CHART_HEIGHT + AXIS_ROOM;
  const baseline = TOP_ROOM + CHART_HEIGHT;

  const xFor = (i: number): number => LEFT_AXIS_WIDTH + POINT_GAP / 2 + i * POINT_GAP;
  const yFor = (cents: Cents): number => baseline - scale(cents);

  // Same "never a number on every point" rule as ContributionsChart: two
  // gridlines carry the scale, the exact figure per month lives in the
  // native tooltip.
  //
  // `value` rounded to a whole cent, keyed by `fraction` not `value` — same
  // fix as ContributionsChart's own gridlines: `axisMax * fraction` is only
  // fractional at a very small `axisMax` (1 or 5), but at that size the
  // rounded 50%/100% values can collide, and `fraction` (0.5, 1) stays
  // unique where the rounded value doesn't.
  const gridlines = [0.5, 1].map((fraction) => ({
    fraction,
    y: baseline - CHART_HEIGHT * fraction,
    value: Math.round(axisMax * fraction),
  }));

  const points = months.map((month, i) => ({ x: xFor(i), y: yFor(month.total), month }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const meanY = yFor(mean);

  return (
    <div className="chart-wrap">
      <svg
        className="trend"
        viewBox={`0 0 ${width} ${svgHeight}`}
        width="100%"
        height={svgHeight}
        role="img"
        aria-label="Total spend by month, against its own average"
      >
        {gridlines.map(({ fraction, y, value }) => (
          <g key={fraction}>
            <line className="grid-line" x1={LEFT_AXIS_WIDTH} y1={y} x2={width} y2={y} />
            <text className="axis-tick-label" x={LEFT_AXIS_WIDTH - 8} y={y} textAnchor="end" dominantBaseline="middle">
              {formatEurCompact(value)}
            </text>
          </g>
        ))}
        <line className="axis-line" x1={LEFT_AXIS_WIDTH} y1={baseline} x2={width} y2={baseline} />

        <line className="mean-line" x1={LEFT_AXIS_WIDTH} y1={meanY} x2={width} y2={meanY}>
          <title>{`Average ${formatEur(mean)} / month`}</title>
        </line>

        <path className="trend-line" d={linePath} fill="none" />

        {points.map((p) => {
          const isPartial = p.month.month === currentMonth;
          const titleText = `${formatMonthLong(p.month.month)}${isPartial ? ' (in progress)' : ''} — ${formatEur(
            p.month.total,
          )}`;

          const delta = p.month.total - mean;
          const deltaText =
            delta === 0
              ? 'Exactly average.'
              : `${formatEur(Math.abs(delta))} ${delta > 0 ? 'above' : 'below'} average.`;
          const boxHeight = tooltipHeight(2); // one figure row (spent) + the delta note
          const tooltipX = Math.min(Math.max(p.x - TOOLTIP_WIDTH / 2, 2), width - TOOLTIP_WIDTH - 2);
          const tooltipY = p.y - TOOLTIP_GAP - boxHeight;

          return (
            <g key={p.month.month} className="bar-group" opacity={isPartial ? 0.6 : 1}>
              <title>{titleText}</title>
              <circle className="trend-point" cx={p.x} cy={p.y} r={MARKER_R} />
              <text className="month-label" x={p.x} y={svgHeight - 8} textAnchor="middle">
                {formatMonthShort(p.month.month)}
                {isPartial ? '*' : ''}
              </text>
              <foreignObject
                className="bar-tooltip-anchor"
                x={tooltipX}
                y={tooltipY}
                width={TOOLTIP_WIDTH}
                height={boxHeight}
              >
                <div className="tooltip-box">
                  <div className="tooltip-title">
                    {formatMonthLong(p.month.month)}
                    {isPartial ? ' (in progress)' : ''}
                  </div>
                  <dl className="tooltip-figures">
                    <dt>Spent</dt>
                    <dd className="num">{formatEur(p.month.total)}</dd>
                  </dl>
                  <p className="tooltip-note">{deltaText}</p>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      <p className="chart-note">dashed line — average {formatEurCompact(mean)} / month</p>
      {months.some((m) => m.month === currentMonth) && (
        <p className="chart-note">* month in progress — not yet a complete data point</p>
      )}
    </div>
  );
}
