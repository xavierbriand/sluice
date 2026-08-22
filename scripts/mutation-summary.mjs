// @ts-check
/**
 * The per-directory mutation roll-up, as a command rather than an ad-hoc script.
 *
 * `npm run mutate` prints a per-FILE table. #299 asks for the baseline per
 * DIRECTORY, because src/core, src/ingest, src/config and src/numbers differ
 * enough in character that one aggregate number hides more than it shows.
 *
 * Two scores per row, not one. Stryker reports both and the gap between them is
 * itself the finding: `score` counts every valid mutant, `covered` counts only
 * those some test reaches, so the difference is code no test touches at all.
 * That needs a different fix from code tested weakly, and a single headline
 * number conceals it completely.
 *
 * Timeouts are printed in their own column rather than folded into the score.
 * Stryker counts a timeout as detected; a hung mutant asserted nothing, and the
 * count is load-sensitive (see the `timeoutMS` note in stryker.config.mjs), so
 * it is the first thing to check when two runs disagree.
 */
import { readFileSync } from 'node:fs';

const REPORT = 'reports/mutation/mutation.json';

/** @param {Record<string, number>} c */
function score(c) {
  const detected = (c.Killed ?? 0) + (c.Timeout ?? 0);
  const valid = detected + (c.Survived ?? 0) + (c.NoCoverage ?? 0);
  const covered = detected + (c.Survived ?? 0);
  return { detected, valid, covered };
}

/** @param {number} n @param {number} d */
const pct = (n, d) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(2)}%`);

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch {
  console.error(`No report at ${REPORT}. Run \`npm run mutate\` first.`);
  process.exit(1);
}

/** @type {Map<string, Record<string, number>>} */
const byDir = new Map();
/** @type {Record<string, number>} */
const total = {};

for (const [file, entry] of Object.entries(report.files)) {
  const dir = file.split('/').slice(0, 2).join('/');
  const counts = byDir.get(dir) ?? {};
  for (const mutant of entry.mutants) {
    counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
    total[mutant.status] = (total[mutant.status] ?? 0) + 1;
  }
  byDir.set(dir, counts);
}

const rows = [['scope', 'valid', 'score', 'covered', 'survived', 'no cov', 'timeout']];
for (const [name, counts] of [['all files', total], ...[...byDir].sort()]) {
  const c = /** @type {Record<string, number>} */ (counts);
  const { detected, valid, covered } = score(c);
  rows.push([
    String(name),
    String(valid),
    pct(detected, valid),
    pct(detected, covered),
    String(c.Survived ?? 0),
    String(c.NoCoverage ?? 0),
    String(c.Timeout ?? 0),
  ]);
}

const header = rows[0] ?? [];
const width = header.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
for (const [i, row] of rows.entries()) {
  console.log(row.map((cell, j) => cell.padEnd(width[j] ?? 0)).join('  '));
  if (i === 0) console.log(width.map((w) => '-'.repeat(w)).join('  '));
}

const t = total.Timeout ?? 0;
if (t > 0) {
  console.log(
    `\n${t} timeout${t === 1 ? '' : 's'} counted as detected. Verify they are genuine ` +
      `infinite loops and not CPU starvation before trusting the score.`,
  );
}
