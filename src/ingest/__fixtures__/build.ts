import { CSV_COLUMNS } from '../csv.ts';

/**
 * Builders for synthetic exports.
 *
 * Every fixture in the suite is written here by hand. No real transaction, from
 * any real account, is ever committed to this repository — the real exports live
 * outside the working tree entirely, and the tests must be runnable by someone
 * who has never seen them.
 */

export interface FixtureRow {
  readonly postedOn: string; // DD/MM/YYYY
  readonly valueOn?: string; // DD/MM/YYYY, defaults to postedOn
  readonly amount: string; // "-21,51" or "+4500,00"
  readonly label?: string;
  readonly category?: string;
  readonly subCategory?: string;
  readonly operationType?: string;
  readonly notes?: string;
  readonly fitId?: string;
  /** OFX only, ignored by `csvFixture`. */
  readonly memo?: string;
  /** OFX only, ignored by `csvFixture`: tags to leave out of this transaction's block. */
  readonly omit?: readonly ('TRNTYPE' | 'DTPOSTED' | 'TRNAMT' | 'FITID' | 'NAME' | 'MEMO')[];
}

export function csvFixture(rows: readonly FixtureRow[]): Uint8Array {
  const lines = [CSV_COLUMNS.join(';')];
  for (const r of rows) {
    const negative = r.amount.startsWith('-');
    const cells = [
      r.postedOn,
      r.label ?? 'MERCHANT',
      r.label ?? 'MERCHANT',
      '',
      r.notes ?? '',
      r.operationType ?? 'Carte bancaire',
      r.category ?? 'Alimentation',
      r.subCategory ?? 'Supermarche',
      negative ? r.amount : '',
      negative ? '' : r.amount,
      r.postedOn,
      r.valueOn ?? r.postedOn,
      '0',
    ];
    lines.push(cells.join(';'));
  }
  return Buffer.from(lines.join('\r\n') + '\r\n', 'latin1');
}

export interface OfxOptions {
  readonly accountId?: string;
  readonly from?: string; // YYYYMMDD
  readonly to?: string; // YYYYMMDD
  readonly balance?: string; // "+264.21"
  /**
   * DTASOF, the balance's own as-of date. Defaults to `to`, which is
   * realistic for most exports but not guaranteed — a real bank can report a
   * DTEND (the requested range) that differs from the moment its balance is
   * current as of. Set independently to test code that depends on the two
   * NOT being the same value.
   */
  readonly balanceAsOf?: string; // YYYYMMDD
  readonly omitBalance?: boolean;
  readonly omitCurdef?: boolean;
  /** Ignored when `omitCurdef` is set. Defaults to 'EUR', same as every real export seen so far. */
  readonly currency?: string;
}

function ofxDate(french: string): string {
  const [d = '', m = '', y = ''] = french.split('/');
  return `${y}${m}${d}`;
}

function ofxAmount(french: string): string {
  return french.replace(',', '.');
}

export function ofxFixture(rows: readonly FixtureRow[], options: OfxOptions = {}): Uint8Array {
  const {
    accountId = '00000000001',
    from = '20250101',
    to = '20261231',
    balance = '+0.00',
    balanceAsOf = to,
    omitBalance = false,
    omitCurdef = false,
    currency = 'EUR',
  } = options;

  const body = rows
    .map((r, i) => {
      const omit = new Set(r.omit ?? []);
      const lines = [
        '<STMTTRN>',
        !omit.has('TRNTYPE') && `<TRNTYPE>${r.amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}`,
        !omit.has('DTPOSTED') && `<DTPOSTED>${ofxDate(r.postedOn)}`,
        !omit.has('TRNAMT') && `<TRNAMT>${ofxAmount(r.amount)}`,
        !omit.has('FITID') && `<FITID>${r.fitId ?? `FIT${i + 1}`}`,
        !omit.has('NAME') && `<NAME>${r.label ?? 'MERCHANT'}`,
        !omit.has('MEMO') && `<MEMO>${r.memo ?? 'NOTE'}`,
        '</STMTTRN>',
      ];
      return lines.filter((l): l is string => l !== false).join('\r\n');
    })
    .join('\r\n');

  const ledgerBalance = omitBalance
    ? ''
    : ['<LEDGERBAL>', `<BALAMT>${balance}`, `<DTASOF>${balanceAsOf}`, '</LEDGERBAL>'].join('\r\n') + '\r\n';

  const text = [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    '',
    '<OFX>',
    // A real OFX 102 file opens with a signon block, and it carries <DTSERVER>
    // and its own status codes ahead of the statement. Omitting it left every
    // preamble-scanning first-match regex — ACCTID, CURDEF, DTSTART, DTEND —
    // untested against the shape of an actual export.
    '<SIGNONMSGSRSV1>',
    '<SONRS>',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<DTSERVER>19990101000000',
    '<LANGUAGE>FRA',
    '<DTPROFUP>19990101000000',
    '<DTACCTUP>19990101000000',
    '</SONRS>',
    '</SIGNONMSGSRSV1>',
    '<BANKMSGSRSV1>',
    '<STMTTRNRS>',
    '<TRNUID>0',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<STMTRS>',
    ...(omitCurdef ? [] : [`<CURDEF>${currency}`]),
    '<BANKACCTFROM>',
    `<ACCTID>${accountId}</ACCTID>`,
    '</BANKACCTFROM>',
    '<BANKTRANLIST>',
    `<DTSTART>${from}`,
    `<DTEND>${to}`,
    body,
    '</BANKTRANLIST>',
    ledgerBalance + '</STMTRS>',
    '</STMTTRNRS>',
    '</BANKMSGSRSV1>',
    '</OFX>',
  ].join('\r\n');

  return Buffer.from(text, 'latin1');
}
