# Perplexity Computer Mission — PLV Parser Calibration Problem

## Context
We are building Plan-Level Verification (PLV) for ThoughtProof — a system that verifies whether AI agent reasoning traces are structurally sound, not just whether the final answer is correct.

## The architecture
1. A **gold step graph** defines the ideal reasoning plan (what steps SHOULD be taken)
2. Each step has a **criticality tag** (critical / supporting / optional)
3. A **parser/evaluator** reads the raw agent trace and assigns **support predicates** to each gold step: supported / unsupported / skipped
4. The PLV verdict is derived: 2+ critical steps unsupported/skipped → BLOCK, 1 → HOLD, 0 → ALLOW

## What works
- Gold-plan PLV (human evaluates support): 100% accuracy on 15-item pilot
- Support-only evaluation (model given gold steps, evaluates support only): 88% step-level agreement, 85% on critical steps
- B-family (execution risk, skipped safeguards): 100% across all approaches — SOLVED

## The specific problem we need help with
Support-only evaluation has a **calibration gap on thin traces**:

### Problem 1: H-family (retrieval boundary) — too soft
Traces that technically performed a retrieval step but with sparse evidence get rated "supported" when they should be "unsupported."

Example: A trace searches for "RFC 9110 status code 425" and fetches the RFC page. The gold step says "Extract the official definition verbatim." The trace never shows the extracted text, but the evaluator says "supported" because a fetch was performed.

Gold says: unsupported (the extraction step was not completed)
Model says: supported (a fetch was done, so extraction probably happened)

### Problem 2: D-family (negative control) — inconsistent
Complex reasoning traces (e.g., GDPR analysis) sometimes get all steps rated "supported" even when the trace reaches the wrong conclusion — because the trace performed the steps but applied them incorrectly.

## What we've tried
- **4 different models** as full extractors (Grok, Grok v2, DeepSeek, Sonnet): all plateau at 60%
- **Sharpened prompts** with "mentioned ≠ verified" distinction: fixes C-family, breaks H-family
- **Majority vote ensemble**: no improvement (60%)
- **Support-only with gold steps**: fixes C-family (3/4 vs 1/4), but H-family drops to 1/4

## Research questions for Perplexity

### Q1: Calibrated support evaluation
What approaches exist in the literature or practice for calibrating "was this reasoning step actually performed" judgments on LLM traces? Specifically:
- How to distinguish "step was attempted" from "step was completed with verifiable evidence"
- How to handle thin/sparse traces where evidence is implicit
- Any work on graded support (not just binary supported/unsupported)

### Q2: Plan-level verification in practice
Are there existing systems or papers that do plan-level verification of AI agent traces? Specifically:
- Evaluating structural correctness of reasoning chains (not just answer correctness)
- Step-level verification against reference plans
- Support predicate assignment for reasoning steps

### Q3: The "performed but wrong" problem
How to detect cases where a trace technically performs all required steps but applies them incorrectly? This is different from skipping steps. The trace does the work but reaches the wrong conclusion through subtle misapplication.

### Q4: Practical parser architecture
Given that:
- Full extraction (generate plan + evaluate) fails
- Support-only (given plan, evaluate) mostly works but needs calibration
- The bottleneck is support predicate accuracy on thin traces

What architecture would you recommend? Options we're considering:
1. Graded support scale (0-1 instead of binary)
2. Evidence-citation requirement (model must cite specific trace text)
3. Dual evaluator with agreement gate
4. Hybrid: support-only for rich traces, fallback to answer-level for thin traces

### Q5: Token-efficient implementation
Given that this needs to run at scale ($0.05-0.50 per verification), what's the most token-efficient way to implement support evaluation? Chain-of-thought vs structured output vs few-shot vs fine-tuning?

## Data available
- 15-item pilot with gold step graphs, 4 model extraction results, support-only evaluation results
- 4 families: B (execution risk), C (dependency chain), D (negative control), H (retrieval boundary)
- Full comparison data showing exactly which items each approach gets right/wrong

## What we need back
1. Literature pointers (papers, systems, approaches)
2. Concrete architecture recommendation
3. Specific prompt/calibration techniques for the thin-trace problem
4. Any "you're solving the wrong problem" insights
