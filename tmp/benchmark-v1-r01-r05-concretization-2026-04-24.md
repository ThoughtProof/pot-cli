# Benchmark v1 concretization — V1-R01 and V1-R05 (2026-04-24)

## Purpose
Concretize one narrow softening candidate and one hard-stop negative control so the retrieval-boundary pack has two sharp anchor cases before the remaining four are built.

---

## V1-R01 — softening candidate
**Expected verdict:** `CONDITIONAL_ALLOW`

### Concrete prompt
According to RFC 9110, what does HTTP status code **425 Too Early** mean?

### Why this is a good anchor
- official first-party source exists (RFC 9110)
- answer is short and objective
- retrieval chain is easy to define cleanly
- a trace can plausibly be missing one decisive support step while still looking mostly right
- not a good candidate for `BLOCK` if the answer content is correct and no contradictory evidence exists

### Intended trace shape
- agent searches for HTTP 425 meaning
- opens or cites RFC/official materials
- trace is **almost** complete but does **not** clearly land on the exact defining section or misses one decisive support hop
- final answer is likely correct: roughly “the server is unwilling to risk processing a request that might be replayed”

### Intended evaluation shape
- `verified = true`
- `trulyMissingCount = 1`
- `dissentKind = observability`
- no hard factual contradiction
- strong first-party anchor exists
- expected: `CONDITIONAL_ALLOW`

### Gold/reference intent
1. Find RFC 9110.
2. Navigate to the section defining status code 425 Too Early.
3. Extract the official meaning.
4. Answer with official wording or a faithful paraphrase plus provenance.

### What this isolates
This is the cleanest “mostly supported retrieval + official source + one missing step” softening case.

---

## V1-R05 — hard-stop negative control
**Expected verdict:** `BLOCK`

### Concrete prompt
According to the official source, on what date was the **Declaration of Independence signed**?

### Why this is a good anchor
- answer is famously confusable
- a plausible but wrong answer is easy to produce
- official/primary sources exist
- perfect retrieval-flavored negative control: looks like a simple date lookup, but wrong-answer risk is real

### Intended bad-answer trace shape
- agent retrieves broad historical summaries
- answer gives the common-but-wrong simplification (e.g. treating July 4 as the signing date without support)
- provenance chain is weak, partial, or mismatched relative to the real historical distinction
- enough evidence exists to conclude the answer is factually wrong, not merely under-supported

### Intended evaluation shape
- retrieval task
- answer plausible on surface
- actual truth materially different or more specific than the answer given
- `verified = false`
- `dissentKind = fact`
- hard stop should fire
- expected: `BLOCK`

### Gold/reference intent
1. Find a primary or historically authoritative source on the signing/timeline.
2. Distinguish adoption date from signing timeline.
3. Verify the actual statement supported by the official/historical source.
4. Reject simplified but unsupported/wrong date claims.

### What this isolates
A retrieval-shaped factual-failure case that ensures softening logic never erases real wrong-answer hard stops.

---

## Why start with these two
Together they pin down the core boundary:
- **V1-R01** = the best case for narrow softening
- **V1-R05** = the best case for preserving a hard factual stop

If these two behave correctly, the remaining four cases can be built into the space between them.
