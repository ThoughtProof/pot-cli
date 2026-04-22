# Source-Page Enrichment MVP (2026-04-22)

## Recommendation
Do **not** push the full local research surface yet.
Push a narrower MVP centered on one clear user story:

> Given first-party traces that cite official source pages, `--enrich-source-pages` improves source-claim recall conservatively, without widening verdict logic.

## Suggested MVP surface
### Public / user-facing
- `plan-sweep-first-party --enrich-source-pages`
- `plan-build-source-claim-map --enrich-source-pages`
- `plan-enrich-source-pages` as an advanced helper command
- one short workflow doc + one reproducible demo bundle

### Keep internal / de-emphasized for now
- broad grand-bundle claims
- calibration notes and local research memos
- all the extra dated docs around rule-v2 exploration
- presenting the whole plan-level suite as if it were a finished product surface

## One happy-path demo
### Recommended demo story
Use a small official-source batch with lean traces that would otherwise under-expose source text.

Goal of the demo:
- show that `--enrich-source-pages` turns weak source-claim support into strong support
- show that verdicts do **not** become looser just because support recall improves

### Recommended demo asset
- messy out-of-sample official-source bundle (`6` traces)
- current one-flag outcome:
  - `sourceClaimSupport exact=6`
  - `sourceClaimConfidence high=6`
  - verdicts stable: `ALLOW=3 / CONDITIONAL_ALLOW=3 / HOLD=0 / BLOCK=0`

Why this is the best MVP demo:
- small enough to explain
- directly shows the value of the new feature
- avoids over-claiming broad retrieval softening
- does not require telling the whole local research story

## MVP README promise
The README should claim only:
- first-party source-page enrichment exists
- it improves source-claim recall on official-source traces
- it plugs into source-claim build and sweep workflows
- it is still an experimental/local verification workflow

The README should **not** claim:
- corpus-level retrieval softening
- general answer equivalence
- broad web-grounded truth verification

## Ship checklist
Before pushing the MVP branch:
- [x] feature implemented
- [x] commands integrated
- [x] tests green (`136/136`)
- [x] workflow docs updated
- [x] isolated commit exists (`76cc9c1`)
- [x] README tightened around the narrower MVP story
- [x] one demo snippet chosen as the canonical example
- [ ] dated exploratory docs excluded from the push branch or clearly de-emphasized

## Push strategy
### Recommended
1. keep current local commit as base
2. create a fresh branch for the MVP slice
3. push only the plan/source-page enrichment workflow commit(s)
4. open PR with a narrow summary and explicit claim boundary

### Not recommended
- pushing directly to `main`
- pushing all local dated research docs together with the MVP
- framing the whole research surface as stable product

## After MVP
Only after the narrow MVP lands should we decide whether to:
- promote the broader plan-level workflow,
- publish more benchmark bundles,
- or write up the stronger local retrieval-softening story.
