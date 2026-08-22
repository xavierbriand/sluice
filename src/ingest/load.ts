import { readdir, readFile } from 'node:fs/promises';
import { join as joinPath } from 'node:path';

import { parseCsv } from './csv.ts';
import { parseOfx, type OfxStatement } from './ofx.ts';
import { joinPositionally } from './join.ts';
import {
  toTransactions,
  mergeLedger,
  type LedgerData,
  type LoadedSource,
  type Transaction,
} from './ledger.ts';
import { csvNameFor, sourceOf, type Source } from './sources.ts';
import { reconcileSettlements, type ReconciliationReport } from './reconcile.ts';

export type { LedgerData, LoadedSource } from './ledger.ts';

/**
 * A ledger that has already checked itself.
 *
 * The report is part of the result rather than something a caller remembers to
 * ask for, because "run the reconciliation" is not a step anyone should be able
 * to skip: skipping it is silent, and what it catches is a wrong total.
 *
 * It reports rather than throws. A mismatch is exactly the kind of thing the
 * page exists to show, and refusing to render at the moment there is something
 * important to say would be backwards.
 */
export interface Ledger extends LedgerData {
  readonly reconciliation: ReconciliationReport;
}

// Prose and `this.name` deliberately left surviving — see CLAUDE.md.
export class ExportsNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExportsNotFoundError';
  }
}

interface ParsedFile {
  readonly source: Source;
  readonly statement: OfxStatement;
  readonly filename: string;
  readonly transactions: Transaction[];
}

/**
 * Fold every export of one account or card into a single source.
 *
 * The window widens to cover all of them, because more history means less of a
 * settlement batch is clipped by the edge of the export. The balance does the
 * opposite and takes only the newest: it describes one instant, so an older
 * export's balance is not additional information, it is stale information.
 */
function consolidate(files: readonly ParsedFile[], merged: readonly Transaction[]): LoadedSource[] {
  const bySourceId = new Map<string, ParsedFile[]>();
  for (const file of files) {
    let group = bySourceId.get(file.source.id);
    if (group === undefined) bySourceId.set(file.source.id, (group = []));
    group.push(file);
  }

  const countBySourceId = new Map<string, number>();
  for (const t of merged) {
    countBySourceId.set(t.source.id, (countBySourceId.get(t.source.id) ?? 0) + 1);
  }

  return [...bySourceId.values()].map((group) => {
    // Sorted oldest first, so the last entry carries the current balance.
    const ordered = [...group].sort((a, b) =>
      a.statement.balanceAsOf.localeCompare(b.statement.balanceAsOf),
    );
    const newest = ordered.at(-1)!;
    const source = newest.source;

    // `<` and `>` cannot be widened to `<=`/`>=` observably: `Day` values
    // compare by value, not identity, so a tie between two exports' `from`
    // (or `to`) leaves the reduce holding an equal string regardless of
    // which side "wins". Verified directly across single, all-tied and
    // partially-tied inputs — the same reasoning as the latest-day reduce in
    // reconcile.ts.
    return {
      source,
      from: ordered.map((f) => f.statement.from).reduce((a, b) => (a < b ? a : b)),
      to: ordered.map((f) => f.statement.to).reduce((a, b) => (a > b ? a : b)),
      balance: newest.statement.balance,
      balanceAsOf: newest.statement.balanceAsOf,
      count: countBySourceId.get(source.id) ?? 0,
      files: ordered.map((f) => f.filename),
    };
  });
}

/**
 * Read a folder of bank exports into one ledger.
 *
 * Every `.ofx` must have a `.csv` beside it over the same range: the OFX carries
 * the row ids and the closing balance, the CSV carries the categories and value
 * dates, and neither alone is enough. A `.qif` in the folder is ignored — it has
 * no ids and no categories, so it is a strict subset of what is already here.
 */
export async function loadLedgerData(directory: string): Promise<LedgerData> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (cause) {
    throw new ExportsNotFoundError(
      `Cannot read the exports folder "${directory}". Set exports.directory in ` +
        `sluice.toml to the folder holding the bank's .ofx and .csv exports.`,
      { cause },
    );
  }

  // The trailing .sort() is a real fix, not tested here. `readdir`'s return
  // order is filesystem-defined — already alphabetical on APFS, not
  // guaranteed on ext4, where CI runs — so a test built on real files in a
  // real temp directory cannot force the unsorted case this .sort() protects
  // against without also mocking `readdir` itself, which nothing else in
  // this suite does. Removing it would only ever change which file's parse
  // error is reported first when more than one is broken; every value this
  // function computes is unaffected either way.
  const ofxFiles = entries.filter((f) => f.toLowerCase().endsWith('.ofx')).sort();
  if (ofxFiles.length === 0) {
    throw new ExportsNotFoundError(
      `No .ofx exports in "${directory}". sluice reads the OFX export for row ids ` +
        `and balances, and the CSV export beside it for categories.`,
    );
  }

  const present = new Set(entries);

  // Every pair is checked before anything is read, so a missing file is reported
  // without first waiting on the reads of the files that are present.
  const pairs = ofxFiles.map((ofxFile) => {
    const csvFile = csvNameFor(ofxFile);
    if (!present.has(csvFile)) {
      throw new ExportsNotFoundError(
        `"${ofxFile}" has no matching "${csvFile}". Both are needed over the same ` +
          `date range: the OFX has the row ids and balance, the CSV has the ` +
          `categories the budget is built from.`,
      );
    }
    return { ofxFile, csvFile };
  });

  // The reads are independent, so they run together. Parsing stays sequential
  // and in sorted filename order, which keeps any parse error deterministic
  // rather than a race between whichever file finished first.
  const bytes = await Promise.all(
    pairs.map(async ({ ofxFile, csvFile }) => ({
      ofxFile,
      csvFile,
      ofxBytes: await readFile(joinPath(directory, ofxFile)),
      csvBytes: await readFile(joinPath(directory, csvFile)),
    })),
  );

  const parsed: ParsedFile[] = [];
  for (const { ofxFile, csvFile, ofxBytes, csvBytes } of bytes) {
    const source = sourceOf(ofxFile);
    const statement = parseOfx(ofxBytes, ofxFile);
    const joined = joinPositionally(statement, parseCsv(csvBytes, csvFile), source.id);

    parsed.push({ source, statement, filename: ofxFile, transactions: toTransactions(joined, source) });
  }

  const transactions = mergeLedger(
    parsed.map((f) => ({ transactions: f.transactions, asOf: f.statement.balanceAsOf })),
  );
  return { transactions, sources: consolidate(parsed, transactions) };
}

/**
 * The entry point. Reads the exports and checks them, in one step, always.
 *
 * `loadLedgerData` is exported alongside it only so the reconciliation can be
 * tested against a ledger it did not itself produce; application code has no
 * reason to reach for it.
 */
export async function loadLedger(directory: string): Promise<Ledger> {
  const data = await loadLedgerData(directory);
  return { ...data, reconciliation: reconcileSettlements(data) };
}
