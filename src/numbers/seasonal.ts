import { monthNumber, monthOf, yearOf } from '../core/dates.ts';
import type { SeasonalWeights } from '../config/load.ts';
import type { Transaction } from '../ingest/ledger.ts';
import { outflow, type ResolvedEnvelope } from './envelopes.ts';

/**
 * Where an envelope's month-by-month shape came from — never left implicit,
 * because a flat marker shown without saying so reads as a real commitment
 * rather than a guess with no history behind it. A holiday envelope with no
 * prior year would otherwise look "over budget" in December for no real
 * reason.
 */
export type SeasonalProvenance = 'configured' | 'derived-from-history' | 'flat-no-history';

export interface SeasonalShape {
  /** Twelve relative weights, January to December. Always sums > 0. */
  readonly weights: SeasonalWeights;
  readonly provenance: SeasonalProvenance;
}

/**
 * Exported so `consumption.ts` can pace a *second* plan against the same
 * estimate — what a month would need if the year were spread flat — as the
 * baseline `monthlyPlan` (paced against whatever `resolveSeasonal` actually
 * returns) is compared to, to make a seasonal skew visible rather than
 * just felt.
 */
export const FLAT_WEIGHTS: SeasonalWeights = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/**
 * The seasonal shape to pace `envelope` against.
 *
 * A configured `seasonal` wins outright. Otherwise, `priorYear`'s own net
 * outflow by month *is* the shape — an insurance premium taken once in June
 * shows up as eleven zeros and one twelve, without anyone declaring it.
 * Falls back to a flat year only when the envelope has no outflow at all in
 * `priorYear` — new spending, or a category that only started this year.
 *
 * Takes `envelope`'s own `movement` transactions directly, rather than a
 * `Ledger` to filter itself — `computeConsumption` already calls
 * `transactionsFor(envelope, ledger)` once for its own year-to-date figures,
 * and re-deriving the same filter here would scan the whole ledger a second
 * time per envelope for no reason.
 */
export function resolveSeasonal(
  envelope: ResolvedEnvelope,
  transactions: readonly Transaction[],
  priorYear: number,
): SeasonalShape {
  if (envelope.kind === 'configured' && envelope.config.seasonal !== null) {
    return { weights: envelope.config.seasonal, provenance: 'configured' };
  }

  const byMonth: Transaction[][] = Array.from({ length: 12 }, () => []);
  for (const t of transactions) {
    if (yearOf(t.occurredOn) !== priorYear) continue;
    byMonth[monthNumber(monthOf(t.occurredOn)) - 1]!.push(t);
  }
  const weights = byMonth.map(outflow);

  if (weights.some((w) => w > 0)) {
    return { weights: weights as unknown as SeasonalWeights, provenance: 'derived-from-history' };
  }
  return { weights: FLAT_WEIGHTS, provenance: 'flat-no-history' };
}
