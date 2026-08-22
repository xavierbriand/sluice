/**
 * Bank dates are calendar dates, not instants. A transaction posted on the 4th
 * is posted on the 4th in every timezone, so nothing here goes near `Date` —
 * constructing one from "2026-08-04" and reading it back in a westward timezone
 * yields the 3rd, which is exactly the class of bug that turns a paid month into
 * a missed one.
 */

/** An ISO calendar date, `YYYY-MM-DD`. */
export type Day = string & { readonly __brand: 'Day' };
/** An ISO calendar month, `YYYY-MM`. */
export type Month = string & { readonly __brand: 'Month' };

// Anchored for the reader's benefit rather than the parser's: `checked` is only
// ever handed a string reassembled from FRENCH's or OFX's own capture groups, so
// the shape is already guaranteed and neither anchor can decide anything. The two
// anchor-removal mutants therefore survive by construction, not by omission, and
// are recorded as equivalent in #299's triage.
//
// They are NOT suppressed with a `Stryker disable` comment. That directive is
// scoped to a whole mutator on a whole line, and `Regex` emits eight mutants
// here: the two anchors plus six that weaken the digit groups (`\d{4}` to `\d`,
// `\d` to `\D`). Those six are killed by every date test in the file, because
// `checked` rejects a date DAY no longer matches. Silencing them to hide two
// unkillable ones would trade real signal for a tidier number.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FRENCH = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const OFX = /^(\d{4})(\d{2})(\d{2})/;

// Error-message prose and `this.name` are left as permanent, deliberate
// survivors across every error class in `src/` — ten of them, this one
// included. Nothing anywhere asserts `err.name`; every catch site matches
// with `instanceof` or `toThrow(SomeErrorClass)`. Mutating a sentence like
// the one below only tests whether some assertion happens to regex a
// fragment of it, which is the reason #323 excluded string mutation in
// `src/config` in the first place — the same reasoning applies here, just
// not worth a `Stryker disable` directive for every line it touches. Filed
// as a decision on #328, not re-triaged per class.
export class DateParseError extends Error {
  readonly raw: string;
  readonly where: string;

  constructor(raw: string, where: string) {
    super(`Cannot read "${raw}" as a date (${where})`);
    this.name = 'DateParseError';
    this.raw = raw;
    this.where = where;
  }
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/**
 * Validated against the real length of the month, not a flat 31.
 *
 * A bank will not emit the 31st of February, so this guards a file that has been
 * corrupted or hand-edited rather than the everyday case. It is here because
 * everything else in the ingest refuses what it cannot read exactly, and a date
 * silently admitted as valid would be carried into a month bucket and shift a
 * total without ever looking wrong.
 */
function checked(iso: string, raw: string, where: string): Day {
  if (!DAY.test(iso)) throw new DateParseError(raw, where);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  // No separate month-range check. `daysInMonth` returns 0 for any month outside
  // 1..12 — see the `?? 0` there, which `noUncheckedIndexedAccess` requires — so
  // the day check below already refuses every such date. A `month < 1 || month > 12`
  // guard used to sit here and could not be killed by any mutant, because it had
  // no observable effect: verified exhaustively over the entire domain `DAY`
  // admits — year 0000..9999, month and day each 00..99, all 100,000,000
  // combinations run through both versions of `checked` — zero inputs where the
  // guard changed the outcome.
  //
  // That makes `daysInMonth`'s out-of-range return load-bearing rather than
  // incidental. `dates.test.ts` pins it directly; if that ever becomes `?? 31`,
  // the pin fails rather than this file silently admitting month 13.
  if (day < 1 || day > daysInMonth(year, month)) throw new DateParseError(raw, where);
  return iso as Day;
}

/** `14/08/2026` → `2026-08-14`. The CSV format. */
export function parseFrenchDay(raw: string, where = 'date'): Day {
  const m = FRENCH.exec(raw.trim());
  if (!m) throw new DateParseError(raw, where);
  return checked(`${m[3]}-${m[2]}-${m[1]}`, raw, where);
}

/** `20260814` or `20260814120000[+1:CET]` → `2026-08-14`. The OFX format. */
export function parseOfxDay(raw: string, where = 'date'): Day {
  const m = OFX.exec(raw.trim());
  if (!m) throw new DateParseError(raw, where);
  return checked(`${m[1]}-${m[2]}-${m[3]}`, raw, where);
}

export function monthOf(day: Day): Month {
  return day.slice(0, 7) as Month;
}

export function yearOf(day: Day | Month): number {
  return Number(day.slice(0, 4));
}

/** 1-12. */
export function monthNumber(month: Month): number {
  return Number(month.slice(5, 7));
}

export function makeMonth(year: number, month1to12: number): Month {
  return `${year}-${String(month1to12).padStart(2, '0')}` as Month;
}

export function dayOfMonth(day: Day): number {
  return Number(day.slice(8, 10));
}

export function addMonths(month: Month, delta: number): Month {
  const total = yearOf(month) * 12 + (monthNumber(month) - 1) + delta;
  return makeMonth(Math.floor(total / 12), (total % 12) + 1);
}

/** Inclusive range of months, ascending. */
export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatMonthShort(month: Month): string {
  return MONTH_NAMES[monthNumber(month) - 1] ?? month;
}

export function formatMonthLong(month: Month): string {
  return `${formatMonthShort(month)} ${yearOf(month)}`;
}
