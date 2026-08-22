import { formatEur, type Cents } from '@/core/money.ts';
import type { EnvelopeConsumption } from '@/numbers/consumption.ts';

export interface EnvelopeMetersProps {
  readonly consumption: readonly EnvelopeConsumption[];
}

interface MeterRow {
  readonly id: string;
  readonly name: string;
  readonly spent: Cents;
  readonly estimate: Cents;
  readonly paceExpected: Cents;
  readonly goal: Cents | null;
}

/**
 * Only configured envelopes have an estimate to meter against — a derived
 * envelope has nowhere to put a track.
 */
function toRows(consumption: readonly EnvelopeConsumption[]): readonly MeterRow[] {
  const rows: MeterRow[] = [];
  for (const c of consumption) {
    if (c.envelope.kind !== 'configured') continue;
    rows.push({
      id: c.envelope.config.id,
      name: c.envelope.config.name,
      spent: c.yearToDateSpent,
      estimate: c.envelope.config.estimate,
      paceExpected: c.paceExpected,
      goal: c.envelope.config.goal,
    });
  }
  return rows;
}

function MeterRowView({ row }: { readonly row: MeterRow }) {
  // The track's own 100% is whichever of spent/estimate/goal is largest —
  // not a fixed "estimate = full width" the way a plain progress bar would
  // read, because that leaves nowhere to draw the part of the bar that's
  // actually over the estimate. Floored at 1 so an envelope with nothing
  // set anywhere (estimate 0, nothing spent) never divides by zero.
  const scaleMax = Math.max(row.spent, row.estimate, row.goal ?? 0, 1);
  const spentPct = (row.spent / scaleMax) * 100;
  const estimatePct = (row.estimate / scaleMax) * 100;
  const pacePct = (row.paceExpected / scaleMax) * 100;
  const goalPct = row.goal !== null ? (row.goal / scaleMax) * 100 : null;

  const overEstimate = row.spent > row.estimate;
  // Solid up to the estimate (or up to spent, if spend hasn't reached it
  // yet); the striped segment is only ever the part beyond the estimate.
  const basePct = Math.min(spentPct, estimatePct);
  const overFillPct = overEstimate ? spentPct - estimatePct : 0;

  return (
    <div className={overEstimate ? 'meter-row meter-row-over' : 'meter-row meter-row-under'} tabIndex={0}>
      <div className="meter-label">
        <span className="meter-name">{row.name}</span>
        <span className="meter-figures num">
          {formatEur(row.spent)} / {formatEur(row.estimate)}
        </span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={row.name}
        aria-valuenow={row.spent}
        aria-valuemin={0}
        aria-valuemax={Math.max(row.estimate, row.spent)}
        aria-valuetext={`${formatEur(row.spent)} spent of ${formatEur(row.estimate)} estimated`}
      >
        <div className="meter-fill" style={{ width: `${basePct}%` }} />
        {overFillPct > 0 && (
          <div className="meter-fill-over" style={{ left: `${estimatePct}%`, width: `${overFillPct}%` }} />
        )}
        <div className="meter-mark meter-mark-estimate" style={{ left: `${estimatePct}%` }} />
        <div className="meter-mark meter-mark-pace" style={{ left: `${pacePct}%` }} />
        {goalPct !== null && <div className="meter-mark meter-mark-goal" style={{ left: `${goalPct}%` }} />}
      </div>
      <div className="tooltip-box" role="tooltip">
        <div className="tooltip-title">{row.name}</div>
        <dl className="tooltip-figures">
          <dt>Spent</dt>
          <dd className="num">{formatEur(row.spent)}</dd>
          <dt>Estimate</dt>
          <dd className="num">{formatEur(row.estimate)}</dd>
          <dt>Expected by now</dt>
          <dd className="num">{formatEur(row.paceExpected)}</dd>
          {row.goal !== null && (
            <>
              <dt>Goal</dt>
              <dd className="num">{formatEur(row.goal)}</dd>
            </>
          )}
        </dl>
        <p className="tooltip-note">
          {overEstimate
            ? `${formatEur(row.spent - row.estimate)} over the estimate (striped).`
            : `${formatEur(row.estimate - row.spent)} left in the estimate.`}
        </p>
      </div>
    </div>
  );
}

/**
 * A single ratio against a limit, per envelope — the dataviz skill's own
 * "meter" row. The bar fills solid up to the estimate; anything spent
 * beyond it renders as a diagonal-stripe segment rather than more solid
 * fill, so "over" is a different texture, not just a longer bar. Three
 * marks sit on the track: the estimate boundary itself, the seasonally
 * -paced expectation (where spending *should* be by now, not a flat
 * one-twelfth-per-month line), and the goal when one is set. The row's own
 * background tints toward over/under so the state reads before the numbers
 * do. A hover tooltip spells out every figure at once, replacing the plain
 * `title` attribute this used to carry.
 *
 * Sorted by spend, biggest first — the highest-euro envelope is the first
 * thing seen, not the worst-paced one (spend size, not pace, is what a
 * household scanning this list cares about first). Envelopes with nothing
 * spent yet are real but not urgent, so they collapse behind a toggle
 * rather than pushing the list halfway down the page.
 */
export function EnvelopeMeters({ consumption }: EnvelopeMetersProps) {
  const rows = toRows(consumption);
  if (rows.length === 0) {
    return <p className="chart-empty">No configured envelopes yet.</p>;
  }

  const sorted = [...rows].sort((a, b) => b.spent - a.spent);
  const spent = sorted.filter((r) => r.spent > 0);
  const empty = sorted.filter((r) => r.spent === 0);

  return (
    <div className="envelope-meters">
      <div className="meters">
        {spent.map((row) => (
          <MeterRowView row={row} key={row.id} />
        ))}
      </div>
      {empty.length > 0 && (
        <details className="meters-empty">
          <summary>
            {empty.length} envelope{empty.length === 1 ? '' : 's'} with nothing spent yet
          </summary>
          <div className="meters">
            {empty.map((row) => (
              <MeterRowView row={row} key={row.id} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
