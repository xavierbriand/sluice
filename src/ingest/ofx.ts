import { parseAmount, type Cents } from '../core/money.ts';
import { parseOfxDay, type Day } from '../core/dates.ts';

/**
 * The bank's OFX export (SGML, version 102 — tags are opened and not always
 * closed, so this is deliberately a tag scanner and not an XML parser).
 *
 * OFX is the spine of the ingest because it is the only export that carries a
 * bank-assigned id per row, and because it carries the closing balance — which
 * turns out to matter more than the id. See `LEDGERBAL` below.
 */

export interface OfxTransaction {
  readonly type: string;
  readonly postedOn: Day;
  readonly amount: Cents;
  /**
   * The bank's id for the row.
   *
   * NOT globally unique, and not even unique per `accountId`: every card
   * statement from this bank is filed under one shared account id, and the ids
   * restart per statement, so two different cards genuinely collide on
   * (accountId, fitId). The unique key has to include which *file* the row came
   * from — see `sourceOf` in `sources.ts`.
   */
  readonly fitId: string;
  readonly name: string;
  readonly memo: string;
}

export interface OfxStatement {
  /** As reported inside the file. Shared across all card statements — see above. */
  readonly accountId: string;
  readonly currency: string;
  readonly from: Day;
  readonly to: Day;
  /**
   * Closing balance as of `to`.
   *
   * On the current account this is the real cash position. On a deferred-debit
   * card it is the balance not yet charged to the account — money already spent
   * that the account has not been asked for yet. The two must be read together:
   * a healthy-looking current account with large unsettled card balances behind
   * it is not healthy.
   */
  readonly balance: Cents;
  readonly balanceAsOf: Day;
  readonly transactions: readonly OfxTransaction[];
}

// Prose and `this.name` deliberately left surviving — see CLAUDE.md.
export class OfxFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfxFormatError';
  }
}

/** Read an SGML leaf value: `<TAG>value` up to end of line or the next tag. */
function leaf(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^\\r\\n<]*)`).exec(block);
  return m?.[1]?.trim();
}

function required(block: string, tag: string, filename: string): string {
  const v = leaf(block, tag);
  if (v === undefined || v === '') {
    throw new OfxFormatError(`${filename}: <${tag}> is missing`);
  }
  return v;
}

export function parseOfx(bytes: Uint8Array, filename = 'export.ofx'): OfxStatement {
  // CHARSET:1252 in the header; latin-1 covers the accented characters the bank
  // actually emits and never throws on an unexpected byte.
  const text = new TextDecoder('iso-8859-1').decode(bytes);

  if (!text.includes('<OFX>')) {
    throw new OfxFormatError(`${filename}: no <OFX> element — is this an OFX export?`);
  }

  // `preamble`'s default can never run: `String.prototype.split` always
  // returns at least one element, so destructuring the first one out of the
  // result never falls through to a default. It exists only to satisfy
  // `noUncheckedIndexedAccess` — the same shape as `money.ts`'s documented
  // `whole = '0'`. The split token itself, `'<STMTTRN>'`, is a real
  // format-contract string and is tested below.
  const [preamble = '', ...txBlocks] = text.split('<STMTTRN>');

  const transactions = txBlocks.map((block, i) => {
    const where = `${filename} transaction ${i + 1}`;
    return {
      type: leaf(block, 'TRNTYPE') ?? '',
      postedOn: parseOfxDay(required(block, 'DTPOSTED', where), where),
      amount: parseAmount(required(block, 'TRNAMT', where), where),
      fitId: required(block, 'FITID', where),
      name: leaf(block, 'NAME') ?? '',
      memo: leaf(block, 'MEMO') ?? '',
    };
  });

  // A statement with no transactions is ordinary, not broken: a card that was
  // replaced part-way through the year has no activity in a window that starts
  // after it was retired. Refusing the file would take the whole ledger down
  // with it, and the balance it still reports is worth reading.
  //
  // With no transactions the balance block never gets split off, so it stays in
  // the preamble; with transactions it lands in the final fragment.
  const tail = txBlocks.at(-1) ?? preamble;
  const balanceAt = tail.indexOf('<LEDGERBAL>');
  if (balanceAt === -1) {
    throw new OfxFormatError(
      `${filename}: no <LEDGERBAL> — sluice needs the closing balance to tell ` +
        `the account's cash position from its unsettled card spending.`,
    );
  }
  const balanceBlock = tail.slice(balanceAt);

  return {
    accountId: required(preamble, 'ACCTID', filename),
    currency: leaf(preamble, 'CURDEF') ?? 'EUR',
    from: parseOfxDay(required(preamble, 'DTSTART', filename), `${filename} DTSTART`),
    to: parseOfxDay(required(preamble, 'DTEND', filename), `${filename} DTEND`),
    balance: parseAmount(required(balanceBlock, 'BALAMT', filename), `${filename} BALAMT`),
    balanceAsOf: parseOfxDay(required(balanceBlock, 'DTASOF', filename), `${filename} DTASOF`),
    transactions,
  };
}
