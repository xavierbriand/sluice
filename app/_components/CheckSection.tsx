import { dayOfMonth, formatMonthShort, monthOf, yearOf, type Day } from '@/core/dates.ts';
import { formatEur } from '@/core/money.ts';
import type { Config, EnvelopeMatcher } from '@/config/load.ts';
import type { Plan } from '@/numbers/plan.ts';
import type { PlanWarning } from '@/numbers/audit.ts';
import type { ShareStatus } from '@/numbers/checks.ts';
import { StatTile } from './StatTile.tsx';
import { StatusBadge, type StatusTone } from './StatusBadge.tsx';
import { EnvelopeCheckTable } from './EnvelopeCheckTable.tsx';

function describeMatcher(matcher: EnvelopeMatcher): string {
  return matcher.kind === 'category' ? `"${matcher.category}"` : `"${matcher.category} / ${matcher.subCategory}"`;
}

function personName(config: Config, personId: string): string {
  return config.people.find((p) => p.id === personId)?.name ?? personId;
}

function shareBadge(status: ShareStatus): { readonly tone: StatusTone; readonly icon: string; readonly label: string } {
  switch (status) {
    case 'ok':
      return { tone: 'good', icon: '✓', label: 'Sustainable' };
    case 'high':
      return { tone: 'warning', icon: '!', label: 'High — over 3/4 of income' };
    case 'exceeds-income':
      return { tone: 'critical', icon: '!', label: 'Exceeds income' };
  }
}

/** "24 Jan 2026" — every other date-like figure on the page is formatted for humans; a findings sentence shouldn't be the one place a raw ISO string shows through. */
function formatDay(day: Day): string {
  return `${dayOfMonth(day)} ${formatMonthShort(monthOf(day))} ${yearOf(day)}`;
}

/**
 * A stable React key derived from each warning's own identifying fields —
 * `PlanWarning` carries no single id field, and the array index isn't
 * stable across renders where the underlying data (and so the list) can
 * change. `matcher-matches-nothing` needs both the envelope id and the
 * matcher itself: one envelope can have several matchers, each producing
 * its own warning if it never fires.
 */
function warningKey(warning: PlanWarning): string {
  switch (warning.kind) {
    case 'matcher-matches-nothing': {
      const m = warning.matcher;
      const matcherKey = m.kind === 'category' ? m.category : `${m.category}/${m.subCategory}`;
      return `matcher-matches-nothing:${warning.envelopeId}:${matcherKey}`;
    }
    case 'label-matches-nothing':
      return `label-matches-nothing:${warning.personId}:${warning.label}`;
    case 'transfer-matches-two-people':
      return `transfer-matches-two-people:${warning.transaction.id}`;
    case 'uncategorised-rows':
      return 'uncategorised-rows';
  }
}

function describeWarning(warning: PlanWarning): string {
  switch (warning.kind) {
    case 'matcher-matches-nothing':
      return `Envelope "${warning.envelopeId}": the matcher for ${describeMatcher(warning.matcher)} never fires against a real transaction.`;
    case 'label-matches-nothing':
      return `${warning.personId}: transfer label "${warning.label}" never matches a real inbound transfer.`;
    case 'transfer-matches-two-people':
      return `Transfer "${warning.transaction.label}" (${formatEur(warning.transaction.amount)}, ${formatDay(warning.transaction.occurredOn)}) matches ${warning.people.map((p) => p.name).join(' and ')} at once — not credited to anyone.`;
    case 'uncategorised-rows':
      // `warning.total` sums both uncategorised-outgoing (negative) and
      // uncategorised-incoming (positive) rows — a real net, not a
      // magnitude. "Totalling X" would read as "X of unfiled spend," which
      // overstates or understates the true unfiled volume whenever both
      // kinds are present and partly offset. "Net" says plainly that the
      // two can cancel.
      return `${warning.count} row${warning.count === 1 ? '' : 's'} still uncategorised — net ${formatEur(warning.total)} (outgoing and incoming both count toward this figure).`;
  }
}

/**
 * Plan vs. reality: drift as a signed figure (no invented good/bad
 * threshold — the domain layer has none), envelopes past pace and their
 * goal status as a table, buffer sufficiency as a status badge, each
 * person's transfer against their own income (also a status badge — this
 * one *does* have a domain-computed threshold, `ShareStatus`), and
 * whatever the audit found as a plain findings list.
 */
export function CheckSection({ config, plan }: { readonly config: Config; readonly plan: Plan }) {
  const { check, warnings } = plan;

  return (
    <section className="card">
      <h2>03 · The check</h2>
      <p className="deck">
        The trailing year&apos;s actual spend against what&apos;s planned, and the buffer that has to absorb the
        gap.
      </p>

      <div className="check-summary">
        <StatTile
          label="Drift — trailing year vs. planned"
          value={check.drift}
          signed
          sub={`${formatEur(check.trailingYearActual)} actual · ${formatEur(check.plannedTotal)} planned`}
        />
        <div className="buffer-status">
          <span className="stat-tile-label">Buffer</span>
          {check.bufferSufficient ? (
            <StatusBadge tone="good" icon="✓" label="Sufficient" />
          ) : (
            <StatusBadge tone="critical" icon="!" label="Insufficient" />
          )}
          <span className="stat-tile-sub">
            {formatEur(config.bufferTarget)} target · worst month observed {formatEur(check.worstObservedMonth)}
          </span>
        </div>
        {check.people.map((p) => {
          const badge = shareBadge(p.status);
          return (
            <div className="buffer-status" key={p.personId}>
              <span className="stat-tile-label">{personName(config, p.personId)} transfer</span>
              <StatusBadge tone={badge.tone} icon={badge.icon} label={badge.label} />
              <span className="stat-tile-sub">
                {p.status === 'exceeds-income'
                  ? `${formatEur(p.amount)} transferred — ${formatEur(p.amount - p.netMonthly)} more than their ${formatEur(p.netMonthly)} net income`
                  : `${formatEur(p.amount)} of ${formatEur(p.netMonthly)} net income`}
              </span>
            </div>
          );
        })}
      </div>

      <EnvelopeCheckTable envelopes={check.envelopes} />

      {warnings.length > 0 && (
        <div className="findings">
          <h3>Findings</h3>
          <ul>
            {warnings.map((w) => (
              <li key={warningKey(w)}>{describeWarning(w)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
