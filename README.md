# sluice

sluice — current work is v0.2. v0.1 is frozen at tag [`v0.1`](https://github.com/xavierbriand/sluice/tree/v0.1) — its code, docs and dev harness are readable there and are not maintained.

A sluice gate controls flow between two bodies of water. Here: between personal accounts and a joint one.

## What this is

A personal household-accounting project. The outcome it exists for:

> My partner and I know how much we should transfer to our joint account each month.

That is an information outcome, not a software one. The software has to keep earning its place.

## Status

v0.2 is being built in steps, each its own pull request. The first version was discovered by interview rather than specified up front, which is the correction v0.1 needed most.

| | step | state |
|---|---|---|
| 1 | **ingest** — bank exports into one reconciled ledger | merged |
| 2 | **config** — `sluice.toml`: income, envelopes, goals, buffer | merged |
| 3 | the numbers — the split, envelope consumption, seasonal pacing, the checks, the envelope generator | merged |
| 4 | the page — instalment strip and four sections | merged |
| 5 | `CLAUDE.md`, written once there is code to describe | merged |

## Running it

```bash
npm install
npm run check                                     # typecheck and tests
SLUICE_CONFIG_DIR=~/sluice-private npm run dev     # the app, on localhost
npm run mutate                                    # mutation testing (minutes, not seconds)
```

`npm run mutate` asks a different question from `npm run check`: not whether the
tests pass, but whether they are capable of failing. It mutates the source and
reports which mutations no test objects to. It sits outside `check` on purpose —
`check` gates every push in about thirty seconds, where a mutation run is about
three minutes.

It prints a score per directory rather than one for the whole tree, because the
weakest surface otherwise hides behind the strongest — the spread is currently
about ten points (83–94%). The baseline and the triage of every surviving mutant live on
[#299](https://github.com/xavierbriand/sluice/issues/299); the gaps it found are
tracked as their own issues rather than fixed inline, so the cost of each stays
visible. No score threshold is enforced yet, deliberately: [#321](https://github.com/xavierbriand/sluice/issues/321)
holds the criteria for adopting one.

sluice reads two things and holds nothing: a folder of bank exports, and one configuration file. There is no database and no import step — every run re-reads the files, because a stale render of a household's money is worse than a slow one.

`SLUICE_CONFIG_DIR` points at the folder holding `sluice.toml`; the page refuses to render without it, with a message saying so, rather than guessing a path.

## Configuration

Everything sluice cannot read out of the bank exports lives in **`sluice.toml`**, which sits outside this repository because it holds household data.

```toml
[exports]
# Relative paths resolve from this file's folder, not the shell's cwd.
directory = "~/sluice-private/exports"

[buffer]
# The cushion the joint account holds on top of the month's spending.
target = "2500.00"

[funding]
# A contribution leaving on or after this day funds the FOLLOWING month.
cutoff_day = 25

[people.alice]
name = "Alice"
# Inbound transfers whose label contains one of these are credited to Alice.
transfer_labels = ["VIR ALICE MARTIN"]

[[people.alice.income]]
label = "Salary"
monthly = "3200.00"       # exactly one of "monthly" and "annual"

[envelopes.groceries]
name = "Groceries"
matches = [{ category = "Food", sub_category = "Supermarket" }]
estimate = "7800.00"      # what it is expected to cost. Required.
goal = "7200.00"          # an optimisation target, only where there is one
```

A fuller worked example lives in [`src/config/__fixtures__/build.ts`](src/config/__fixtures__/build.ts). It is a test fixture that a test parses, so it cannot drift away from what the parser actually accepts.

Five things about the format are deliberate, and each has a reason worth knowing:

- **Amounts are quoted strings.** A bare `7800.10` is a TOML float, and money here is whole cents so the card-settlement check can be exact to the cent.
- **Envelopes are optional, and declaring one never hides the rest.** Every category the bank reports that no envelope claims gets one of its own, derived from the ledger. The section is for grouping and planning, never for deciding what counts.
- **An estimate is written down, not derived.** Its first value comes from last year's actuals, but from then on it is a commitment you own, and last year's actuals are a separate number it is measured against. An estimate that re-derived itself each year would agree with reality by construction — spending could grow every year, the plan would silently grow to match, and nothing would ever report drift.
- **Seasonal shapes are per envelope**, as twelve relative weights or a list of months. A flat one-twelfth line marks a holiday envelope as catastrophically over in July, when July is exactly when it should empty.
- **Every problem in the file is reported at once**, not one per run — including keys sluice does not recognise, which are refused rather than ignored, because a misspelt key leaves the real one at its default and the figure that comes out is wrong rather than missing.

## v0.1

Frozen 2026-08-14 at tag [`v0.1`](https://github.com/xavierbriand/sluice/tree/v0.1). It ran Feb–Aug 2026 and produced 7,256 LOC of well-layered TypeScript, 1,085 tests, and a product that never became part of the monthly routine it was built for. Roughly 72% of its story volume was process rather than product.

Read it for ideas:

- [`CLAUDE.md`](https://github.com/xavierbriand/sluice/blob/v0.1/CLAUDE.md) — the v0.1 development harness in full
- [Critical project review, 2026-07-20](https://github.com/xavierbriand/sluice/blob/v0.1/docs/reviews/2026-07-20-critical-project-review.md) — the three-persona review that prompted the restart

Nothing in it is a commitment. Anything that matters gets retyped deliberately at the moment it is needed — the retyping cost is the filter.
