import { describe, expect, it } from 'vitest';
import {
  AmountParseError,
  allocate,
  formatEur,
  formatEurCompact,
  formatEurSigned,
  parseAmount,
  sum,
} from './money.ts';

/**
 * French grouping uses a narrow no-break space (U+202F), and which space ICU
 * picks is a detail of the platform's locale data, not of this code. Normalise
 * it so the tests assert the formatting decisions sluice actually makes.
 */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('parseAmount', () => {
  it('reads the bank’s comma decimals as cents', () => {
    expect(parseAmount('-21,51')).toBe(-2151);
    expect(parseAmount('+4500,00')).toBe(450000);
    expect(parseAmount('8,90')).toBe(890);
  });

  it('reads the dot decimals the OFX uses', () => {
    expect(parseAmount('-1621.51')).toBe(-162151);
    expect(parseAmount('+264.21')).toBe(26421);
  });

  it('ignores thousands separators, including the non-breaking kinds', () => {
    expect(parseAmount('1 234,56')).toBe(123456);
    expect(parseAmount('1 234,56')).toBe(123456);
    expect(parseAmount('1 234,56')).toBe(123456);
  });

  it('treats an empty cell as zero, because debit and credit share a row', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('   ')).toBe(0);
  });

  it('pads a single decimal place rather than dropping it', () => {
    expect(parseAmount('3,5')).toBe(350);
  });

  it('reads a whole-euro amount with no decimal part at all', () => {
    // `AMOUNT` makes the decimals optional, and the `frac = ''` default for the
    // missing fraction was reached by no test — a whole-euro cell would have
    // been the one shape nothing here had ever parsed. (`whole`'s default is
    // dead code, not exercised by this: `split` always returns a first
    // element. See the note beside the destructuring in money.ts.)
    expect(parseAmount('42')).toBe(4200);
    expect(parseAmount('-42')).toBe(-4200);
    expect(parseAmount('0')).toBe(0);
  });

  it('does not turn a negative-zero cell into a negative amount', () => {
    // "-0,00" is a real cell a bank can emit for a zero-value adjustment row.
    // `negative ? -cents : cents` with cents = 0 produces -0, which is a
    // distinct value from +0 under `Object.is` even though `-0 === 0`. Pinned
    // here because it is exactly the shape `formatEurSigned` has to guard
    // against — see the corresponding test there.
    expect(Object.is(parseAmount('-0'), -0)).toBe(true);
    expect(Object.is(parseAmount('-0,00'), -0)).toBe(true);
  });

  it('refuses anything it cannot read exactly', () => {
    expect(() => parseAmount('12,345')).toThrow(AmountParseError);
    expect(() => parseAmount('n/a')).toThrow(AmountParseError);
    expect(() => parseAmount('1.234,56')).toThrow(AmountParseError);
  });

  it('names where the bad value came from', () => {
    expect(() => parseAmount('oops', 'export.csv:42 Debit')).toThrow(/export\.csv:42 Debit/);
  });

  it('names the field "amount" when no caller says otherwise', () => {
    // Every real caller passes its own `where`; only the default had gone
    // unpinned.
    expect(() => parseAmount('n/a')).toThrow(/\(amount\)/);
  });
});

describe('sum', () => {
  it('stays exact over many rows, which float arithmetic would not', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; in cents it is just 10+20.
    const cents = [10, 20, 30];
    expect(sum(cents)).toBe(60);

    const many = Array.from({ length: 1000 }, () => 1049);
    expect(sum(many)).toBe(1_049_000);
  });
});

