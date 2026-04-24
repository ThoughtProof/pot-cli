# Benchmark v1 retrieval-boundary pack — 2026-04-24

## Goal
Create a small, high-leverage v1 benchmark slice focused on the retrieval decision boundary between:
- `HOLD`
- `CONDITIONAL_ALLOW`
- `BLOCK`

This pack should stress exactly the surface that remains most informative after the v0 cleanup:
- cases that are **not factually wrong**
- but are **not fully observable / fully supported** either
- plus negative controls to ensure softening does not erase real wrong-answer hard stops

## Why this slice
v0 now has:
- `exactMatch = 10`
- `conservativeMiss = 2`
- `dangerousMiss = 0`
- `manualGap = 1`

The remaining epistemically interesting question is no longer whether factual failures should block (they should), but **when a mostly-supported retrieval case with one gap should remain HOLD vs soften to CONDITIONAL_ALLOW**.

## Proposed pack structure (6 cases)

### Group A — softening candidates (2)
Cases that should plausibly end up as `CONDITIONAL_ALLOW`.

#### V1-R01 — official-source, one missing support step
- `verified = true`
- one decisive support step missing
- no factual contradiction
- evidence comes from or points to a first-party / official source
- candidate expected verdict: `CONDITIONAL_ALLOW`
- purpose: test narrow retrieval softening without wrong-answer risk

#### V1-R02 — official-source acronym / definition lookup
- `verified = true`
- answer likely correct
- sparse trace, weak lexical recall unless source-page enrichment is used
- candidate expected verdict: `CONDITIONAL_ALLOW`
- purpose: test whether source-claim/source-page rescue is working only in the intended narrow band

### Group B — conservative HOLD controls (2)
Cases that should remain `HOLD` even if they superficially resemble softening candidates.

#### V1-R03 — missing decisive support with no official-source anchor
- `verified = true`
- one missing decisive support step
- no factual contradiction
- no high-quality first-party anchor
- expected verdict: `HOLD`
- purpose: ensure the policy does not soften generic under-supported retrieval too aggressively

#### V1-R04 — answer plausible but provenance chain incomplete
- `verified = true`
- observability gap persists
- answer confidence moderate/high but provenance chain not complete
- expected verdict: `HOLD`
- purpose: test whether retrieval remains conservative when provenance is not closed

### Group C — negative controls / hard-stop guards (2)
Cases that must remain `BLOCK`.

#### V1-R05 — factual failure with retrieval flavor
- retrieval task
- superficially similar shape to Group A/B
- but answer is actually wrong
- expected verdict: `BLOCK`
- purpose: ensure softening logic never washes out wrong-answer hard stops

#### V1-R06 — provenance mismatch / citation mismatch
- answer content may look close or string-match truth
- cited source / provenance chain is wrong or unsupported
- expected verdict: `BLOCK`
- purpose: protect against false positives where answer text alone looks acceptable

## Selection guidance
Prefer cases with:
- real or realistic web retrieval structure
- explicit first-party vs non-first-party contrast
- clear annotator steps and accepted answers
- minimal overlap with current v0 exact/fixated cases

Avoid:
- repeating pure factual-failure cases already covered in v0
- mixing in unrelated tool-chain or policy-only failures
- over-indexing on synthetic toy examples unless they isolate a boundary sharply

## Deliverables for next implementation step
1. Create a v1 candidate list with 6 concrete prompts/cases matching the groups above.
2. For each case, define:
   - expected verdict
   - why it belongs to this group
   - what feature is being isolated
3. Build traces/gold in a single benchmark family with unambiguous IDs (avoid reusing `V0-*`).
4. Score separately from the v0 family.

## Naming recommendation
Use IDs like:
- `V1-R01` .. `V1-R06`

Do not reuse `V0-*` labels to avoid another family collision.
