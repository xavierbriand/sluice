import { describe, expect, it } from 'vitest';
import {
  addMonths,
  DateParseError,
  dayOfMonth,
  formatMonthLong,
  makeMonth,
  monthOf,
  monthRange,
  parseFrenchDay,
  parseOfxDay,
  type Day,
  type Month,
} from './dates.ts';

describe('parseFrenchDay', () => {
  it('reads the CSV’s DD/MM/YYYY', () => {
    expect(parseFrenchDay('14/08/2026')).toBe('2026-08-14');
    expect(parseFrenchDay('01/02/2026')).toBe('2026-02-01');
  });

  it('does not silently swap day and month', () => {
    // 04/09 is 4 September, not 9 April. Getting this backwards would move a
    // card settlement by five months and still look plausible.
    expect(parseFrenchDay('04/09/2026')).toBe('2026-09-04');
  });

  it('refuses impossible dates', () => {
    expect(() => parseFrenchDay('32/01/2026')).toThrow(DateParseError);
    expect(() => parseFrenchDay('01/13/2026')).toThrow(DateParseError);
    expect(() => parseFrenchDay('2026-08-14')).toThrow(DateParseError);
  });

  it('pins daysInMonth\'s fallback for an out-of-range month at 0, not a real length', () => {
    // Not a test of "there is no month guard" — reinstating one would leave
    // every assertion here passing exactly as easily, since a guard and this
    // fallback both refuse the same inputs. What this pins is narrower and
    // more load-bearing: `checked` has no separate month-range check, so it
    // relies on `daysInMonth` returning `0` for a month outside 1..12 — that
    // `?? 0` is what makes `day > 0` refuse the date one line later. If that
    // fallback ever became `?? 31` instead, month 99 would be treated as a
    // 31-day month and admitted as a real date. Verified: it does fail under
    // that change, unlike the test's former name suggested. The OFX equivalent
    // is in `describe('parseOfxDay')`, below.
    expect(() => parseFrenchDay('01/00/2026')).toThrow(DateParseError);
    expect(() => parseFrenchDay('01/99/2026')).toThrow(DateParseError);
  });

  it('refuses a day the month does not have', () => {
    expect(() => parseFrenchDay('31/02/2026')).toThrow(DateParseError);
    expect(() => parseFrenchDay('31/04/2026')).toThrow(DateParseError);
    expect(() => parseFrenchDay('31/09/2026')).toThrow(DateParseError);
  });

  it('knows which Februaries have 29 days', () => {
    expect(parseFrenchDay('29/02/2024')).toBe('2024-02-29');
    expect(parseFrenchDay('29/02/2000')).toBe('2000-02-29');
    expect(() => parseFrenchDay('29/02/2026')).toThrow(DateParseError);
    // Divisible by 100 but not 400 — a common year despite being divisible by 4.
    expect(() => parseFrenchDay('29/02/1900')).toThrow(DateParseError);
  });

  it('accepts the last day of every month, in a leap year as well as a common one', () => {
    const lastDays = ['31/01', '28/02', '31/03', '30/04', '31/05', '30/06',
                      '31/07', '31/08', '30/09', '31/10', '30/11', '31/12'];
    for (const d of lastDays) expect(() => parseFrenchDay(`${d}/2026`)).not.toThrow();

    // The leap year is the half that matters. Checking only a common year
    // leaves the February branch of `daysInMonth` free to apply to every other
    // month: widen its condition and 2026 is unaffected, because 2026 is not a
    // leap year at all. In 2024 that same widening returns 29 days for January,
    // and `31/01/2024` — a real date — starts being refused.
    const leapLastDays = ['31/01', '29/02', '31/03', '30/04', '31/05', '30/06',
                          '31/07', '31/08', '30/09', '31/10', '30/11', '31/12'];
    for (const d of leapLastDays) expect(() => parseFrenchDay(`${d}/2024`)).not.toThrow();
  });

  it('refuses day zero', () => {
    expect(() => parseFrenchDay('00/01/2026')).toThrow(DateParseError);
  });

  it('refuses a date carrying anything but the date', () => {
    // The pattern is anchored at both ends. Unanchored, a label that merely
    // *contains* something date-shaped would parse, and the surrounding text
    // would be silently discarded rather than refused.
    expect(() => parseFrenchDay('x14/08/2026')).toThrow(DateParseError);
    expect(() => parseFrenchDay('14/08/2026x')).toThrow(DateParseError);
  });

  it('tolerates surrounding whitespace', () => {
    // Exports have been seen with padded cells. Trimming is deliberate, so it
    // is asserted rather than left to chance.
    expect(parseFrenchDay('  14/08/2026  ')).toBe('2026-08-14');
  });

  it('names the field "date" when no caller says otherwise', () => {
    // Every real caller passes its own `where`; only the default had gone
    // unpinned.
    expect(() => parseFrenchDay('not-a-date')).toThrow(/\(date\)/);
  });
});

