import { allocate, type Cents } from '../core/money.ts';
import { monthNumber, monthOf, yearOf, type Day } from '../core/dates.ts';
import type { Ledger } from '../ingest/load.ts';
import { outflow, transactionsFor, type ResolvedEnvelope } from './envelopes.ts';
import { resolveSeasonal, FLAT_WEIGHTS, type SeasonalShape } from './seasonal.ts';

export interface EnvelopeConsumption {
  readonly envelope: ResolvedEnvelope;
  /** Net outflow so far this year, as of `referenceDay`. */
  readonly yearToDateSpent: Cents;
  /** Net outflow across the whole of the year before `referenceDay`'s. */
  readonly priorYearActual: Cents;
  /**
   * `allocate(estimate, seasonal.weights)`, twelve cells, January to
   * December — `null` for a derived envelope, which has no estimate to pace
   * against, only a total to show.
   */
  readonly monthlyPlan: readonly Cents[] | null;
  /**
   * `allocate(estimate, FLAT_WEIGHTS)` — the same estimate, spread evenly
   * across the year instead of by `seasonal.weights`. Exists purely as a
   * baseline `monthlyPlan` is measured against: a household looking at one
   * month's requirement has no way to tell "genuinely a heavier month" from
   * "the seasonal shape derived from a partial year of history" without
   * something to compare it to. `null` for a derived envelope, same as
   * `monthlyPlan`.
   */
  readonly flatMonthlyPlan: readonly Cents[] | null;
  /** Cumulative `monthlyPlan` through `referenceDay`'s month, inclusive. */
  readonly paceExpected: Cents;
  /**
   * `max(0, yearToDateSpent - paceExpected)`.
   *
   * For a derived envelope, `paceExpected` is 0 — there is no plan to be
   * "on pace" against — so `overPace` equals `yearToDateSpent` exactly: any
   * spending at all reads as entirely over pace, by construction, not as
   * zero.
   */
  readonly overPace: Cents;
  readonly seasonal: SeasonalShape;
}

/**
 * Every resolved envelope's spending against its plan, as of `referenceDay`.
 *
 * `referenceDay` is a parameter, never computed here — matching `Source` and
 * `Day` themselves, nothing under `src/numbers/` reads the wall clock; that
 * stays at the edge, in step 4. The seasonal shape is derived from the
 * *completed* year before `referenceDay`'s, never the one in progress —
 * there is no full year of the current one to derive it from yet.
 *
 * Sorted the same way `resolveEnvelopes` sorts `resolved`, since this is a
 * one-to-one map over it. Takes `resolved` rather than a `Config`, since
 * everything a configured envelope needs (`estimate`, `seasonal`) already
 * rides along on each entry — nothing here needs the config directly.
 */
export function computeConsumption(
  ledger: Ledger,
  resolved: readonly ResolvedEnvelope[],
  referenceDay: Day,
): readonly EnvelopeConsumption[] {
  const thisYear = yearOf(referenceDay);
  const priorYear = thisYear - 1;
  const referenceMonthIndex = monthNumber(monthOf(referenceDay)) - 1;

  return resolved.map((envelope) => {
    const transactions = transactionsFor(envelope, ledger);

    const yearToDateSpent = outflow(
      transactions.filter((t) => yearOf(t.occurredOn) === thisYear && t.occurredOn <= referenceDay),
    );
    const priorYearActual = outflow(transactions.filter((t) => yearOf(t.occurredOn) === priorYear));

    const seasonal = resolveSeasonal(envelope, transactions, priorYear);
    const monthlyPlan =
      envelope.kind === 'configured' ? allocate(envelope.config.estimate, seasonal.weights) : null;
    const flatMonthlyPlan =
      envelope.kind === 'configured' ? allocate(envelope.config.estimate, FLAT_WEIGHTS) : null;

    const paceExpected =
      monthlyPlan === null
        ? 0
        : monthlyPlan.slice(0, referenceMonthIndex + 1).reduce((a, b) => a + b, 0);
    const overPace = Math.max(0, yearToDateSpent - paceExpected);

    return {
      envelope,
      yearToDateSpent,
      priorYearActual,
      monthlyPlan,
      flatMonthlyPlan,
      paceExpected,
      overPace,
      seasonal,
    };
  });
}