describe('allocate', () => {
  it('always sums back to the total, even when the weights do not divide it evenly', () => {
    // 1000 / 3 = 333.33... per weight; three independent roundings would land
    // on 999 or 1002 depending on which way each one rounds.
    expect(sum(allocate(1000, [1, 1, 1]))).toBe(1000);
  });

  it('breaks a tie by position, not by chance', () => {
    // Three equal weights over 100 cents: each floors to 33, and the one cent
    // left over has three equally good claimants. Which one gets it has to be
    // decided, not left to the sort's behaviour on equal keys — otherwise the
    // same household split could move a cent between two people between runs,
    // or between two machines.
    //
    // This pins the contract; it does not kill a mutant. The three survivors on
    // that comparator turn out to be equivalent — see the note beside it in
    // money.ts. The tie behaviour is still worth stating, because it is the part
    // a reader would otherwise assume rather than know.
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(101, [1, 1, 1])).toEqual([34, 34, 33]);
    // Equal remainders across unequal positions: the earlier index wins.
    expect(allocate(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
  });

  it('gives the spare cent to the largest remainder, not the smallest', () => {
    // Every other case in this file either ties every remainder or happens to
    // put the largest one at index 0, so none of them can tell a descending
    // sort from an ascending one — a comparator that hands out the cent by
    // smallest remainder first would pass all of them. 1000 split [1, 2]:
    // shares are 333.33 and 666.67, both floor to 333/666, and the spare cent
    // belongs to the second share, not the first.
    expect(allocate(1000, [1, 2])).toEqual([333, 667]);
  });

  it('splits proportionally to the weights, worked by hand', () => {
    // weight sum 3: shares are 666.67 and 333.33. Both floor to 666/333 = 999,
    // and the one cent left over goes to the larger fractional remainder — the
    // 2-weight, at 0.67 against 0.33.
    expect(allocate(1000, [2, 1])).toEqual([667, 333]);
  });

  it('splits an exact ratio with nothing left to distribute', () => {
    expect(allocate(10000, [3, 1])).toEqual([7500, 2500]);
  });

  it('breaks an exact tie by index, deterministically', () => {
    // weight sum 5, share 2.2 each: every fractional remainder is exactly 0.2,
    // so the tie-break is what decides which weight gets the spare cent.
    expect(allocate(11, [1, 1, 1, 1, 1])).toEqual([3, 2, 2, 2, 2]);
  });

  it('gives every weight zero when the total is zero', () => {
    expect(allocate(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it('gives a zero weight nothing, without breaking the split for the rest', () => {
    // Distinct from "all weights zero", which is refused: one weight can
    // legitimately be zero (a person with no income this month) so long as
    // the others still sum positive.
    expect(allocate(100, [1, 0])).toEqual([100, 0]);
  });

  it('refuses a negative total', () => {
    expect(() => allocate(-100, [1, 1])).toThrow(/non-negative/);
  });

  it('refuses weights that are all zero', () => {
    expect(() => allocate(100, [0, 0])).toThrow(/non-negative and sum to more than zero/);
  });

  it('refuses a negative weight, even when the weights still sum positive', () => {
    // Sum is 4, not <= 0 — isolates the negative-weight check from the
    // all-zero-sum one, which [1, -1] (summing to 0) would not.
    expect(() => allocate(100, [5, -1])).toThrow(/non-negative and sum to more than zero/);
  });
});

describe('formatEur', () => {
  it('puts negatives in parentheses rather than using a minus sign', () => {
    expect(formatEur(-802500)).toMatch(/^\(.*\)$/);
    expect(formatEur(-802500)).not.toContain('-');
  });

  it('leaves positives bare', () => {
    expect(formatEur(802500)).not.toContain('(');
  });

  it('always shows both cents', () => {
    expect(formatEur(26421)).toContain('264,21');
    expect(plain(formatEur(500000))).toContain('5 000,00');
  });

  it('renders zero without parentheses', () => {
    expect(formatEur(0)).not.toContain('(');
  });
});

describe('formatEurCompact', () => {
  it('drops the cents for axis labels', () => {
    expect(plain(formatEurCompact(843434))).toBe('8 434 €');
  });

  it('never renders a negative zero', () => {
    // Rounding the signed value gives -0 for anything under half a euro, which
    // Intl renders with a minus sign: an axis tick reading "-0 €".
    expect(formatEurCompact(-49)).toBe('0 €');
    expect(formatEurCompact(-1)).toBe('0 €');
    expect(formatEurCompact(0)).toBe('0 €');
  });

  it('rounds symmetrically across zero', () => {
    // Math.round breaks ties toward +∞, so the same half-euro rounded up in one
    // direction and down in the other: -150 became -1 while +150 became 2.
    expect(plain(formatEurCompact(150))).toBe('2 €');
    expect(plain(formatEurCompact(-150))).toBe('-2 €');
    expect(plain(formatEurCompact(50))).toBe('1 €');
    expect(plain(formatEurCompact(-50))).toBe('-1 €');
  });
});

describe('formatEurSigned', () => {
  // Used on the page's stat tiles and in reconciliation error messages, and
  // until now reached by tests only incidentally, through a `join.ts` message
  // that asserts a different part of the string. Its whole body could be
  // deleted, or its division turned into a multiplication, with the suite green.
  it('renders a plain signed amount, no parentheses', () => {
    expect(plain(formatEurSigned(802500))).toBe('8 025,00 €');
    expect(plain(formatEurSigned(-802500))).toBe('-8 025,00 €');
    expect(plain(formatEurSigned(0))).toBe('0,00 €');
  });

  it('scales cents to euros, not the other way round', () => {
    // A hundredfold error here is not obviously wrong on a page of large
    // numbers, which is exactly why it needs pinning.
    expect(plain(formatEurSigned(1))).toBe('0,01 €');
    expect(plain(formatEurSigned(100))).toBe('1,00 €');
  });

  it('never renders a negative zero', () => {
    // `-0` is reachable — parseAmount returns it for a bank cell of "-0,00" —
    // and `-0 / 100` is still -0, which Intl renders as "-0,00 €" on a value
    // that is exactly zero, the same hazard formatEurCompact guards against
    // above. A signed stat tile showing a minus sign on nothing would be the
    // wrong kind of alarming.
    expect(plain(formatEurSigned(-0))).toBe('0,00 €');
  });

  it('differs from formatEur precisely in how it shows a negative', () => {
    expect(plain(formatEur(-802500))).toBe('(8 025,00 €)');
    expect(plain(formatEurSigned(-802500))).toBe('-8 025,00 €');
  });
});
