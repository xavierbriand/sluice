import type { CsvRow } from './csv.ts';
import type { OfxStatement, OfxTransaction } from './ofx.ts';
import { formatEurSigned } from '../core/money.ts';

/**
 * Join the CSV onto the OFX **positionally**.
 *
 * Both files are the same ledger, exported by the same system in the same order,
 * and across every export observed the positional join matched every row of
 * every file exactly. The earlier design joined on (date, amount) instead, which
 * is ambiguous whenever a day carries two identical amounts — a coffee bought
 * twice, two transfers of a round number.
 *
 * Position is the stronger key, but only while the ordering holds. So it is not
 * trusted: at each position the date and the amount must agree between the two
 * files, and a disagreement throws. If the bank ever changes its ordering, this
 * fails immediately and loudly rather than shifting every category by one row —
 * which would produce a page full of plausible, wrong numbers.
 */

export interface JoinedRow {
  readonly ofx: OfxTransaction;
  readonly csv: CsvRow;
}

// Prose and `this.name` deliberately left surviving — see the comment on
// DateParseError in src/core/dates.ts.
export class JoinMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JoinMismatchError';
  }
}

export function joinPositionally(
  statement: OfxStatement,
  csvRows: readonly CsvRow[],
  sourceId: string,
): JoinedRow[] {
  const ofxRows = statement.transactions;

  if (ofxRows.length !== csvRows.length) {
    throw new JoinMismatchError(
      `${sourceId}: the OFX export has ${ofxRows.length} transactions and the CSV ` +
        `has ${csvRows.length}. They must be exports of the same date range — ` +
        `re-export both over identical dates.`,
    );
  }

  return ofxRows.map((ofx, i) => {
    // Length is checked above, so this index is populated.
    const csv = csvRows[i]!;

    if (ofx.postedOn !== csv.postedOn) {
      throw new JoinMismatchError(
        `${sourceId}: row ${i + 1} is dated ${ofx.postedOn} in the OFX but ` +
          `${csv.postedOn} in the CSV (CSV line ${csv.line}). The two exports are ` +
          `no longer in the same order, so categories cannot be matched to ` +
          `transactions. This is a change in the bank's export, not bad data.`,
      );
    }
    if (ofx.amount !== csv.amount) {
      throw new JoinMismatchError(
        `${sourceId}: row ${i + 1} on ${ofx.postedOn} is ` +
          `${formatEurSigned(ofx.amount)} in the OFX but ${formatEurSigned(csv.amount)} ` +
          `in the CSV (CSV line ${csv.line}). The two exports are no longer in the ` +
          `same order.`,
      );
    }

    return { ofx, csv };
  });
}
