import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, CsvFormatError, parseCsv } from './csv.ts';
import { csvFixture } from './__fixtures__/build.ts';

describe('parseCsv', () => {
  it('reads a debit as a negative amount and a credit as a positive one', () => {
    const rows = parseCsv(
      csvFixture([
        { postedOn: '14/08/2026', amount: '-21,51' },
        { postedOn: '03/08/2026', amount: '+4000,00' },
      ]),
    );
    expect(rows.map((r) => r.amount)).toEqual([-2151, 400000]);
  });

  it('keeps the value date separate from the posting date', () => {
    // On a deferred card these differ by up to a month, and that gap is the
    // whole in-flight problem.
    const [row] = parseCsv(csvFixture([{ postedOn: '11/08/2026', valueOn: '04/09/2026', amount: '-7,00' }]));
    expect(row?.postedOn).toBe('2026-08-11');
    expect(row?.valueOn).toBe('2026-09-04');
  });

  it('decodes ISO-8859-1 accents rather than mangling them', () => {
    const [row] = parseCsv(csvFixture([{ postedOn: '01/02/2026', amount: '-5,90', label: 'CRÊPERIE' }]));
    expect(row?.label).toBe('CRÊPERIE');
  });

  it('rejects a file whose columns are not the ones expected', () => {
    // Asserting the count-mismatch message specifically, not the generic
    // "format may have changed" suffix both this and the per-column check
    // share: the wrong column count also fails the per-column comparison on
    // its first entry, so a loose assertion here cannot tell the header-count
    // guard apart from that fallback — and would stay green with the guard's
    // body deleted entirely. Verified by hand: with `if (columns.length !==
    // CSV_COLUMNS.length) {}` emptied, `/format may have changed/` alone still
    // passes, because the per-column loop throws its own message with the
    // same suffix.
    const bad = Buffer.from('Date;Amount\r\n01/01/2026;-1,00\r\n', 'latin1');
    expect(() => parseCsv(bad, 'export.csv')).toThrow(CsvFormatError);
    expect(() => parseCsv(bad, 'export.csv')).toThrow(
      new RegExp(`expected ${CSV_COLUMNS.length} columns, found 2`),
    );
  });

  it('rejects a renamed column even when the count still matches', () => {
    const renamed: string[] = [...CSV_COLUMNS];
    renamed[6] = 'Category';
    const bad = Buffer.from(renamed.join(';') + '\r\n', 'latin1');
    expect(() => parseCsv(bad, 'export.csv')).toThrow(/column 7 is "Category"/);
  });

  it('rejects a row split by an unescaped separator instead of shifting fields', () => {
    const good = csvFixture([{ postedOn: '01/01/2026', amount: '-1,00' }]);
    const broken = Buffer.from(Buffer.from(good).toString('latin1').replace('MERCHANT', 'A;B'), 'latin1');
    expect(() => parseCsv(broken, 'export.csv')).toThrow(/fields, expected 13/);
  });

  it('rejects a row carrying both a debit and a credit', () => {
    const text = Buffer.from(csvFixture([{ postedOn: '01/01/2026', amount: '-1,00' }])).toString('latin1');
    const both = Buffer.from(text.replace('-1,00;;', '-1,00;+2,00;'), 'latin1');
    expect(() => parseCsv(both, 'export.csv')).toThrow(/both Debit and Credit/);
  });

  it('reports the line number so the row can be found', () => {
    const text = Buffer.from(
      csvFixture([
        { postedOn: '01/01/2026', amount: '-1,00' },
        { postedOn: '02/01/2026', amount: '-2,00' },
      ]),
    ).toString('latin1');
    const broken = Buffer.from(text.replace('-2,00', 'oops'), 'latin1');
    expect(() => parseCsv(broken, 'export.csv')).toThrow(/export\.csv:3/);
  });

  it('counts blank lines when reporting where a bad row is', () => {
    // The line number is promised to be the one a human can open the file at.
    // Numbering after filtering pointed at a row that reads perfectly well.
    const text = Buffer.from(
      csvFixture([
        { postedOn: '01/01/2026', amount: '-1,00' },
        { postedOn: '02/01/2026', amount: '-2,00' },
      ]),
    ).toString('latin1');
    const [header = '', first = '', second = ''] = text.split('\r\n');
    const withBlank = Buffer.from(
      [header, first, '', second.replace('-2,00', 'oops'), ''].join('\r\n'),
      'latin1',
    );
    // header=1, first row=2, blank=3, bad row=4.
    expect(() => parseCsv(withBlank, 'export.csv')).toThrow(/export\.csv:4/);
  });

  it('rejects an empty file', () => {
    expect(() => parseCsv(Buffer.from('', 'latin1'), 'export.csv')).toThrow(/is empty/);
  });

  it('names the file "export.csv" when no caller says otherwise', () => {
    expect(() => parseCsv(Buffer.from('', 'latin1'))).toThrow(/export\.csv/);
  });

  it('tolerates bare \n line endings, not just \r\n', () => {
    // Every fixture in the suite builds \r\n files, since that is what the bank
    // actually emits — so the /\r?\n/ split's tolerance for a bare \n had never
    // been exercised by anything.
    const good = Buffer.from(
      Buffer.from(csvFixture([{ postedOn: '01/01/2026', amount: '-1,00' }]))
        .toString('latin1')
        .replace(/\r\n/g, '\n'),
      'latin1',
    );
    const [row] = parseCsv(good);
    expect(row?.postedOn).toBe('2026-01-01');
  });

  it('skips a line of only whitespace, not just an empty one', () => {
    // The blank-line filter is `l.text.trim().length > 0` specifically because
    // a line of only spaces or tabs has to be skipped the same way an empty
    // line is — and line numbering has to keep counting it, the same reason
    // filtering happens after numbering rather than before (see the comment
    // in parseCsv). A pure empty-string blank line cannot tell `.trim()` from
    // a no-op, since '' is already falsy-length either way.
    const text = Buffer.from(csvFixture([{ postedOn: '01/01/2026', amount: '-1,00' }])).toString(
      'latin1',
    );
    const [header = '', row = ''] = text.split('\r\n');
    const withWhitespaceLine = Buffer.from([header, '   ', row, ''].join('\r\n'), 'latin1');
    const rows = parseCsv(withWhitespaceLine);
    expect(rows).toHaveLength(1);
    // header=1, whitespace-only=2, data row=3.
    expect(rows[0]?.line).toBe(3);
  });

  it('trims whitespace from every free-text field', () => {
    // Six independent `.trim()` calls build the returned row, none of them
    // covered until now: a padded cell would have been passed straight
    // through, and it is exactly the kind of value that ends up compared
    // against a config's exact-match category or label matcher.
    const [row] = parseCsv(
      csvFixture([
        {
          postedOn: '01/08/2026',
          amount: '-5,00',
          label: '  MERCHANT  ',
          notes: '  a note  ',
          operationType: '  Carte bancaire  ',
          category: '  Alimentation  ',
          subCategory: '  Supermarche  ',
        },
      ]),
    );
    expect(row?.label).toBe('MERCHANT');
    expect(row?.description).toBe('MERCHANT');
    expect(row?.notes).toBe('a note');
    expect(row?.operationType).toBe('Carte bancaire');
    expect(row?.category).toBe('Alimentation');
    expect(row?.subCategory).toBe('Supermarche');
  });
});
