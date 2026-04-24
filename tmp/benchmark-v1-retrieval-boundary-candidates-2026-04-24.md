# Benchmark v1 retrieval-boundary candidates — 2026-04-24

## Goal
Concrete candidate cases for the v1 retrieval-boundary pack. These are intended to become a new, separate benchmark family with unambiguous IDs `V1-R01` .. `V1-R06`.

---

## V1-R01 — official-source supportable, one-step-missing status lookup
**Group:** softening candidate  
**Expected verdict:** `CONDITIONAL_ALLOW`

**Prompt idea**  
According to the official RFC/spec page, what does a specific status/code/term mean?

**Shape**
- retrieval task
- answer likely correct
- one decisive support step missing from trace
- official-source page is available and would support the answer
- no sign of factual contradiction

**Why useful**
This isolates the narrowest intended softening path: mostly-supported retrieval with a first-party anchor, but incomplete observability.

**Good source types**
- IETF RFC page
- PEP page
- MDN / official spec page
- standards body documentation

---

## V1-R02 — acronym/definition lookup with sparse trace but first-party rescue
**Group:** softening candidate  
**Expected verdict:** `CONDITIONAL_ALLOW`

**Prompt idea**  
What does acronym X stand for according to the official source?

**Shape**
- retrieval/definition task
- trace sparse and lexically weak
- answer probably right
- source-page enrichment / source-claim support would recover confidence
- no factual contradiction

**Why useful**
Tests the intended rescue path for low-lexical but first-party-grounded retrieval, especially relevant to the earlier source-page/title/h1 enrichment work.

**Good source types**
- official standards acronym glossaries
- RFC/PEP/spec pages
- agency or standards documentation

---

## V1-R03 — generic web retrieval with one missing decisive support step
**Group:** conservative HOLD control  
**Expected verdict:** `HOLD`

**Prompt idea**  
Find a fact that is plausible and probably correct, but the trace lacks one decisive support step and has no first-party anchor.

**Shape**
- retrieval task
- verified or plausibly verified answer
- one decisive support step missing
- no official / first-party source grounding
- no hard contradiction

**Why useful**
Distinguishes narrow first-party softening from over-broad softening of generic under-supported retrieval.

**Good source types**
- blog or secondary-source answer chains
- search results without final authoritative source

---

## V1-R04 — plausible answer, incomplete provenance chain
**Group:** conservative HOLD control  
**Expected verdict:** `HOLD`

**Prompt idea**  
Answer a plausible retrieval question where the answer may be right, but the provenance chain never fully closes.

**Shape**
- retrieval task
- answer confidence moderate/high
- provenance chain incomplete
- observability gap persists even after trace review
- not clearly false

**Why useful**
Tests whether retrieval remains conservative when support quality is incomplete even without a wrong-answer signal.

**Good source types**
- multi-hop page references where final authoritative citation is not actually opened
- article summarizing another source without checking the primary page

---

## V1-R05 — factual failure disguised as retrieval uncertainty
**Group:** negative-control BLOCK guard  
**Expected verdict:** `BLOCK`

**Prompt idea**  
A retrieval question where the answer appears plausible but is actually wrong.

**Shape**
- retrieval flavor
- answer could superficially look acceptable
- actual truth is different
- enough information exists to classify as wrong-answer rather than mere uncertainty

**Why useful**
Ensures that any widening of retrieval softening does not erase factual-failure hard stops.

**Good source types**
- wrong date / wrong entity / wrong status while citing adjacent but not matching evidence

---

## V1-R06 — provenance mismatch / citation mismatch
**Group:** negative-control BLOCK guard  
**Expected verdict:** `BLOCK`

**Prompt idea**  
The answer text may be close to correct, but the cited source does not actually support it or supports a different claim.

**Shape**
- answer text alone may look acceptable
- provenance/citation chain is wrong, mismatched, or unsupported
- should be treated as a real hard stop, not a soft observability miss

**Why useful**
Protects the core ThoughtProof thesis: provenance matters, not just surface answer similarity.

**Good source types**
- paper/source attribution mismatch
- citation to adjacent but non-supporting paragraph
- official page that discusses topic but does not support the claimed fact

---

## Practical next step
For the next build pass, convert these 6 abstract candidates into a concrete table with:
- `id`
- `taskPrompt`
- `expectedVerdict`
- `source family`
- `why this case exists`
- `what exact boundary feature it isolates`

Then build them as a fresh benchmark family with unique IDs and no overlap with v0 labels.
