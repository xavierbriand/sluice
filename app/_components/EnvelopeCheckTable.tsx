import { formatEur } from '@/core/money.ts';
import { envelopeId, envelopeName } from '@/numbers/envelopes.ts';
import type { EnvelopeCheck, GoalStatus } from '@/numbers/checks.ts';
import { StatusBadge, type StatusTone } from './StatusBadge.tsx';

export interface EnvelopeCheckTableProps {
  readonly envelopes: readonly EnvelopeCheck[];
}

function goalBadge(status: GoalStatus): { readonly tone: StatusTone; readonly icon: string; readonly label: string } {
  switch (status) {
    case 'on-track':
      return { tone: 'good', icon: '✓', label: 'On track' };
    case 'at-risk':
      return { tone: 'serious', icon: '!', label: 'At risk' };
    case 'too-early':
      return { tone: 'neutral', icon: '…', label: 'Too early' };
    case 'no-goal':
      return { tone: 'neutral', icon: '–', label: 'No goal' };
  }
}

/**
 * A derived envelope has no estimate, so `paceExpected` is always 0 and
 * `pastPace` reads `true` the moment it has any spending at all — a fact
 * about the domain field (documented on `EnvelopeCheck.pastPace` in
 * checks.ts), not a real "ahead of where it should be" signal, since there
 * is no plan for it to be ahead of. Pace only means something for a
 * configured envelope, which has a real estimate to pace against.
 */
function hasPace(c: EnvelopeCheck): boolean {
  return c.envelope.kind === 'configured';
}

/** At-risk first, then merely over pace, then everyone else — the same "highest-signal row first" rule 02's meters already use. */
function rank(c: EnvelopeCheck): number {
  if (c.goalStatus === 'at-risk') return 0;
  if (hasPace(c) && c.pastPace) return 1;
  return 2;
}

/**
 * `> ~7 classes` → table, per the dataviz skill's own form heuristic — a
 * real household clears that with room to spare (54 envelopes, one real
 * test run so far).
 */
export function EnvelopeCheckTable({ envelopes }: EnvelopeCheckTableProps) {
  const rows = [...envelopes].sort((a, b) => rank(a) - rank(b));

  return (
    <div className="table-scroll">
      <table className="data-table checks">
        <thead>
          <tr>
            <th>Envelope</th>
            <th>Pace</th>
            <th>Goal</th>
            <th className="amount">Projected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const badge = goalBadge(c.goalStatus);
            const over = hasPace(c) && c.pastPace;
            return (
              <tr key={`${c.envelope.kind}:${envelopeId(c.envelope)}`}>
                <td>{envelopeName(c.envelope)}</td>
                <td className={over ? 'pace-over' : 'pace-ok'}>{over ? 'Over' : '—'}</td>
                <td>
                  <StatusBadge tone={badge.tone} icon={badge.icon} label={badge.label} />
                </td>
                <td className="amount num">{c.projectedFullYear !== null ? formatEur(c.projectedFullYear) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
