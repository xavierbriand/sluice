import { sum, type Cents } from '../core/money.ts';
import { monthNumber, monthOf, type Day } from '../core/dates.ts';
import type { Config } from '../config/load.ts';
import type { Ledger } from '../ingest/load.ts';
import { resolveEnvelopes } from './envelopes.ts';
import { computeConsumption, type EnvelopeConsumption } from './consumption.ts';
import { computeShares, type PersonShare } from './income.ts';
import { attributeContributions, contributionsByMonth, type MonthlyContributions } from './funding.ts';
import { checkPlan, type PlanCheck } from './checks.ts';
import { auditPlan, type PlanWarning } from './audit.ts';

/** Everything section 01 through 03 of the page renders, computed together so none of it can disagree. */
export interface Plan {
  readonly referenceDay: Day;
  /**
   * What `computeShares` splits across people — exposed directly rather
   * than left for a caller to reconstruct by summing `shares`, even though
   * `allocate()` guarantees that sum equals this exactly. This is the
   * causally prior figure (a requirement, split into shares), not the
   * other way around, and the page's own "why is this month's total what
   * it is" breakdown reads better against the figure it was computed from.
   */
  readonly monthlyRequirement: Cents;
  readonly shares: readonly PersonShare[];
  readonly contributions: readonly MonthlyContributions[];
  readonly consumption: readonly EnvelopeConsumption[];
  readonly check: PlanCheck;
  readonly warnings: readonly PlanWarning[];
}

/**
 * The one function step 4's page calls.
 *
 * `monthlyRequirement` — what `computeShares` splits across people — is this
 * reference month's cell of every configured envelope's `monthlyPlan`,
 * summed. A derived envelope has no plan and contributes nothing: there is
 * no estimate to fund yet, only spending already happening outside any
 * plan, which is what `check.drift` reflects. That spending is *not* the
 * same thing as the audit's `uncategorised-rows` warning — a derived
 * envelope is usually just a category nobody has configured an envelope
 * for yet, while `uncategorised-rows` is specifically the bank's own two
 * "not yet filed" categories; most derived spending triggers no warning at
 * all, only the drift figure.
 */
export function computePlan(config: Config, ledger: Ledger, referenceDay: Day): Plan {
  const resolved = resolveEnvelopes(config, ledger);
  const consumption = computeConsumption(ledger, resolved, referenceDay);

  const monthIndex = monthNumber(monthOf(referenceDay)) - 1;
  const monthlyRequirement = sum(
    consumption.map((c) => (c.monthlyPlan === null ? 0 : (c.monthlyPlan[monthIndex] ?? 0))),
  );

  const shares = computeShares(config.people, monthlyRequirement);
  const contributions = contributionsByMonth(attributeContributions(config, ledger));
  const check = checkPlan(config, ledger, consumption, shares, referenceDay);
  const warnings = auditPlan(config, ledger);

  return { referenceDay, monthlyRequirement, shares, contributions, consumption, check, warnings };
}
