import { describe, expect, it } from 'vitest';
import { OfxFormatError, parseOfx } from './ofx.ts';
import { ofxFixture } from './__fixtures__/build.ts';

describe('parseOfx', () => {
  it('reads the transactions, the account and the window', () => {
    const statement = parseOfx(
      ofxFixture([{ postedOn: '14/08/2026', amount: '-22,20', label: 'COTISATION' }], {
        accountId: '00000000001',
        from: '20250101',
        to: '20260815',
      }),
    );
    expect(statement.accountId).toBe('00000000001');
    expect(statement.from).toBe('2025-01-01');
    expect(statement.to).toBe('2026-08-15');
    expect(statement.transactions).toHaveLength(1);
    expect(statement.transactions[0]?.amount).toBe(-2220);
    expect(statement.transactions[0]?.fitId).toBe('FIT1');
  });

  it('reads the closing balance, which the CSV does not carry', () => {
    const statement = parseOfx(
      ofxFixture([{ postedOn: '01/01/2026', amount: '-1,00' }], { balance: '+300.00', to: '20260815' }),
    );
    expect(statement.balance).toBe(30000);
    expect(statement.balanceAsOf).toBe('2026-08-15');
  });

  it('reads a negative card balance as unsettled spending', () => {
    const statement = parseOfx(
      ofxFixture([{ postedOn: '01/08/2026', amount: '-500,00' }], { balance: '-500.00' }),
    );
    expect(statement.balance).toBe(-50000);
  });

  it('refuses a file with no closing balance', () => {
    // Without it there is no way to tell cash on hand from spending already
    // committed, which is the one number the bank never shows in one place.
    expect(() =>
      parseOfx(ofxFixture([{ postedOn: '01/01/2026', amount: '-1,00' }], { omitBalance: true }), 'x.ofx'),
    ).toThrow(/LEDGERBAL/);
  });

  it('refuses a file that is not OFX at all', () => {
    // The check this guards is one line away from redundant with the
    // <LEDGERBAL> lookup below it — remove it and "just some text" still
    // throws OfxFormatError, just from the balance check instead. What makes
    // it worth keeping is the message: this one tells someone they pointed
    // sluice at the wrong file; a LEDGERBAL complaint would send them looking
    // for a balance in a file that was never OFX to begin with. Asserting the
    // text, not just the error type, is what keeps that message load-bearing.
    expect(() => parseOfx(Buffer.from('just some text', 'latin1'), 'x.ofx')).toThrow(
      /is this an OFX export/,
    );
  });

  it('names the missing tag and the right transaction when a required field is absent', () => {
    // FITID, DTPOSTED and TRNAMT all go through the same `required()` guard,
    // and none of the three had ever been omitted from a fixture — the throw
    // this depends on had no test reaching it at all. Two transactions, the
    // second one broken, so the message's index has to be right rather than
    // merely present: transaction 1 is fine and transaction 2 is missing its
    // id, so a message saying "transaction 1" would be exactly the kind of
    // wrong number this project keeps finding.
    const bad = ofxFixture(
      [
        { postedOn: '01/08/2026', amount: '-10,00' },
        { postedOn: '02/08/2026', amount: '-20,00', omit: ['FITID'] },
      ],
      { to: '20260815' },
    );
    expect(() => parseOfx(bad, 'x.ofx')).toThrow(/x\.ofx transaction 2: <FITID> is missing/);
  });

  it('splits transactions on every <STMTTRN>, not just the first', () => {
    // `text.split('<STMTTRN>')` is what turns the raw file into one block per
    // transaction; a single-transaction fixture cannot tell it apart from
    // reading the whole body as one block.
    const statement = parseOfx(
      ofxFixture(
        [
          { postedOn: '01/08/2026', amount: '-10,00', fitId: 'A' },
          { postedOn: '02/08/2026', amount: '-20,00', fitId: 'B' },
        ],
        { to: '20260815' },
      ),
    );
    expect(statement.transactions.map((t) => t.fitId)).toEqual(['A', 'B']);
    expect(statement.transactions.map((t) => t.amount)).toEqual([-1000, -2000]);
  });

  it('treats an absent TRNTYPE, NAME or MEMO as empty, not as missing', () => {
    // Unlike FITID/DTPOSTED/TRNAMT, these are read with `?? ''` rather than
    // `required()` — a card statement's memo-only rows have been seen without
    // a NAME. The `?? ''` fallbacks had no test reaching them.
    const statement = parseOfx(
      ofxFixture([{ postedOn: '01/08/2026', amount: '-10,00', omit: ['TRNTYPE', 'NAME', 'MEMO'] }], {
        to: '20260815',
      }),
    );
    expect(statement.transactions[0]?.type).toBe('');
    expect(statement.transactions[0]?.name).toBe('');
    expect(statement.transactions[0]?.memo).toBe('');
  });

  it('reads TRNTYPE, NAME and MEMO when they are present, not just their fallback', () => {
    // The omit test above proves the `?? ''` fallback works; it cannot prove
    // the tag lookup itself is right, because a corrupted tag name (`'TRNTYPE'`
    // read as garbage) falls back to the same `''` and passes it too. A
    // present, distinctive value is the only thing that tells the two apart.
    // No fixture had ever set a `<MEMO>` at all before this.
    const statement = parseOfx(
      ofxFixture([{ postedOn: '01/08/2026', amount: '-10,00', label: 'COTISATION', memo: 'ANNUAL FEE' }], {
        to: '20260815',
      }),
    );
    expect(statement.transactions[0]?.type).toBe('DEBIT');
    expect(statement.transactions[0]?.name).toBe('COTISATION');
    expect(statement.transactions[0]?.memo).toBe('ANNUAL FEE');
  });

  it('defaults the currency to EUR when CURDEF is absent', () => {
    const statement = parseOfx(
      ofxFixture([{ postedOn: '01/08/2026', amount: '-10,00' }], { to: '20260815', omitCurdef: true }),
    );
    expect(statement.currency).toBe('EUR');
  });

  it('reads a non-default currency from CURDEF, not just the EUR fallback', () => {
    // Every other fixture's CURDEF happens to be 'EUR', which is also the
    // fallback value — so a corrupted `'CURDEF'` tag name would silently take
    // the same fallback and no test would have noticed.
    const statement = parseOfx(
      ofxFixture([{ postedOn: '01/08/2026', amount: '-10,00' }], { to: '20260815', currency: 'USD' }),
    );
    expect(statement.currency).toBe('USD');
  });

  it('names the file "export.ofx" when no caller says otherwise', () => {
    expect(() => parseOfx(Buffer.from('just some text', 'latin1'))).toThrow(/export\.ofx/);
  });

  it('accepts a statement with no transactions and still reads its balance', () => {
    // A card retired part-way through the year has no activity in a later
    // window. Rejecting the file would abort the entire ledger over a card that
    // simply was not used.
    const statement = parseOfx(ofxFixture([], { balance: '+123.45', to: '20260815' }), 'carte_1111.ofx');
    expect(statement.transactions).toHaveLength(0);
    expect(statement.balance).toBe(12345);
    expect(statement.balanceAsOf).toBe('2026-08-15');
  });

  it('does not confuse <DTSERVER> in the header with <DTSTART>', () => {
    const statement = parseOfx(ofxFixture([{ postedOn: '01/01/2026', amount: '-1,00' }], { from: '20250101' }));
    expect(statement.from).toBe('2025-01-01');
  });
});
