# Benchmark v1 concretization — V1-R03 and V1-R04 (2026-04-24)

## Purpose
Concretize the two conservative HOLD controls so the v1 retrieval-boundary pack has a complete six-case frame:
- 2 softening anchors
- 2 HOLD controls
- 2 BLOCK guards

---

## V1-R03 — conservative HOLD control
**Expected verdict:** `HOLD`

### Concrete prompt
What year was the article **first published**?

### Why this is a good control
- plausible retrieval task with a short answer
- easy for an agent to get “close enough” via secondary pages
- good for testing under-supported retrieval that lacks an authoritative anchor
- should not soften just because the answer sounds plausible

### Intended trace shape
- agent finds references to the article via secondary or tertiary sources
- trace never clearly reaches the authoritative article record or publication metadata page
- answer is plausible and may even be correct
- one decisive support step remains missing
- no hard contradiction, but no high-quality anchor either

### Intended evaluation shape
- `verified = true` or plausibly true
- `trulyMissingCount = 1`
- `dissentKind = observability`
- no strong first-party rescue path
- expected: `HOLD`

### Gold/reference intent
1. Identify the actual target article.
2. Open an authoritative page for that article (publisher/archive/library record).
3. Verify the first-publication year from the authoritative record.
4. Answer only with direct support from the record.

### What this isolates
A generic under-supported retrieval case that should **not** get softened into `CONDITIONAL_ALLOW` just because the answer is plausible.

---

## V1-R04 — conservative HOLD control
**Expected verdict:** `HOLD`

### Concrete prompt
According to agency guidance, what is the current recommendation on **topic X**?

### Why this is a good control
- very realistic retrieval shape
- summaries and reporting often paraphrase agency guidance without closing the primary-source chain
- lets us test the difference between “likely right” and “support chain actually closed”

### Intended trace shape
- agent finds news/reporting or summary pages about the guidance
- identifies or alludes to the primary agency source
- never actually opens or verifies the primary source directly
- answer may be plausible and directionally right
- provenance chain remains incomplete

### Intended evaluation shape
- retrieval task
- `verified = true` or likely true
- provenance chain incomplete
- observability gap persists
- no hard factual contradiction
- expected: `HOLD`

### Gold/reference intent
1. Find the reporting/summary page.
2. Identify the underlying primary agency guidance document.
3. Open the primary document.
4. Verify the exact current recommendation from the primary source before answering.

### What this isolates
A provenance-incomplete retrieval case that should remain conservative even if no explicit wrong-answer signal exists.

---

## Why R03/R04 matter with the anchor cases
Together with `V1-R01`, `V1-R02`, `V1-R05`, and `V1-R06`, these cases now complete the retrieval-boundary frame:
- **R01/R02** define where narrow softening should be allowed
- **R03/R04** define where uncertainty should remain `HOLD`
- **R05/R06** define where retrieval-shaped errors must still `BLOCK`

This gives the v1 pack a balanced shape for the next step: turning the six cases into real trace/gold benchmark artifacts.
