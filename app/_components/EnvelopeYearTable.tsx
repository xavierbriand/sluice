import { formatEur } from '@/core/money.ts';
import { envelopeId, envelopeName } from '@/numbers/envelopes.ts';
import type { EnvelopeConsumption } from '@/numbers/consumption.ts';

export interface EnvelopeYearTableProps {
  readonly consumption: readonly EnvelopeConsumption[];
}

/**
 * Every envelope's shape from the completed prior year, alongside what's
 * currently configured — the reference a household rebuilds next year's
 * estimates from. A derived envelope has no estimate or goal to show,
 * only what it actually cost; a configured one with no `goal` set shows
 * `—` there too, same as `EnvelopeCheckTable`'s "no goal" case.
 *
 * A configured envelope's own `[envelopes.<id>]` id is shown as a muted
 * sub-line under its name — this table's whole point is rebuilding
 * `sluice.toml` by hand, and the id (not the display name) is what a
 * reader copies to cross-reference a generated block against. A derived
 * envelope's name already *is* its id, so it isn't repeated.
 *
 * A table, not a chart: `> ~7 classes` already argues for one, and a real
 * household clears that many times over (54 rows, one real test run so
 * far). Sorted by prior-year actual, biggest first — the envelopes worth
 * the most money are the ones worth checking the estimate on first when
 * rebuilding next year's plan.
 */
export function EnvelopeYearTable({ consumption }: EnvelopeYearTableProps) {
  const rows = [...consumption].sort((a, b) => b.priorYearActual - a.priorYearActual);

  return (
    <div className="table-scroll">
      <table className="data-table year">
        <thead>
          <tr>
            <th>Envelope</th>
            <th className="amount">Prior year actual</th>
            <th className="amount">Estimate</th>
            <th className="amount">Goal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.envelope.kind}:${envelopeId(c.envelope)}`}>
              <td>
                {envelopeName(c.envelope)}
                {c.envelope.kind === 'configured' && <div className="envelope-id">{c.envelope.config.id}</div>}
              </td>
              <td className="amount num">{formatEur(c.priorYearActual)}</td>
              <td className="amount num">
                {c.envelope.kind === 'configured' ? formatEur(c.envelope.config.estimate) : '—'}
              </td>
              <td className="amount num">
                {c.envelope.kind === 'configured' && c.envelope.config.goal !== null
                  ? formatEur(c.envelope.config.goal)
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
