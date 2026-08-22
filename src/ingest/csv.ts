import { parseAmount, type Cents } from '../core/money.ts';
import { parseFrenchDay, type Day } from '../core/dates.ts';

/**
 * The bank's CSV export.
 *
 * ISO-8859-1, semicolon-separated, DD/MM/YYYY dates, comma decimals, debit and
 * credit in separate columns. No quoting — every row in every export observed
 * splits into exactly the header's column count, and the parser asserts that
 * rather than assuming it, because a single unquoted separator inside a merchant
 * name would otherwise shift every field to its right.
 *
 * The CSV is not the spine. It is joined onto the OFX for the two things only it
 * carries: the bank's category/sub-category, and the value date — which for a
 * card is the date the purchase will actually be charged to the account.
 */

export const CSV_COLUMNS = [
  'Date de comptabilisation',
  'Libelle simplifie',
  'Libelle operation',
  'Reference',
  'Informations complementaires',
  'Type operation',
  'Categorie',
  'Sous categorie',
  'Debit',
  'Credit',
  'Date operation',
  'Date de valeur',
  'Pointage operation',
] as const;

export interface CsvRow {
  /** Date the bank booked it. */
  readonly postedOn: Day;
  /** Date it hits the balance. For a deferred card, the settlement date. */
  readonly valueOn: Day;
  /** Short counterparty label. Carries the payer's name on external transfers. */
  readonly label: string;
  /** Long-form label. */
  readonly description: string;
  /** Free text; sometimes carries a transfer's origin, usually empty. */
  readonly notes: string;
  /** The bank's operation type: `Prelevement`, `Virement recu`, `Carte bancaire`… */
  readonly operationType: string;
  /** The bank's own taxonomy. Fixed values, set at source, never overwritten here. */
  readonly category: string;
  readonly subCategory: string;
  readonly amount: Cents;
  /** 1-based line number in the file, for error messages that can be acted on. */
  readonly line: number;
}

// Prose and `this.name` deliberately left surviving — see CLAUDE.md.
export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvFormatError';
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1').decode(bytes);
}

export function parseCsv(bytes: Uint8Array, filename = 'export.csv'): CsvRow[] {
  // Blank lines are skipped but their positions are kept, because `line` is
  // promised to be the number a human can open the file at. Filtering first and
  // numbering afterwards made every message point one row too high per blank
  // line above it — at a row that reads perfectly well, which sends the reader
  // looking for a fault in the parser.
  const lines = decode(bytes)
    .split(/\r?\n/)
    .map((text, i) => ({ text, lineNo: i + 1 }))
    .filter((l) => l.text.trim().length > 0);

  const header = lines[0]?.text;
  if (header === undefined) throw new CsvFormatError(`${filename} is empty`);

  const columns = header.split(';');
  if (columns.length !== CSV_COLUMNS.length) {
    throw new CsvFormatError(
      `${filename}: expected ${CSV_COLUMNS.length} columns, found ${columns.length}. ` +
        `The bank's export format may have changed.`,
    );
  }
  for (const [i, expected] of CSV_COLUMNS.entries()) {
    if (columns[i] !== expected) {
      throw new CsvFormatError(
        `${filename}: column ${i + 1} is "${columns[i]}", expected "${expected}". ` +
          `The bank's export format may have changed.`,
      );
    }
  }

  // The `?? ''` can never run: `columns.length !== CSV_COLUMNS.length` has
  // already thrown above for the header, and every data row is checked
  // against the same length below before `at` is ever called on it, so
  // `CSV_COLUMNS.indexOf(name)` — always a valid index into `CSV_COLUMNS`,
  // since `name` is drawn from that same tuple — is always a valid index
  // into `cells` too. Exists only to satisfy `noUncheckedIndexedAccess`,
  // same shape as `money.ts`'s documented `whole = '0'`.
  const at = (cells: string[], name: (typeof CSV_COLUMNS)[number]) =>
    cells[CSV_COLUMNS.indexOf(name)] ?? '';

  return lines.slice(1).map(({ text, lineNo }) => {
    const cells = text.split(';');
    if (cells.length !== CSV_COLUMNS.length) {
      throw new CsvFormatError(
        `${filename}:${lineNo}: ${cells.length} fields, expected ${CSV_COLUMNS.length}. ` +
          `An unescaped ";" inside a field would do this.`,
      );
    }

    const where = `${filename}:${lineNo}`;
    const debit = parseAmount(at(cells, 'Debit'), `${where} Debit`);
    const credit = parseAmount(at(cells, 'Credit'), `${where} Credit`);
    if (debit !== 0 && credit !== 0) {
      throw new CsvFormatError(`${where}: both Debit and Credit are set; only one may be.`);
    }

    return {
      postedOn: parseFrenchDay(at(cells, 'Date de comptabilisation'), `${where} posted`),
      valueOn: parseFrenchDay(at(cells, 'Date de valeur'), `${where} value date`),
      label: at(cells, 'Libelle simplifie').trim(),
      description: at(cells, 'Libelle operation').trim(),
      notes: at(cells, 'Informations complementaires').trim(),
      operationType: at(cells, 'Type operation').trim(),
      category: at(cells, 'Categorie').trim(),
      subCategory: at(cells, 'Sous categorie').trim(),
      amount: debit + credit,
      line: lineNo,
    };
  });
}
