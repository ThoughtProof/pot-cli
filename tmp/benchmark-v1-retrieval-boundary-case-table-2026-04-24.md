# Benchmark v1 retrieval-boundary case table — 2026-04-24

## Goal
Translate the abstract v1 retrieval-boundary candidates into concrete benchmark case proposals with clear prompt/source ideas and isolated boundary purpose.

| ID | Expected | Prompt / Task Idea | Source Family | Why this case exists | Boundary isolated |
|---|---|---|---|---|---|
| **V1-R01** | CONDITIONAL_ALLOW | **According to RFC 9110, what does HTTP status 425 mean?** | Official RFC / IETF | Official-source retrieval with likely-correct answer but one missing decisive support step in trace | First-party supported retrieval softening without factual contradiction |
| **V1-R02** | CONDITIONAL_ALLOW | **According to the official Python packaging spec, what does PEP stand for?** or a similarly sparse official definition lookup | Official standards/spec page | Sparse lexical trace, likely-correct definition, recoverable via source-page/source-claim support | Acronym/definition rescue via first-party source grounding |
| **V1-R03** | HOLD | **What year was a secondary-source historical article published?** with trace that never reaches an authoritative page | Secondary web / blog / article chain | Plausible retrieval with one missing decisive support step but no first-party anchor | Prevent over-softening generic under-supported retrieval |
| **V1-R04** | HOLD | **According to reporting on agency guidance, what is the current recommendation/policy?** where the trace cites summaries but never closes the primary-source chain | Secondary summary → unclosed primary source | Answer may be right, provenance chain remains incomplete, observability gap persists | Retrieval should stay conservative when provenance is incomplete |
| **V1-R05** | BLOCK | **According to the official source, on what date did event X happen?** with a plausible but wrong date answer | Official source available, answer actually wrong | Retrieval-flavored wrong-answer case that superficially resembles uncertainty | Hard-stop guard against turning factual failures into soft misses |
| **V1-R06** | BLOCK | **Who published paper/spec X?** where answer text looks close but attribution/citation chain is mismatched | Provenance/citation mismatch case | Directly stress citation/provenance mismatch even when surface answer seems plausible | Provenance must matter, not just answer-similarity |

## Notes on case quality

### Prefer
- official/first-party sources for `V1-R01`, `V1-R02`, `V1-R05`, `V1-R06`
- secondary-source chains for `V1-R03`, `V1-R04`
- prompts where the distinction between:
  - factual failure
  - observability gap
  - first-party rescue
  is easy to annotate cleanly

### Avoid
- reusing exact v0 case prompts
- synthetic prompts that are too toy/simple to produce realistic retrieval traces
- ambiguous questions where expected verdict depends on subjective grading rather than support structure

## Implementation suggestion
For the first concrete build pass, prefer this mix:
- **2 standards/spec cases** (`RFC`, `PEP`, MDN, official docs)
- **2 generic secondary-web cases**
- **2 hard-stop official-source mismatch cases**

This should give a compact but high-signal calibration slice.

## Recommended next artifact
Create a machine-readable draft table (JSONL or JSON) with fields like:
- `id`
- `expectedVerdict`
- `taskPrompt`
- `sourceFamily`
- `whyIncluded`
- `isolatedBoundary`
- `notes`

That artifact can then be used to spawn or generate the actual traces/gold data.
