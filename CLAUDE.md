# CLAUDE.md

Read before adding code. Two things live here: constraints this codebase
can't teach you by being read, and how a change actually gets made. Nothing
else — no phases, no `docs/` folder, no process apparatus. Adding a line
here means finding one to cut.

## Constraints not obvious from the code

- **This repo is public and doubles as a portfolio.** Household figures,
  local paths, and machine details never reach a commit, issue, or PR body.
- **Bank exports and `sluice.toml` live outside the repo**, in
  `~/sluice-private/`. Nothing real ever enters this working tree, fixture
  or otherwise — every fixture here is hand-written.
- **Stage explicit paths. Never `git add -A`.** Twice, an untracked leftover
  sitting in the tree since before the work began got swept into an
  unrelated commit and pushed. Run `git status` at the start of a session,
  not just before committing.
- **Every defect this project's reviews have found is a plausible wrong
  number, never a crash.** Review accordingly: check arithmetic against its
  own doc comment, not just that the suite is green.
- **An envelope's `estimate` is a commitment, never regenerated in place.**
  `generateEnvelopeBlock()` (`src/numbers/generate.ts`) only ever returns
  TOML text for a human to paste; nothing in `app/` calls it.
- **Error-message prose and `this.name` on every custom `Error` subclass are
  deliberately left as surviving mutants, not tested.** Nothing anywhere
  asserts `err.name`; every catch site matches by `instanceof` or
  `toThrow(SomeErrorClass)`. Applies project-wide — filed once as a decision
  on #328 rather than re-argued per class.
- **There's no `docs/` folder, and no process documentation lives in this
  repo.** v0.1 had one — 201 lines of `CLAUDE.md` deferring to it, and 72%
  of that version's effort went to process instead of product. Anything
  that matters gets retyped deliberately when it's next needed, not filed
  away in advance.

Running it and configuring `sluice.toml`: see [`README.md`](README.md).

## How a change happens here

1. Non-trivial work gets a short plan first — reviewed, not written silently.
2. One PR per coherent step. Stacked steps branch off the step below them,
   not off `main`.
3. Self-review, plus GitHub Copilot's automatic review where it fires —
   every thread resolved or explicitly dismissed with a reason. Findings
   and fixes are recorded in the PR body itself, not a separate document.
4. Manual verification for anything user-visible: run it
   (`SLUICE_CONFIG_DIR=~/sluice-private`) against real data where possible,
   and say plainly what was and wasn't actually checked.
5. Merge is the user's call, always — never the agent's, whatever CI says.
6. `README.md` / this file update in the same PR as the change they describe.
