import { formatMonthLong, monthNumber, monthOf, type Day } from '@/core/dates.ts';
import { formatEur, formatEurExplicitSign, sum, type Cents } from '@/core/money.ts';
import type { EnvelopeConsumption } from '@/numbers/consumption.ts';
import type { SeasonalProvenance } from '@/numbers/seasonal.ts';
import { envelopeId, envelopeName } from '@/numbers/envelopes.ts';

export interface RequirementBreakdownProps {
  readonly consumption: readonly EnvelopeConsumption[];
  readonly referenceDay: Day;
  /** `plan.monthlyRequirement` — passed in rather than re-summed, so this table can never disagree with what `computeShares` actually split. */
  readonly monthlyRequirement: Cents;
}

interface Row {
  readonly id: string;
  readonly name: string;
  readonly thisMonth: Cents;
  readonly flat: Cents;
  readonly provenance: SeasonalProvenance;
}

function provenanceLabel(provenance: SeasonalProvenance): string {
  switch (provenance) {
    case 'configured':
      return 'Configured shape';
    case 'derived-from-history':
      return "From last year's pattern";
    case 'flat-no-history':
      return 'Flat — no history yet';
  }
}

/**
 * Every configured envelope's contribution to *this specific month's*
 * requirement, next to what the same estimate would ask for if it were
 * spread flat across the year — the seasonal shape made visible, not just
 * felt as "why is this month's total so high." A derived envelope has no
 * estimate and so nothing to contribute here; its spending shows up in
 * `check.drift` instead, never silently folded into this total.
 *
 * Sorted biggest-this-month first, same "highest-signal row first" rule
 * 02's meters and 03's check table already use. Envelopes asking for
 * nothing this month collapse behind a toggle — a real, correct fact for a
 * strongly seasonal envelope (a mortgage that hasn't started yet, a
 * holiday pot outside its season), not something to pad the table with.
 */
export function RequirementBreakdown({ consumption, referenceDay, monthlyRequirement }: RequirementBreakdownProps) {
  const monthIndex = monthNumber(monthOf(referenceDay)) - 1;

  const rows: Row[] = [];
  for (const c of consumption) {
    if (c.envelope.kind !== 'configured' || c.monthlyPlan === null || c.flatMonthlyPlan === null) continue;
    rows.push({
      id: envelopeId(c.envelope),
      name: envelopeName(c.envelope),
      thisMonth: c.monthlyPlan[monthIndex] ?? 0,
      flat: c.flatMonthlyPlan[monthIndex] ?? 0,
      provenance: c.seasonal.provenance,
    });
  }

  if (rows.length === 0) {
    return <p className="chart-empty">No configured envelopes yet.</p>;
  }

  const sorted = [...rows].sort((a, b) => b.thisMonth - a.thisMonth);
  const active = sorted.filter((r) => r.thisMonth > 0);
  const inactive = sorted.filter((r) => r.thisMonth === 0);
  const flatTotal = sum(rows.map((r) => r.flat));
  const monthLabel = formatMonthLong(monthOf(referenceDay));

  const renderRows = (list: readonly Row[]) =>
    list.map((r) => {
      const delta = r.thisMonth - r.flat;
      return (
        <tr key={r.id}>
          <td>{r.name}</td>
          <td className="amount num">{formatEur(r.thisMonth)}</td>
          <td className="amount num">{formatEur(r.flat)}</td>
          <td className="amount num">{delta === 0 ? '—' : formatEurExplicitSign(delta)}</td>
          <td className="requirement-provenance">{provenanceLabel(r.provenance)}</td>
        </tr>
      );
    });

  return (
    <div className="requirement-breakdown">
      <div className="table-scroll">
        <table className="data-table requirement">
          <thead>
            <tr>
              <th>Envelope</th>
              <th className="amount">{monthLabel}</th>
              <th className="amount">Flat (1/12)</th>
              <th className="amount">Seasonal effect</th>
              <th>Shape</th>
            </tr>
          </thead>
          <tbody>
            {renderRows(active)}
            <tr className="requirement-total">
              <td>Total</td>
              <td className="amount num">{formatEur(monthlyRequirement)}</td>
              <td className="amount num">{formatEur(flatTotal)}</td>
              <td className="amount num">
                {monthlyRequirement === flatTotal ? '—' : formatEurExplicitSign(monthlyRequirement - flatTotal)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {inactive.length > 0 && (
        <details className="requirement-inactive">
          <summary>
            {inactive.length} envelope{inactive.length === 1 ? '' : 's'} asking for nothing this month
          </summary>
          <div className="table-scroll">
            <table className="data-table requirement">
              <tbody>{renderRows(inactive)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
