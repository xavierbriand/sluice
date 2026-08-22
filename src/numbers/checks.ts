import type { Cents } from '../core/money.ts';
import { addMonths, monthOf, type Day, type Month } from '../core/dates.ts';
import type { Config } from '../config/load.ts';
import type { Ledger } from '../ingest/load.ts';
import { outflow } from './envelopes.ts';
import type { EnvelopeConsumption } from './consumption.ts';
import type { PersonShare } from './income.ts';
import { attributeContributions, contributionsByMonth } from './funding.ts';

/**
 * Whether an envelope with a goal is still reachable, projected from how far
 * through its seasonal pace the year is — not a flat `×12/months-elapsed`,
 * which would mark a holiday envelope hopeless every January.
 *
 * `too-early` guards the one place that projection divides by the pace
 * fraction: an envelope entirely weighted to a month not yet reached has
 * `paceExpected === 0`, and nothing can be projected from zero.
 */
export type GoalStatus = 'no-goal' | 'too-early' | 'on-track' | 'at-risk';

export interface EnvelopeCheck {
  readonly envelope: EnvelopeConsumption['envelope'];
  readonly pastPace: boolean;
  readonly goalStatus: GoalStatus;
  /** Year-to-date spend, extrapolated by the seasonal pace fraction. `null` unless a goal exists and it isn't too early to project. */
  readonly projectedFullYear: Cents | null;
}

/**
 * `ok`: a sustainable share of this person's own income.
 * `high`: over three-quarters of it — worth a look before it gets to `exceeds-income`.
 * `exceeds-income`: this person would transfer more than they themselves net — either
 * wrong data (a `transfer_labels` pattern catching the wrong transfer, an income
 * source missing from `sluice.toml`) or the plan has genuinely outgrown the
 * household's income.
 */
export type ShareStatus = 'ok' | 'high' | 'exceeds-income';

export interface PersonCheck {
  readonly personId: string;
  /** This person's own monthly-equivalent net income — `PersonShare.netMonthly`. */
  readonly netMonthly: Cents;
  /** What they actually transfer this month — `PersonShare.amount`. */
  readonly amount: Cents;
  readonly status: ShareStatus;
}

export interface PlanCheck {
  /** Sum of every configured envelope's estimate. */
  readonly plannedTotal: Cents;
  /** Actual net outflow across the trailing 12 months ending on the reference day. */
  readonly trailingYearActual: Cents;
  readonly drift: Cents;
  readonly bufferTarget: Cents;
  /**
   * The most negative single month of real cash flow observed in the whole
   * ledger — never positive: a household whose worst month was still a net
   * gain has a worst drawdown of zero, not the smallest of its gains.
   */
  readonly worstObservedMonth: Cents;
  readonly bufferSufficient: boolean;
  readonly envelopes: readonly EnvelopeCheck[];
  readonly people: readonly PersonCheck[];
}

/**
 * `amount * 4 > netMonthly * 3` rather than `amount > netMonthly * 0.75`:
 * the same reason `allocate()` runs its remainder math in whole units
 * rather than a float — a quarter-point threshold on real income figures
 * has no business going anywhere near IEEE-754 division.
 */
function checkShare(share: PersonShare): PersonCheck {
  const status: ShareStatus =
    share.amount > share.netMonthly ? 'exceeds-income' : share.amount * 4 > share.netMonthly * 3 ? 'high' : 'ok';
  return { personId: share.personId, netMonthly: share.netMonthly, amount: share.amount, status };
}

function checkEnvelope(c: EnvelopeConsumption): EnvelopeCheck {
  const pastPace = c.yearToDateSpent > c.paceExpected;

  if (c.envelope.kind !== 'configured' || c.envelope.config.goal === null) {
    return { envelope: c.envelope, pastPace, goalStatus: 'no-goal', projectedFullYear: null };
  }
  if (c.paceExpected === 0) {
    return { envelope: c.envelope, pastPace, goalStatus: 'too-early', projectedFullYear: null };
  }

  const estimate = c.envelope.config.estimate;
  const projectedFullYear = Math.round((c.yearToDateSpent * estimate) / c.paceExpected);
  const goalStatus: GoalStatus = projectedFullYear <= c.envelope.config.goal ? 'on-track' : 'at-risk';
  return { envelope: c.envelope, pastPace, goalStatus, projectedFullYear };
}

/**
 * Real cash flow per calendar month across the whole ledger — the figure
 * `bufferTarget` has to cover, not the plan.
 *
 * Not a plain sum of `movement` amounts by `occurredOn`: a card purchase is
 * not yet cash leaving the account, its `settlement` is, at `settlesOn` —
 * the same distinction `reconcile.ts` exists to enforce, re-derived here
 * would risk disagreeing with it. Contributions count in the month they
 * *fund* (3a's `contributionsByMonth`), not when they post, for the same
 * reason 3a exists. A `transfer-out` is counted immediately, at
 * `occurredOn`: it is real cash leaving the tracked position the moment it
 * happens, the mirror image of a `transfer-in` funding it.
 */
function netFlowByMonth(config: Config, ledger: Ledger): ReadonlyMap<Month, Cents> {
  const byMonth = new Map<Month, Cents>();
  const add = (month: Month, amount: Cents) => byMonth.set(month, (byMonth.get(month) ?? 0) + amount);

  for (const t of ledger.transactions) {
    if (t.kind === 'movement' && t.source.kind === 'account') add(monthOf(t.occurredOn), t.amount);
    else if (t.kind === 'settlement') add(monthOf(t.settlesOn), t.amount);
    else if (t.kind === 'transfer-out') add(monthOf(t.occurredOn), t.amount);
  }

  for (const monthly of contributionsByMonth(attributeContributions(config, ledger))) {
    add(monthly.month, monthly.total);
  }

  return byMonth;
}

/**
 * How the plan compares to reality, as of `referenceDay`.
 *
 * `consumption` and `shares` are supplied rather than recomputed, so this
 * never disagrees with what sections 01 and 02 are showing at the same
 * moment — all three come from the same call, in `numbers/plan.ts`.
 */
export function checkPlan(
  config: Config,
  ledger: Ledger,
  consumption: readonly EnvelopeConsumption[],
  shares: readonly PersonShare[],
  referenceDay: Day,
): PlanCheck {
  const plannedTotal = consumption.reduce(
    (total, c) => (c.envelope.kind === 'configured' ? total + c.envelope.config.estimate : total),
    0,
  );

  const windowStart = addMonths(monthOf(referenceDay), -11);
  const trailingYearActual = outflow(
    ledger.transactions.filter(
      (t) => t.kind === 'movement' && monthOf(t.occurredOn) >= windowStart && t.occurredOn <= referenceDay,
    ),
  );

  // Floored at zero, the same convention outflow() uses: if every observed
  // month was net-positive, the worst drawdown the buffer ever had to
  // absorb was none at all, not the smallest of several gains.
  const monthly = [...netFlowByMonth(config, ledger).values()];
  const worstObservedMonth = Math.min(0, ...monthly);

  return {
    plannedTotal,
    trailingYearActual,
    drift: trailingYearActual - plannedTotal,
    bufferTarget: config.bufferTarget,
    worstObservedMonth,
    bufferSufficient: config.bufferTarget + worstObservedMonth >= 0,
    envelopes: consumption.map(checkEnvelope),
    people: shares.map(checkShare),
  };
}
