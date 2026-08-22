import { describe, expect, it } from 'vitest';
import type { Day } from '../core/dates.ts';
import { sum } from '../core/money.ts';
import { computePlan } from './plan.ts';
import { ledgerOf, numbersConfig, tx } from './__fixtures__/build.ts';

describe('computePlan', () => {
  it('wires 3a and 3b together end to end, worked by hand', () => {
    // groceries: estimate 1200.00 (120000c), no configured seasonal.
    const config = numbersConfig();
    const ledger = ledgerOf([
      // 2025 (prior year): 100.00 in each of Jan/Feb/Mar — derived shape
      // [10000,10000,10000,0,...,0], sum 30000.
      tx({ id: '25-jan', occurredOn: '2025-01-05', amount: -10000, category: 'Alimentation', subCategory: 'Supermarche' }),
      tx({ id: '25-feb', occurredOn: '2025-02-05', amount: -10000, category: 'Alimentation', subCategory: 'Supermarche' }),
      tx({ id: '25-mar', occurredOn: '2025-03-05', amount: -10000, category: 'Alimentation', subCategory: 'Supermarche' }),
    ]);

    // 120000 split proportionally to [10000,10000,10000,0,...]: each of the
    // first three months gets 120000*10000/30000 = 40000 exactly. Reference
    // day is in March (index 2), so monthlyRequirement = 40000.
    const referenceDay = '2026-03-15' as Day;
    const plan = computePlan(config, ledger, referenceDay);

    expect(plan.referenceDay).toBe(referenceDay);
    expect(plan.monthlyRequirement).toBe(40000);

    // alice 3200.00, bruno 2450.00 net monthly (weight sum 565000):
    // 40000*320000/565000 = 22654.86..., 40000*245000/565000 = 17345.13...
    // — bases 22654 + 17345 = 39999, one cent short, alice's fraction
    // (.867) beats bruno's (.132), so alice gets it.
    expect(plan.shares).toEqual([
      { personId: 'alice', netMonthly: 320000, amount: 22655 },
      { personId: 'bruno', netMonthly: 245000, amount: 17345 },
    ]);
    expect(sum(plan.shares.map((s) => s.amount))).toBe(40000);

    // Nothing else happened in the ledger, so there is nothing to report.
    expect(plan.contributions).toEqual([]);
    expect(plan.consumption).toHaveLength(1);
    expect(plan.consumption[0]?.priorYearActual).toBe(30000);
    expect(plan.check.plannedTotal).toBe(120000);
    expect(plan.warnings.some((w) => w.kind === 'matcher-matches-nothing')).toBe(false);
  });

  it('picks the reference month\'s own cell of the plan, not any month\'s', () => {
    // All 1200.00 lands in June (month index 5) by configured seasonal
    // shape; every other month's cell is 0. A reference day outside June
    // must see a monthlyRequirement of 0, not June's 120000.
    const config = numbersConfig({
      envelopes: `
[envelopes.groceries]
name = "Groceries"
matches = [{ category = "Alimentation", sub_category = "Supermarche" }]
estimate = "1200.00"
seasonal = { months = [6] }
`,
    });
    const ledger = ledgerOf([]);

    const inJanuary = computePlan(config, ledger, '2026-01-15' as Day);
    expect(inJanuary.monthlyRequirement).toBe(0);
    expect(sum(inJanuary.shares.map((s) => s.amount))).toBe(0);

    const inJune = computePlan(config, ledger, '2026-06-15' as Day);
    expect(inJune.monthlyRequirement).toBe(120000);
    expect(sum(inJune.shares.map((s) => s.amount))).toBe(120000);
  });

  it('the monthly requirement excludes derived envelopes — nothing to fund yet', () => {
    // No configured envelopes at all: a configured one contributes its
    // planned amount regardless of whether it happens to have any
    // transactions in this ledger, so the only way to prove derived
    // spending contributes nothing is to have no configured envelope to
    // confound it with.
    const config = numbersConfig({ envelopes: '' });
    const ledger = ledgerOf([
      tx({ occurredOn: '2026-01-05', amount: -50000, category: 'Loisirs et vacances', subCategory: 'Cinema' }),
    ]);
    const plan = computePlan(config, ledger, '2026-06-01' as Day);
    expect(plan.shares.every((s) => s.amount === 0)).toBe(true);
  });

  it('surfaces an audit warning end to end', () => {
    const config = numbersConfig();
    const ledger = ledgerOf([]); // groceries' matcher never fires
    const plan = computePlan(config, ledger, '2026-06-01' as Day);
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ kind: 'matcher-matches-nothing', envelopeId: 'groceries' }),
    );
  });
});
