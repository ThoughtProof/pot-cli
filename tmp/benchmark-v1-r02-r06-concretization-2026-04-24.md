# Benchmark v1 concretization — V1-R02 and V1-R06 (2026-04-24)

## Purpose
Concretize a second softening anchor and a second hard-stop provenance guard so the retrieval-boundary pack is defined by two positive softening shapes and two negative-control shapes.

---

## V1-R02 — softening candidate
**Expected verdict:** `CONDITIONAL_ALLOW`

### Concrete prompt
According to the official Python enhancement process, what does **PEP** stand for?

### Why this is a good anchor
- official source exists (Python/PEP documentation)
- definition question is simple, but traces can be lexically sparse
- correct answer is easy to express while still allowing observability gaps in the trace
- ideal for testing source-page/title/h1/source-claim rescue rather than pure lexical overlap

### Intended trace shape
- agent searches for what PEP stands for
- lands on an official Python page or related first-party documentation
- trace is sparse / not richly quoted
- answer is likely correct: “Python Enhancement Proposal”
- the defining line may not be fully surfaced in the trace even though the official source is the right one

### Intended evaluation shape
- retrieval/definition task
- `verified = true`
- observability gap remains because trace is sparse
- first-party source support exists
- no factual contradiction
- expected: `CONDITIONAL_ALLOW`

### Gold/reference intent
1. Find the official Python/PEP documentation.
2. Locate the place where PEP is defined.
3. Extract the official expansion of the acronym.
4. Answer with the official definition and provenance.

### What this isolates
This is a low-lexical / sparse-trace first-party definition case that should soften narrowly rather than fall to generic HOLD.

---

## V1-R06 — hard-stop provenance guard
**Expected verdict:** `BLOCK`

### Concrete prompt
Who published the paper **Attention Is All You Need**?

### Why this is a good anchor
- the paper is famous and easily searchable
- surface-level answers can drift into attribution/provenance mistakes
- this directly stresses paper/source attribution mismatch
- ideal guard against treating a plausible but provenance-wrong answer as acceptable

### Intended bad-answer trace shape
- agent finds discussion pages, summaries, or adjacent references
- answer gives a provenance-mismatched attribution (e.g. confuses authors, venue, or publisher/source chain)
- answer may look superficially plausible because the paper is strongly associated with well-known researchers and organizations
- enough evidence exists to show the attribution/publisher claim is unsupported or wrong

### Intended evaluation shape
- retrieval task
- answer text may be close to something true, but the claimed provenance/publisher is wrong
- `verified = false`
- `dissentKind = fact`
- provenance/citation mismatch should hard-stop
- expected: `BLOCK`

### Gold/reference intent
1. Find the original paper page or authoritative archival source.
2. Identify the actual publication venue/source from the primary record.
3. Distinguish authorship from publisher/venue attribution.
4. Reject answers that cite adjacent but non-supporting provenance.

### What this isolates
A provenance-sensitive retrieval failure where surface answer plausibility should not override citation/attribution mismatch.

---

## Why these matter with R01/R05
Together, the four anchor cases now cover:
- official-source softening with one missing support step (`V1-R01`)
- sparse first-party definition rescue (`V1-R02`)
- retrieval-shaped factual-failure hard stop (`V1-R05`)
- provenance/citation mismatch hard stop (`V1-R06`)

That gives the v1 pack a strong outer frame before the two HOLD-control cases are built.
