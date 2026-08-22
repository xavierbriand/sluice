/**
 * Which file a row came from is part of its identity.
 *
 * This is not a stylistic choice. The bank files every card statement under one
 * shared account id and restarts row ids per statement, so two different cards
 * really do produce the same (account id, row id) pair for unrelated purchases.
 * Nothing *inside* a card export distinguishes it from another card's. The
 * discriminator that does exist is the filename, so the filename is parsed —
 * carefully, and with the volatile part (the exported date range) stripped, so
 * that re-exporting a different range does not mint a new source and duplicate
 * every row.
 *
 * A source is an *account or card*, not a file: several exports over different
 * ranges describe one source, and the filename is therefore not part of it.
 */

/**
 * Modelled as a union rather than an optional field, so that a card always has
 * the four digits the account's settlement row cites and an account never
 * pretends to. Code that narrows on `kind` needs no defensive branch for a card
 * without a number, because the type does not admit one.
 */
export type Source =
  | { readonly kind: 'account'; readonly id: string }
  | { readonly kind: 'card'; readonly id: string; readonly cardNumber: string };

// Prose and `this.name` deliberately left surviving — see CLAUDE.md.
export class SourceNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceNameError';
  }
}

/** `<stem>_DDMMYYYY_DDMMYYYY.ext` — the two date stamps are the volatile part. */
const EXPORT_NAME = /^(.+?)_\d{8}_\d{8}\.(ofx|csv)$/i;
/** Anchored at both ends: `carte_111` and `carte_11111` are not near-misses to accept. */
const CARD_STEM = /^carte_(\d{4})$/i;
/** The bank's current-account exports are named for the account number itself. */
const ACCOUNT_STEM = /^\d{6,}$/;

export function sourceOf(filename: string): Source {
  const base = filename.split('/').at(-1) ?? filename;
  const m = EXPORT_NAME.exec(base);
  if (!m) {
    throw new SourceNameError(
      `Cannot tell which account "${base}" belongs to. sluice expects the bank's ` +
        `own export naming, "<account>_DDMMYYYY_DDMMYYYY.ofx" — the date range is ` +
        `ignored, the part before it identifies the account or card.`,
    );
  }

  // Both `?? ''` fallbacks below are dead code, not gaps: `m[1]` and
  // `card[1]` come from `(.+?)` and `(\d{4})`, neither marked optional with
  // a trailing `?`, so whenever the surrounding regex matches at all the
  // group has matched too and is a defined string. TypeScript can't express
  // "this capture group is mandatory," hence `noUncheckedIndexedAccess`
  // forcing the fallback — but the runtime value can't miss. Same shape as
  // `money.ts`'s documented `whole = '0'`.
  const stem = (m[1] ?? '').toLowerCase();
  const card = CARD_STEM.exec(stem);
  if (card) return { kind: 'card', id: stem, cardNumber: card[1] ?? '' };
  if (ACCOUNT_STEM.test(stem)) return { kind: 'account', id: stem };

  // Anything else is refused rather than assumed to be a current account.
  //
  // Treating unrecognised names as accounts is silent and expensive both ways: a
  // savings export dropped in the folder gets added to spendable cash, and a
  // card whose name is slightly off — `carte_111`, `cb_1111` — has its negative
  // unsettled balance subtracted from cash while vanishing from the settlement
  // check entirely. Both produce a confident, wrong headline figure.
  throw new SourceNameError(
    `"${base}" is not a name sluice recognises. A card export is "carte_NNNN_…" ` +
      `with the last four digits of the card; a current-account export is named ` +
      `for the account number. Anything else — a savings account, a renamed file ` +
      `— would be counted as spendable cash in the current account, so it is ` +
      `refused rather than guessed at.`,
  );
}

/**
 * The `.csv` sitting beside a `.ofx` for the same source.
 *
 * The case of the extension is preserved, because the `.ofx` scan accepts any
 * case and the lookup that follows is an exact filename match — so lowercasing
 * here rejected an `EXPORT.OFX`/`EXPORT.CSV` pair that was sitting right there.
 */
export function csvNameFor(ofxFilename: string): string {
  return ofxFilename.replace(/\.ofx$/i, (ext) => (ext === ext.toUpperCase() ? '.CSV' : '.csv'));
}