describe('parseOfxDay', () => {
  it('reads a bare YYYYMMDD', () => {
    expect(parseOfxDay('20260814')).toBe('2026-08-14');
  });

  it('ignores the time and timezone suffix OFX may append', () => {
    expect(parseOfxDay('20260815171313')).toBe('2026-08-15');
    expect(parseOfxDay('20260815120000[+1:CET]')).toBe('2026-08-15');
  });

  it('refuses something that is not a date at all', () => {
    // The OFX pattern is unanchored at its tail on purpose, to skip the time
    // and timezone suffix. That makes the no-match path the only thing standing
    // between a malformed export and a silently wrong month bucket.
    expect(() => parseOfxDay('not-a-date')).toThrow(DateParseError);
    expect(() => parseOfxDay('')).toThrow(DateParseError);
    expect(() => parseOfxDay('2026')).toThrow(DateParseError);
  });

  it('pins daysInMonth\'s fallback for an out-of-range month at 0, not a real length', () => {
    // The OFX counterpart to the identically-named test under parseFrenchDay,
    // above — see the comment there for what this actually protects.
    expect(() => parseOfxDay('20260013')).toThrow(DateParseError);
    expect(() => parseOfxDay('20269913')).toThrow(DateParseError);
  });

  it('refuses day zero', () => {
    expect(() => parseOfxDay('20260100')).toThrow(DateParseError);
  });

  it('refuses a date preceded by anything else', () => {
    // Anchored at the front only — the tail is left open on purpose, for the
    // time and timezone suffix above. A leading character still has to be
    // refused, or a label merely containing something date-shaped would parse.
    expect(() => parseOfxDay('x20260814')).toThrow(DateParseError);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseOfxDay('  20260814  ')).toBe('2026-08-14');
  });

  it('is timezone-independent by construction', () => {
    // A calendar date is not an instant. Round-tripping through Date would
    // return the 3rd west of UTC, turning a paid month into a missed one.
    expect(parseOfxDay('20260804')).toBe('2026-08-04');
  });

  it('names the field "date" when no caller says otherwise', () => {
    expect(() => parseOfxDay('not-a-date')).toThrow(/\(date\)/);
  });
});

describe('month arithmetic', () => {
  const aug26 = '2026-08' as Month;

  it('extracts the month of a day', () => {
    expect(monthOf('2026-08-14' as Day)).toBe('2026-08');
  });

  it('rolls over a year boundary in both directions', () => {
    expect(addMonths('2025-12' as Month, 1)).toBe('2026-01');
    expect(addMonths('2026-01' as Month, -1)).toBe('2025-12');
    expect(addMonths(aug26, -12)).toBe('2025-08');
    expect(addMonths(aug26, 5)).toBe('2027-01');
  });

  it('builds an inclusive ascending range', () => {
    expect(monthRange('2025-11' as Month, '2026-02' as Month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('returns a single month when both ends are equal', () => {
    expect(monthRange(aug26, aug26)).toEqual(['2026-08']);
  });

  it('reads the day of the month, which decides which month a transfer funds', () => {
    expect(dayOfMonth('2026-05-28' as Day)).toBe(28);
  });

  it('formats a month for a chart label', () => {
    expect(formatMonthLong(makeMonth(2026, 8))).toBe('Aug 2026');
  });

  it('names every month, not just the ones spot-checked elsewhere', () => {
    // MONTH_NAMES is rendered straight onto the page. A reordered or
    // corrupted entry would be a confident wrong month beside a correct
    // figure — one assertion over all twelve closes every entry at once.
    const names = monthRange(makeMonth(2026, 1), makeMonth(2026, 12)).map(formatMonthLong);
    expect(names).toEqual([
      'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026',
      'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026',
    ]);
  });
});
