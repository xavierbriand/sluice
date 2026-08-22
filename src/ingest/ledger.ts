import type { Cents } from '../core/money.ts';
import type { Day } from '../core/dates.ts';
import type { JoinedRow } from './join.ts';
import type { Source } from './sources.ts';

/**
 * One account or card, as assembled from however many exports describe it.
 *
 * Deliberately not "one statement". Dropping two overlapping exports of the same
 * account into the folder must not change any total, and a per-file view breaks
 * that in a way transaction de-duplication cannot fix: balances are not rows, so
 * summing one per file counts the same cash twice.
 */
export interface LoadedSource {
  readonly source: Source;
  /** Widest window across every export of this source. */
  readonly from: Day;
  readonly to: Day;
  /**
   * The most recently reported closing balance for this source.
   *
   * A balance is a fact about an instant, so overlapping exports do not combine:
   * the newest one simply supersedes the others.
   */
  readonly balance: Cents;
  readonly balanceAsOf: Day;
  /** How many rows of the merged ledger came from this source. */
  readonly count: number;
  /** Every file this source was assembled from, for error messages. */
  readonly files: readonly string[];
}

/** Everything the ingest produces before it checks itself. */
export interface LedgerData {
  readonly transactions: readonly Transaction[];
  readonly sources: readonly LoadedSource[];
}

/**
 * One transaction, after the OFX and CSV views of it have been reconciled.
 *
 * `kind` is the structural classification, and it is the load-bearing part of
 * the ingest. Getting it wrong does not crash anything; it produces a page of
 * confident, wrong numbers.
 */
export type TransactionKind =
  /** A deferred card's monthly charge to the account. Never spending — the
   *  itemised card rows already are. Counting both doubles a third of the year. */
  | 'settlement'
  /** Money arriving from another account of the household's own. The funding side. */
  | 'transfer-in'
  /** Money leaving to another account of the household's own. */
  | 'transfer-out'
  /** Everything else: what was actually spent, and what was refunded against it. */
  | 'movement';

export interface Transaction {
  /** Unique across the whole ledger: source id plus the bank's row id. */
  readonly id: string;
  readonly source: Source;
  readonly kind: TransactionKind;
  /** When it happened. A card purchase is dated here, not when it settles. */
  readonly occurredOn: Day;
  /** When the current account is actually charged. Differs from `occurredOn`
   *  on a deferred card by up to a month, which is the in-flight window. */
  readonly settlesOn: Day;
  /** Negative leaves the household, positive arrives. */
  readonly amount: Cents;
  readonly label: string;
  readonly description: string;
  readonly notes: string;
  readonly operationType: string;
  readonly category: string;
  readonly subCategory: string;
}

/**
 * The bank's own marker for a deferred card's monthly charge.
 *
 * Note it lives under a *parent* category that also contains every internal
 * transfer — so filtering on the parent, which is the obvious thing to do and
 * what an earlier draft of the spec implied, deletes the entire funding side of
 * the household along with the settlements. The sub-category is the filter.
 */
export const SETTLEMENT_SUBCATEGORY = 'Transaction differee';
export const INTERNAL_TRANSFER_SUBCATEGORY = 'Virement interne';

function classify(row: JoinedRow): TransactionKind {
  const sub = row.csv.subCategory;
  if (sub === SETTLEMENT_SUBCATEGORY) return 'settlement';
  if (sub === INTERNAL_TRANSFER_SUBCATEGORY) {
    return row.csv.amount >= 0 ? 'transfer-in' : 'transfer-out';
  }
  return 'movement';
}

export function toTransactions(rows: readonly JoinedRow[], source: Source): Transaction[] {
  return rows.map((row) => ({
    id: `${source.id}:${row.ofx.fitId}`,
    source,
    kind: classify(row),
    occurredOn: row.csv.postedOn,
    settlesOn: row.csv.valueOn,
    amount: row.csv.amount,
    label: row.csv.label,
    description: row.csv.description,
    notes: row.csv.notes,
    operationType: row.csv.operationType,
    category: row.csv.category,
    subCategory: row.csv.subCategory,
  }));
}

// Prose and `this.name` deliberately left surviving — see CLAUDE.md.
export class DuplicateTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateTransactionError';
  }
}

/** One export's worth of transactions, tagged with when that export was taken. */
export interface LedgerBatch {
  readonly transactions: readonly Transaction[];
  /** The export's own closing-balance date — when the bank says this view is current. */
  readonly asOf: Day;
}

/**
 * Merge sources into one ledger, keyed on `id`.
 *
 * Re-importing an overlapping export must change no total, which is what the key
 * is for. Where two exports disagree about a row, the newer one is believed —
 * the same rule `consolidate` applies to balances, for the same reason.
 */
export function mergeLedger(batches: readonly LedgerBatch[]): Transaction[] {
  const byId = new Map<string, Transaction>();

  // Oldest export first, so that when the same row appears twice the newer copy
  // is the one left standing. Ordering by the export's own as-of date rather
  // than by filename matters: the bank stamps files `_DDMMYYYY_DDMMYYYY`, and
  // sorting those as text compares the day before the month, so `01012026`
  // sorts before `01122025` and "first read" is not "oldest".
  const ordered = [...batches].sort((a, b) => a.asOf.localeCompare(b.asOf));

  for (const batch of ordered) {
    // De-duplication is only ever meaningful *between* statements, where the
    // same row genuinely appears twice. Within one statement, two rows sharing
    // an id are two transactions the bank labelled alike — collapsing them
    // deletes real money, and it does so most easily in the case hardest to
    // notice: same day, same amount, a repeated purchase.
    const seenInBatch = new Set<string>();

    for (const t of batch.transactions) {
      if (seenInBatch.has(t.id)) {
        throw new DuplicateTransactionError(
          `"${t.id}" appears twice in one statement, on ${t.occurredOn}. Within a ` +
            `single export every row carries its own id, so these are two ` +
            `transactions rather than one imported twice, and merging them would ` +
            `silently drop one.`,
        );
      }
      seenInBatch.add(t.id);

      const existing = byId.get(t.id);
      if (existing !== undefined) {
        // Amount and date identify the transaction itself. If those differ, the
        // two rows are not one row seen twice, whatever the bank's id says, and
        // silently keeping either would drop real money.
        //
        // `source.id` is deliberately not compared: it is already the prefix of
        // `t.id`, so it cannot differ here.
        const sameTransaction =
          existing.amount === t.amount && existing.occurredOn === t.occurredOn;
        if (!sameTransaction) {
          throw new DuplicateTransactionError(
            `Two different transactions share the id "${t.id}": ` +
              `${existing.occurredOn} vs ${t.occurredOn}. The bank's row ids are only ` +
              `unique within one exported statement, so this means two statements are ` +
              `being treated as the same source.`,
          );
        }
      }

      // The newer export wins, and wins wholesale.
      //
      // Everything else on the row — category, sub-category, value date, label —
      // is the bank's current view of a transaction it has already identified,
      // and the user changes exactly those fields by re-filing a transaction at
      // the bank and exporting again. Keeping the first copy read would throw
      // that correction away and, when the correction is to a sub-category,
      // silently move the row between spending and internal transfer.
      byId.set(t.id, t);
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.occurredOn === b.occurredOn ? a.id.localeCompare(b.id) : a.occurredOn.localeCompare(b.occurredOn),
  );
}
