# ThoughtProof Product Tiers — v1 / v2 (2026-04-24)

## Core Idea
ThoughtProof ships as two verification tiers, not one monolithic product.

- **v1 (Answer-Level)** — verifies the final claim against source evidence
- **v2 (Plan-Level)** — verifies the reasoning plan structure, step dependencies, and execution safety

v2 includes v1. They share the same API surface but different endpoints and pricing.

---

## Why two tiers

### Customer reality
Not every agent needs plan-level verification.

| Use case | Needs | Tier |
|----------|-------|------|
| RAG chatbot answering factual questions | Answer + source check | v1 |
| Customer support bot | Answer + source check | v1 |
| Research assistant summarizing papers | Answer + source check | v1 |
| Medical agent suggesting treatment plans | Full plan + safety checks | v2 |
| Incident-response agent executing recovery | Full plan + safety checks | v2 |
| Financial agent making trade recommendations | Full plan + safety checks | v2 |
| Autonomous coding agent with deploy access | Full plan + safety checks | v2 |

### Business logic
- v1 = low barrier to entry, easy to understand, easy to sell
- v2 = higher value, higher price, stronger moat
- Natural upsell path: customer starts with v1, moves to v2 when agents get more autonomous

---

## API Design

```
POST /v1/check    →  Answer-Level Verification
POST /v2/check    →  Plan-Level Verification (includes v1)
```

### v1/check — request
```json
{
  "claim": "Berlin is the capital of Germany.",
  "sources": ["https://en.wikipedia.org/wiki/Berlin"],
  "trace": { ... }    // optional, improves verdict quality
}
```

### v2/check — request
```json
{
  "claim": "The patient should taper opioids by 10% per week.",
  "sources": ["https://www.cdc.gov/..."],
  "trace": { ... },   // required for plan extraction
  "plan_mode": "auto"  // or "gold" for pre-curated plans
}
```

### Response (both tiers)
```json
{
  "verdict": "BLOCK",
  "confidence": 0.94,
  "tier": "v2",
  "details": {
    "answer_level": { "verdict": "CONDITIONAL_ALLOW", "reason": "..." },
    "plan_level": { "verdict": "BLOCK", "reason": "Critical step skipped: ..." }
  }
}
```

Key: v2 response always includes both layers. The customer sees exactly where the problem is — answer-level, plan-level, or both.

---

## Pricing

| Tier | Fast | Standard | Deep |
|------|------|----------|------|
| v1/check | $0.008 | $0.02 | $0.08 |
| v2/check | $0.05 | $0.15 | $0.50 |

### Rationale
- v2 is ~6x more expensive because it runs plan extraction + step-level verification + dependency analysis
- v2/deep at $0.50 is still cheap compared to the cost of an unsafe autonomous action
- v1 stays accessible for high-volume RAG use cases

---

## What each tier actually checks

### v1 — Answer-Level
1. Source provenance — does the source say what the agent claims?
2. Retrieval completeness — did the agent consult sufficient evidence?
3. Factual correctness — is the final answer correct?
4. Verdict: ALLOW / CONDITIONAL_ALLOW / HOLD / BLOCK

### v2 — Plan-Level (includes all of v1, plus:)
5. Step extraction — identify the reasoning steps in the trace
6. Criticality tagging — which steps are load-bearing?
7. Support verification — is each critical step supported by evidence?
8. Dependency analysis — do steps follow in the right order? Are prerequisites met?
9. Execution safety — would acting on this plan be safe?
10. Verdict: same scale, but informed by structural analysis

---

## Positioning

### v1 tagline
> "Fact-check for AI agents."

### v2 tagline
> "QA system for autonomous AI."

### Combined
> "ThoughtProof: Verification before settlement."

---

## Strategic advantages of tiered approach

### 1. Land and expand
Start customers on v1 (low friction, low cost). Move them to v2 when they deploy autonomous agents.

### 2. Clear moat separation
v1 is defensible but reproducible. v2 (plan-level with step ontology + execution-risk detection) is genuinely hard to replicate.

### 3. Honest pricing
Customer pays for what they need. No one is forced into plan-level pricing for a simple chatbot.

### 4. Clean engineering
v2 builds on v1. Same codebase, same API surface, additional verification layers. No code duplication.

### 5. Regulatory alignment
Healthcare, finance, aviation — regulated industries will want v2 specifically. Having it as a named tier makes procurement easier.

---

## What this does NOT mean
- v1 is not "the cheap version" — it is the right tool for simpler use cases
- v2 is not "v1 but better" — it is a different verification unit for different problems
- We do not deprecate v1 when v2 ships — they coexist permanently

---

_Draft: 2026-04-24. Subject to PLV pilot results._
