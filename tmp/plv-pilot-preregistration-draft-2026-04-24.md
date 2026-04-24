# PLV Pilot — Preregistration Draft (2026-04-24)

## What this document is
A preregistration protocol for a small, focused experiment testing whether **Plan-Level Verification (PLV)** discriminates on structural failure cases better than the current answer-level verifier.

This is not a product spec. It is a scientific protocol.

---

## 1. Background

### What ThoughtProof v0 actually does
ThoughtProof v0 verifies **answer-level provenance**: was the final claim entailed by a retrieved span? This is the R6 mechanic from the retrieval-memo line.

### What PLV would do
PLV verifies **the sequence of load-bearing reasoning steps as a graph**. Each step gets its own predicate — `supported` / `unsupported` / `skipped` / `not_required` — and the policy operates over the **structure of the plan**, not only the endpoint.

### Why this is a different verification unit
This is not "check more steps." It is a change in verification unit:
- v0: `(claim, source)` → verdict
- PLV: `(plan_dag, source_bundle)` → verdict

The failure modes live in the graph structure, not in the final node.

---

## 2. Research question

**Primary question:**
Does PLV produce measurably different (and post-hoc defensibly better) verdicts than answer-level verification on structural failure cases?

**Null hypothesis (H₀):**
PLV and answer-level verification produce equivalent verdict distributions on a preregistered item set drawn from the v0-spine harvest.

**Alternative hypothesis (H₁):**
PLV produces at least one verdict class (B or C family items) where it discriminates correctly and answer-level verification does not.

---

## 3. Scope

### Item set
- **n = 12–16 items** from the existing v0-spine harvest
- **4 families**, 3–4 items each:
  - **B** — unsupported critical step
  - **C** — broken dependency chain
  - **D** — decision defensibility (wrong answer / factual failure)
  - **H** — retrieval HOLD (observability boundary)

### Why these families
- B and C are **structural diagnoses** that answer-level verification cannot cleanly express
- D is a **negative control** (answer-level should already catch these)
- H is a **boundary control** (PLV should not over-soften retrieval HOLDs)

### Matched-pair structure
Where possible, use matched pairs within the same domain but different families:
- Same question topic, different structural failure shape
- This controls for domain/topic confounds

---

## 4. Design

### Two verifiers, parallel
1. **Answer-Level Verifier** (current v0 path)
2. **Plan-Level Verifier** (new PLV path)

Both run on the same item set. No ensemble. No merging. Standalone comparison.

### Step ontology (minimal, preregistered)

#### Support predicates (per step)
| Predicate | Meaning |
|---|---|
| `supported` | Step is entailed by available evidence |
| `unsupported` | Step has no evidential support in the trace |
| `skipped` | Step was required but never executed |
| `not_required` | Step is not load-bearing for the conclusion |

#### Criticality tags (per step)
| Tag | Meaning |
|---|---|
| `critical` | Step is load-bearing; if unsupported/skipped, the conclusion is not defensible |
| `supporting` | Step strengthens the conclusion but is not individually decisive |
| `optional` | Step is useful but not required for defensibility |
| `unknown` | Criticality could not be determined |

### Plan extraction
For this pilot:
- **Gold plans** (human-curated step graphs) for all items
- No model-extracted plans in the primary analysis
- Optional: secondary run with model-extracted plans to measure parser agreement

**Rationale:** If PLV cannot discriminate on gold plans, it cannot discriminate at all. Parser noise is a real risk, but it should be measured separately, not confounded with the primary question.

### Verdict mapping
Both verifiers produce one of:
- `ALLOW`
- `CONDITIONAL_ALLOW`
- `HOLD`
- `BLOCK`

---

## 5. Preregistered metrics

### Primary metric
**(a)** Proportion of items where PLV and answer-level verdicts **diverge**.

### Secondary metrics
**(b)** Of divergent items: proportion where PLV verdict is **post-hoc defensibly correct** (judged by a blinded human rater or a third-party model critic).

**(c)** Cluster-bootstrap confidence interval (BCa) over **items**, not steps.

**Why cluster-bootstrap over items:**
With ~4 steps per plan on n=12–16, step-level analysis produces ~50–60 step verdicts. But steps within an item are strongly correlated. Treating them as independent inflates evidence. The unit of analysis is the item.

---

## 6. Primary claim (preregistered)

> On families B and C, PLV produces a measurable discrimination that answer-level verification does not.

**Boundary conditions:**
- D family items should show **no divergence** (both verifiers should BLOCK)
- H family items should show **no dangerous softening** (PLV should not promote HOLDs to ALLOW)

If B/C discrimination holds and D/H boundaries hold, the claim is supported.

If B/C discrimination holds but D or H boundaries break, the claim is **not** supported — PLV is over-fitting on structural signal at the cost of safety.

---

## 7. What this is NOT

### Not a product launch
PLV is not shipping as a feature from this pilot. This is a scientific protocol.

### Not a marketing claim
"ThoughtProof now also checks plans" would dilute methodological credibility. The framing should be: "We ran a preregistered pilot comparing two verification units."

### Not merged with v3
v3 is **counterfactual execution safety** ("would this action be unsafe?"). PLV is **structural verification** ("is this plan defensible?"). They require different rubrics. Mixing them loses both.

---

## 8. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Parser noise (model-extracted plans) | High | Use gold plans for primary analysis; measure parser agreement separately |
| Step-criticality ambiguity | High | Preregister the criticality ontology; use gold annotations; acknowledge residual ambiguity |
| n-inflation (step-level pseudo-evidence) | Medium | Cluster-bootstrap over items, not steps |
| Overfit to v0-spine prototype scope | Medium | Acknowledge scope limitation; do not generalize beyond the tested families |
| PLV looks like "just more steps" | Low | Frame as verification-unit change, not feature addition |

---

## 9. Practical next steps

### Phase 1 — Gold plan curation (est. 1–2 sessions)
- Select 12–16 items from the v0-spine harvest
- Curate gold step graphs with criticality tags
- Validate matched-pair structure

### Phase 2 — Dual verifier run (est. 1 session)
- Run answer-level verifier on all items
- Run PLV on all items (gold plans)
- Record raw verdicts

### Phase 3 — Analysis (est. 1 session)
- Compute divergence metrics
- Cluster-bootstrap CIs
- Post-hoc defensibility judgment on divergent items
- Write up result

### Phase 4 — Optional parser robustness check
- Run PLV again with model-extracted plans
- Compare to gold-plan PLV verdicts
- Measure parser agreement rate

---

## 10. One-liner

> PLV is the right next verification unit, but only if parser noise, step criticality, and cluster variance are preregistered — otherwise it is an expensive way to reproduce the same R6 results at higher resolution.

---

_Draft: 2026-04-24. Not yet executed._
