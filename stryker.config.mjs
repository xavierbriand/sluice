// @ts-check
/**
 * Mutation testing — proving the tests can fail, not merely that they pass.
 *
 * What the tool is for, what it costs, and why it is not wired into
 * `npm run check` are in the README. This file says only why each setting is
 * what it is — one home per fact, so the two cannot drift apart.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  testRunner: 'vitest',

  vitest: {
    configFile: 'vitest.config.ts',

    // Stryker computes per-test coverage itself (see `coverageAnalysis` below)
    // and reruns only the tests that touch the mutated line. `related: true`
    // would layer vitest's static module-graph heuristic on top of that — a
    // second, coarser filter that can only ever DROP tests the coverage
    // analysis would have kept. Every test it wrongly drops becomes a mutant
    // reported as surviving when a real test would have killed it. A false
    // survivor costs triage time and quietly devalues every other number in
    // the report, so the coarser filter is off.
    related: false,
  },

  // Pinned rather than inherited. This is Stryker's default today, but the
  // `related: false` decision above depends on it entirely: without per-test
  // coverage, and with vitest's own filter disabled, every mutant would rerun
  // the whole suite — including `runnable.test.ts`, which spawns a child node
  // process and imports every module. Leaving it implicit would make that
  // reasoning quietly false the day the default moves.
  coverageAnalysis: 'perTest',

  // Stryker's default glob already excludes `*.test.ts` and `*.spec.ts`, but
  // not `__fixtures__/`. Both exclusions are restated here because the positive
  // glob is `src/**/*.ts` rather than the default's, so nothing is inherited.
  // Fixtures are test scaffolding — mutating them measures nothing.
  //
  // `app/_lib/**/*.ts` is included too, and the rest of `app/` (components,
  // routes) deliberately is not — see CLAUDE.md for the reasoning. This is
  // the first surface outside `src/` this file mutates, so its own score
  // shows up as its own row in the report rather than folding into an
  // aggregate that would hide it either way.
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/__tests__/**',
    '!src/**/__fixtures__/**',
    'app/_lib/**/*.ts',
    '!app/_lib/**/*.test.ts',
  ],

  // Stryker rewrites tsconfig.json when copying into the sandbox, to fix up
  // `extends` and `references` paths that would otherwise point outside it. It
  // does this via `ts.parseConfigFileTextToJson`, which TypeScript 7's native
  // rewrite no longer exposes — its default export carries two keys now — so
  // the rewrite throws before any mutant runs. Pointing this at nothing makes
  // the preprocessor a no-op, which is correct here regardless of the crash:
  // our tsconfig.json has no `extends` and no `references`, its include/exclude
  // paths are all inside the tree, and vitest does not read it for resolution
  // anyway (the `@` alias comes from vitest.config.ts).
  //
  // This is a dated workaround, not a design choice. Upstream is tracking it as
  // stryker-mutator/stryker-js#6111; revisit on the Stryker release that closes
  // it, and revisit immediately if tsconfig.json ever gains `extends` or
  // `references`, because this setting will silently keep skipping the fix-up
  // those need.
  tsconfigFile: '',

  // A mutant that hangs is scored as detected, the same as one a test caught.
  // That is defensible for CI and misleading here, and it is load-sensitive:
  // measured on this repo, a run at load average 32.95 on 8 cores produced 13
  // timeouts in src/config where a quiet machine produces 2, moving the
  // directory's score 1.1 points on unchanged source. The extra ones could not
  // possibly spin — dropping an optional-chain, widening a `>` — they were
  // simply starved of CPU. A generous allowance costs a few seconds on the
  // three genuine infinite loops and buys a number that means the same thing
  // on a busy laptop as on an idle one. `concurrency` is deliberately left at
  // Stryker's adaptive default: pinning the worker count does not pin the
  // machine, and the machine is what decides the score.
  timeoutMS: 30000,

  // clear-text and html roll up by directory, which is what the baseline needs.
  // json is what `scripts/mutation-summary.mjs` reads to produce that roll-up
  // as a reproducible command rather than an ad-hoc script.
  reporters: ['clear-text', 'progress', 'html', 'json'],
};
