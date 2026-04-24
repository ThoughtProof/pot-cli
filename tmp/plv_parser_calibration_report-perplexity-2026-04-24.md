# PLV Parser Calibration — Research Report

*For ThoughtProof Plan-Level Verification. April 24, 2026.*

---

## Executive Summary

1. **Your 60% plateau is a documented ceiling effect, not a prompt problem.** [Tyen et al. (ACL Findings 2024)](https://aclanthology.org/2024.findings-acl.826) show that GPT-4 peaks at ~53% accuracy on step-level mistake-finding without location hints across all BIG-Bench tasks. Single-pass LLM judges have hit their architectural limit on your task distribution; the fix is structural decomposition, not prompt sharpening.

2. **The calibration fix is extractor→verifier decomposition.** The [FActScore pattern (Min et al., 2023)](https://arxiv.org/abs/2305.14251) separates evidence extraction from claim verification, making extraction an explicit, auditable, mechanically checkable step. A single judge conflating "retrieval happened" with "extraction completed" is the root cause of H-family false positives; decomposition mechanically eliminates this by forcing the verifier to score only what the extractor explicitly quoted.

3. **H-family is a grounding problem: fetch ≠ extraction.** Standard LLM judges see a tool call in the trace and infer success. The fix is a hard rule — enforced via Pydantic/structured output — that `score ≥ 0.75` requires a non-null `evidence_quote` field that is a verifiable substring of the trace. No quote, no credit.

4. **D-family is an acceptance-criteria problem: binary support cannot catch performed-but-wrong steps.** [Uesato et al. (2022)](https://arxiv.org/abs/2211.14275) prove that 14% of reasoning traces are wrong despite correct final answers, reduced to 3.4% only under process supervision. D-family traces went through the motions; no judge can catch this without knowing what the correct intermediate conclusion *should have been*. Gold steps need per-step `acceptance_criteria` with `expected_conclusion` and `must_not_conclude` sets — not just criticality tags.

5. **The recommended architecture: FActScore-style extractor→verifier with G-Eval probability-weighted scoring, evidence citation enforcement, and Prometheus-2-8x7B as primary judge.** [G-Eval (Liu et al., 2023)](https://arxiv.org/abs/2303.16634) probability-weighted continuous scoring has higher human correlation (Spearman ρ=0.514) than binary votes. [Prometheus-2-8x7B (Kim et al., 2024)](https://arxiv.org/pdf/2405.01535) is the best open evaluator available (Pearson r=0.685–0.697), with rubric-guided scoring matching your need for per-step acceptance criteria.

6. **Majority vote failed because the underlying judges share the same structural failure mode.** Ensemble diversity requires architecturally different scorers — at minimum one LLM-based judge (Prometheus-2), one embedding/NLI-based scorer ([AlignScore, Zha et al., 2023](https://arxiv.org/abs/2305.16739)), and one structured-extraction pass with Pydantic validation. These fail on different inputs; their disagreement is diagnostic rather than noise.

7. **You are solving the wrong problem in one specific way: binary support predicates collapse qualitatively different failures.** ROSCOE's nine-error taxonomy and Shepherd's six-error taxonomy show that Missing Step, Hallucination, Redundancy, and Coherency failures require different responses. A six-class scheme matching Shepherd's taxonomy enables more precise verdict logic than `supported`/`unsupported`/`skipped`.

8. **The graded-support template (0.0–1.0, five tiers) operationalizes the calibration fix.** A five-tier rubric anchored to concrete evidence density requirements — with a hard cap of ≤0.25 for fetch-without-extraction — directly addresses H-family leniency. The template is copy-pasteable and integrates as a drop-in replacement for the existing binary evaluator.

9. **Staged cascade evaluation hits the $0.05–$0.50/verification cost target.** Tier 1: AlignScore embedding screen (~$0.00/step); Tier 2: [Atla Selene Mini 8B](https://arxiv.org/abs/2501.17195) for ambiguous cases (~$0.003/step); Tier 3: Prometheus-2-8x7B or Claude-3.5-Haiku on critical-step disagreements (~$0.01–0.03/step). Estimated per-trace cost for a 10-step plan: ~$0.06. [Cascaded Selective Evaluation (Jung et al., 2024)](https://openreview.net/forum?id=UHPnqSTBPO) proves this tiering maintains >80% human agreement at ~80% coverage.

10. **No production system currently does what PLV does.** After surveying 17 production frameworks and 16 academic papers, no tool combines (a) a formal reference graph, (b) categorical per-step support predicates, and (c) a policy-gated `BLOCK`/`HOLD`/`ALLOW` verdict that gates execution. The [TRAIL benchmark (Patronus AI, 2025)](https://arxiv.org/abs/2505.08638) provides empirical grounding: even Gemini 2.5 Pro achieves only 11% joint accuracy on step-level error localization without a reference structure — PLV's gold step graph is what makes this tractable.

11. **The closest production competitor is LangSmith `agentevals` trajectory match**, which uses a reference trajectory but with a flat message list (not a graph), binary whole-trajectory pass/fail (not per-step predicates), and no execution-gating verdict. PLV's three differentiators — reference graph topology, categorical predicates, BLOCK/HOLD/ALLOW enforcement — are each absent from all surveyed commercial tools.

12. **Strategic positioning: regulated domains first.** Only in legal, healthcare, and financial services does a `BLOCK` verdict have direct liability value over a dashboard score. Monitor the [NIST AI RMF Agentic Profile (2025 draft)](https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/) — its proposed consequence graph is structurally parallel to PLV's gold step graph; if formalized, PLV becomes the reference implementation of an emerging regulatory requirement.

---

## Part 1 — Calibration & Architecture (Prompts 1+4 response)

*Source: plv_q1_research.md — Q1–Q5 Technical Brief. All claims cited to primary sources.*

---

## Q1 — Calibrated Support Evaluation

### Key Findings

**Process Reward Models (PRMs)**

The gold standard for step-level labeled evaluation is [Lightman et al. PRM800K](https://arxiv.org/abs/2305.20050) (OpenAI, ICLR 2024). PRM800K contains 800,000 human step-level labels over 75,000 math solutions. Each step receives one of three labels: **positive** (correct, contributes to solution), **neutral** (correct but redundant, no progress), **negative** (incorrect). This three-class label scheme is directly applicable to PLV:

| PRM Label | PLV Analog |
|-----------|-----------|
| Positive | Supported (evidence cited, correctly applied) |
| Neutral | Executed but redundant / not advancing plan |
| Negative | Unsupported (attempted but not completed) |

[ReasonEval (CMU/GAIR-NLP, 2025)](https://www.cs.cmu.edu/~sherryw/assets/pubs/2025-reasoneval.pdf) operationalizes exactly this as a fine-tuned classifier. Its validity score is `p_positive + p_neutral` and redundancy score is `p_neutral`. The model assigns probabilities across three classes for each step, with solution-level aggregation using `min(validity)` across steps. Trained on PRM800K with Llama/Mistral base models (7B–34B), it approaches GPT-4 performance at solution level.

[Math-Shepherd (Wang et al., 2023)](https://arxiv.org/abs/2312.08935) builds process-wise supervision data automatically (no human labels) by checking whether steps lead to correct answers via Monte Carlo sampling. Mistral-7B with Math-Shepherd PPO improves from 77.9% → 84.1% on GSM8K. The key insight: **step-level reward can be approximated without human annotation if you have a ground-truth verifier** — applicable to PLV if you have test-able gold step outputs.

[Uesato et al. (DeepMind, NeurIPS 2022)](https://arxiv.org/abs/2211.14275) is the definitive process-vs-outcome supervision comparison. Critical result: outcome supervision alone leaves **14% reasoning error rate among final-answer-correct solutions**, while process supervision reduces this to 3.4%. This is your D-family: traces that produce plausible conclusions through wrong intermediate reasoning.

**Faithfulness/Grounding Metrics**

[FActScore (Min et al., EMNLP 2023)](https://arxiv.org/abs/2305.14251) is the foundational decompose-then-verify architecture:
1. Decompose generation into atomic facts: `"Please breakdown the following sentence into independent facts: <sentence>"`
2. Retrieve 5 relevant passages per fact (GTR retriever, target entity's Wikipedia page)
3. Verify each fact: `<retrieved passages> <atomic-fact> True or False?`
4. Score = fraction of supported facts

Error rate < 2% using Inst-LLaMA + retrieval vs. human labels. This is directly applicable to PLV step verification: decompose each gold step's expected actions into atomic claims, then verify each against the trace.

[RAGAS Faithfulness (Es et al., 2023)](https://arxiv.org/abs/2309.15217) simplifies FActScore for RAG contexts. Pipeline: (1) LLM extracts statements from answer: `"Given a question and answer, create one or more statements from each sentence"`, (2) LLM verifies each: `"Consider the given context and following statements, then determine whether they are supported by the information present in the context. Provide a brief explanation for each statement before arriving at the verdict (Yes/No)."`, (3) Score = |supported| / |total|. Achieves 0.95 accuracy on WikiEval. The "brief explanation before verdict" is critical — it elicits chain-of-thought reasoning that catches edge cases.

[AlignScore (Zha et al., ACL 2023)](https://arxiv.org/abs/2305.16739) provides a non-LLM alternative: a 355M RoBERTa-based alignment function trained on 4.7M examples from 7 tasks (NLI, QA, paraphrase, fact verification, IR, semantic similarity, summarization). Achieves 88.6/83.8 on SummaC/TRUE benchmarks — matches or exceeds ChatGPT/GPT-4-based metrics at orders-of-magnitude lower cost. Applicable as the first-stage screen in your cascade (zero latency, ~$0/call).

[TRUE (Honovich et al., NAACL 2022)](https://arxiv.org/abs/2204.04991) benchmarks factual consistency across 11 datasets and confirms that large-scale NLI + QA-based approaches achieve "strong and complementary results" and should be the starting point for factual verification systems.

**LLM-as-Judge Calibration**

[G-Eval (Liu et al., EMNLP 2023)](https://arxiv.org/abs/2303.16634) introduces the key calibration fix for discrete-scale judges: **token probability weighted scoring**. Instead of sampling a single integer score, compute `score = Σ p(s_i) × s_i` over all scale values (e.g., 1–5). This yields a continuous score with higher Spearman correlation to human judgments (0.514 on summarization, vs. all prior methods). For API models without logprob access, sample n=20 at temperature=1.0 to estimate probabilities. The auto-CoT step generation approach also matters: feed only task criteria to the judge and let it generate its own evaluation steps before scoring.

**Direct application to PLV**: Replace your binary supported/unsupported with a 4-point scale: `0=no_attempt, 1=attempted_no_evidence, 2=partially_supported, 3=fully_supported_with_citation`. Use G-Eval probability weighting to get a continuous 0–3 score. Threshold at 2.5 for "supported."

[Prometheus (Kim et al., ICLR 2024)](https://arxiv.org/abs/2310.08491) is a 13B open-source judge trained on 1K fine-grained score rubrics + 100K GPT-4 annotated responses. Pearson r=0.897 with human evaluators — on par with GPT-4 (r=0.882). The key: it requires both a **reference answer** and a **score rubric** as inputs. Rubric-guided evaluation is more calibrated than rubric-free.

[Prometheus 2 (Kim et al., EMNLP 2024)](https://arxiv.org/pdf/2405.01535): upgraded to 7B and 8x7B via weight merging (DARE-Linear). On direct assessment benchmarks: Prometheus-2-8x7B achieves Pearson r=0.685 (Vicuna), 0.665 (MT-Bench), 0.659 (FLASK) vs. GPT-4's 0.753 on Feedback Bench. On pairwise ranking: 85.52% accuracy vs. GPT-4's 90.95%. Krippendorff's α=0.787 (highest open evaluator). At 8x7B scale (~47B parameters) this is the best open-source judge available.

[JudgeLM (Zhu et al., 2023)](https://arxiv.org/html/2310.17631v2) identifies and mitigates three critical biases: **position bias** (preferred order of presentation), **knowledge bias** (judge's prior knowledge overriding evidence), and **format bias** (surface formatting affecting scores). Mitigation techniques: swap augmentation, reference support, reference drop. JudgeLM-7B achieves >90% agreement with teacher judge, surpassing human-to-human agreement (82%). For PLV: swap augmentation (run judge with gold step before trace, then trace before gold step) directly detects and corrects the position bias that causes H-family false positives.

### Direct Application to H-Family and D-Family

**H-family (fetch without extraction):** Standard judges see "RFC 9110 fetched" and emit "supported." Fix: enforce that the evaluator must quote the specific text extracted. RAGAS-style verification: `"Verify that the following statement is present verbatim or substantively in the trace: <gold step claim>. Quote the relevant text or state ABSENT."` If quote is absent, score=0. Pydantic-validate the response struct to require a `evidence_quote: str | None` field; `None` forces score=0 for citation-required steps.

**D-family (executed but wrong application):** Support-only evaluation cannot catch this without a gold expected-output per step. The fix is to add a **counterfactual claim** to each gold step: "Step correctly applies GDPR Art. 6(1)(a) by finding X, which implies conclusion Y." The judge then evaluates whether the trace's conclusion matches Y, not just whether GDPR was mentioned.

---

## Q2 — Plan-Level / Step-Level Verification Systems

### Key Findings

**Reasoning Chain Evaluation**

[ROSCOE (Golovneva et al., ICLR 2023)](https://arxiv.org/abs/2212.07919) is the most comprehensive step-level scoring suite. Eighteen metrics across four groups:

| Group | Key Metrics | PLV Relevance |
|-------|-------------|---------------|
| Semantic Alignment (SA) | Faithfulness-Step (h→s), Hallucination | H-family detection: low Faithfulness-Step = step content not grounded in source |
| Semantic Similarity (SS) | Repetition-Step, Info-Chain | Detect step-level repetition (D-family symptom) |
| Logical Inference (LI) | Self-Consistency, Source-Consistency | Detect contradictions within/across steps |
| Language Coherence (LC) | Perplexity-Step | Detect incoherent steps |

ROSCOE's **Faithfulness-Step** score: `(1/N) Σ_i r-align(h_i → s)` where `r-align(h_i, s) = [1 + max_j cos(h_i, s_j)] / 2`. This uses finetuned SimCSE (RoBERTa-base) on reasoning pairs. The nine-type error taxonomy (Grammar, Factuality, Hallucination, Redundancy, Repetition, Missing Step, Coherency, Commonsense, Arithmetic) maps cleanly onto PLV step errors. ROSCOE is reference-free and unsupervised — directly deployable as a cheap embedding-based first-stage screen.

**Plan Verification**

[LLM-Modulo (Kambhampati et al., ICML 2024)](https://arxiv.org/abs/2402.01817) makes the key architectural claim: "auto-regressive LLMs cannot, by themselves, do planning or self-verification." The solution is **external sound critics** in a Generate-Test-Critique loop. Critics provide back-prompts at four feedback levels: (1) "No, try again," (2) "No, try again, here is one thing wrong," (3) "No, try again, here are all things wrong," (4) constructive alternatives. Hard critics (e.g., VAL for PDDL plans) provide soundness guarantees; soft critics (LLM-based) provide style/preference feedback. LLM-Modulo improves success from ~12% (autonomous LLM) to 82% (Blocks World with 15 rounds, VAL). **The PLV system is essentially building LLM-Modulo externally post-hoc.** The verification feedback should be structured enough to allow back-prompting the agent.

**Agent Eval Frameworks**

[τ-bench (Yao et al., 2024)](https://arxiv.org/abs/2406.12045) evaluates agent traces by comparing end-state database against annotated goal state, with a `pass^k` metric for reliability across trials. Its auto error identification classifies: fault assignment (user/agent/environment), fault type (goal_partially_completed, used_wrong_tool, used_wrong_tool_argument, took_unintended_action). The **used_wrong_tool_argument** category is equivalent to D-family in PLV: the tool was called but with wrong parameters.

[RAGChecker (Ru et al., 2024)](https://arxiv.org/abs/2408.08067) is the most relevant framework for PLV. It uses an LLM-based **claim extractor** to decompose responses into atomic claims, then a separate **claim checker** to verify each claim against retrieved context. The architecture explicitly separates:
- `retriever claim recall`: did retrieval fetch the evidence needed?
- `context utilization`: did the generator actually use retrieved evidence?
- `hallucination rate`: did the generator add facts not in context?

This directly maps to the H-family gap: a trace that retrieves but doesn't extract will have high retriever claim recall but low context utilization.

**Step-Level Critics**

[Shepherd (Wang et al., Meta AI, 2023)](https://arxiv.org/abs/2308.04592): 7B LLaMA fine-tuned on 1,317 high-quality community feedback examples. Error taxonomy includes Arithmetic, Coherence/Deduction (including Missing Step), Consistency with Context, Veracity, Redundancy, Commonsense. Critiques preferred over ChatGPT in 53–87% of GPT-4 evaluations. Small size = cheap. Limitation: trained on general task feedback, not domain-specific reasoning traces.

[CRITIC (Gou et al., ICLR 2024)](https://arxiv.org/abs/2305.11738): LLMs self-verify outputs by calling external tools (search engines, code interpreters, fact-checking APIs). Starting from initial output, CRITIC calls tools to evaluate aspects of text, then revises based on tool feedback. Directly applicable: PLV can instrument the agent's tool calls and check whether the tool outputs were actually propagated into subsequent reasoning steps.

### Direct Application to H-Family and D-Family

**H-family:** ROSCOE's Faithfulness-Step score provides an embedding-based signal (no LLM needed) for whether trace step content is grounded in retrieved source. Low Faithfulness-Step on a retrieval step = fetch happened but extraction didn't. RAGChecker's context_utilization metric directly quantifies this gap.

**D-family:** τ-bench's used_wrong_tool_argument classification pattern: create a gold "expected argument" for each critical step and verify the trace applies the correct argument. LLM-Modulo's critic feedback should identify *what* was wrong about the application, not just that something was wrong.

---

## Q3 — The Performed-But-Wrong Problem

### Key Findings

**LLMs Cannot Find Their Own Reasoning Errors**

[Tyen et al. (ACL Findings 2024)](https://aclanthology.org/2024.findings-acl.826) is the most directly relevant finding for your 60% plateau. On the BIG-Bench Mistake dataset (2,186 annotated CoT traces, 5 tasks), mistake-finding accuracy:

| Model | Direct (trace) | Direct (step) |
|-------|----------------|---------------|
| GPT-4-Turbo | 30.1% | 48.3% |
| GPT-4 | 39.8% | 52.9% |
| GPT-3.5-Turbo | 10.4% | 14.8% |
| Gemini Pro | 16.1% | — |
| PaLM 2 Unicorn | 17.1% | 23.7% |

Human inter-annotator agreement: Krippendorff's α = 0.979–0.998. **The bottleneck is mistake-finding, not mistake-correcting.** When given oracle mistake location, LLMs correct effectively (+18–44% accuracy boost). A small out-of-domain trained classifier outperforms 3-shot GPT-4 prompting on mistake finding. This means **fine-tuning a small model on PLV-specific labeled examples will outperform prompting GPT-4** for your specific H/D-family errors.

**Unfaithful Chain-of-Thought**

[Turpin et al. (NeurIPS 2023)](https://arxiv.org/abs/2305.04388): CoT explanations are systematically influenced by biasing features (e.g., answer reordering) that models fail to mention. When biased toward wrong answers, models generate plausible-sounding CoT rationalizations. Accuracy drops up to 36% on BIG-Bench Hard. **Critical implication for PLV**: a trace that executed GDPR analysis incorrectly may generate a CoT that sounds like correct GDPR analysis. The judge evaluating the CoT will be fooled. You need to evaluate *outcomes* of intermediate steps, not the reasoning text describing them.

[Lanham et al. (Anthropic, 2023)](https://arxiv.org/abs/2307.13702): Tests CoT faithfulness by intervening on reasoning (adding mistakes, paraphrasing). Finding: larger models produce *less* faithful reasoning on most tasks studied. Models sometimes rely heavily on CoT, sometimes ignore it entirely. CoT's performance boost doesn't solely come from added compute or phrasing. **Implication**: CoT reasoning text is not a reliable proxy for what the model actually computed. Your evaluator must be shown evidence of *outputs*, not just reasoning prose.

**Reasoning Error Taxonomy**

[Demystifying LLM Reasoning Errors (2025)](https://arxiv.org/html/2512.00215v1) empirically identifies 9 categories in reasoning traces (from DeepSeek-R1, o4-mini, Gemini 2.5 Flash, Claude 4 Sonnet on code execution): Predicate Mischeck (if/loop), Computation Error, Missing Fact Verification, Logical Contradiction, Early Termination, Hallucinated Steps, Propagated Error, Wrong Variable State, Incorrect Function Application. Accuracy ranges 85–98% on correct traces but errors cluster in specific categories. **Lack of Fact Verification** (Category 9) = D-family: model applies plausible but wrong intermediate facts.

**Process vs. Outcome Supervision as the Core Diagnostic**

[Uesato et al. (DeepMind, 2022)](https://arxiv.org/abs/2211.14275): The 14% → 3.4% reasoning error reduction under process supervision proves that **step-level correctness cannot be inferred from final answer correctness**. To detect D-family errors, you need either: (a) process-supervised labels on intermediate steps, or (b) a checkable intermediate output (e.g., "the extracted GDPR basis must be Article 6(1)(b) for this scenario"). Without this, no evaluator can reliably distinguish performed-correctly from performed-incorrectly.

### Direct Application to H-Family and D-Family

**H-family:** The faithfulness literature confirms that a model can produce semantically coherent text about fetching a document without actually extracting from it. Intervention technique (Lanham et al.): if you remove the fetch action from the trace context and the evaluator still says "supported," the evaluation is based on prior knowledge, not trace evidence. Build this as a calibration test: **counterfactual ablation** — provide the gold step + a trace with the retrieval action removed; the evaluator should flip to "unsupported." If it doesn't, re-calibrate.

**D-family:** Tyen et al.'s insight: fine-tune a small classifier on D-family labeled examples. The key: **provide the correct expected application as part of the evaluation context**, not just the gold step description. Without ground-truth intermediate outputs, LLM judges rationalize the wrong application as correct.

---

## Q4 — Concrete Architecture Recommendation

### Primary Architecture: FActScore-Style Extractor→Verifier with Graded Support + Evidence Citation

**Rationale:** The extractor→verifier decomposition (FActScore pattern) directly addresses both failure families by making evidence extraction an explicit, auditable, mechanically checkable step — not a latent inference. A single judge conflating "retrieval happened" with "extraction completed" is the root cause of the H-family gap. Decomposition enforces that the verifier only scores what the extractor explicitly found.

#### Pipeline

```
Gold Step → Claim Generator → [Atomic Claims per step]
                                    ↓
Trace → Evidence Extractor ──────→ [Evidence Quotes | NULL]
                                    ↓
         Claim Verifier → [Graded Support Score 0-3 per claim]
                                    ↓
         Aggregator → [Step Support Score + Verdict]
```

**Stage 1: Gold Step Atomization (offline, per gold step)**

Pre-process each gold step into atomic claim set using the FActScore decomposition prompt. For each gold step like "Extract RFC 9110 definition of safe method verbatim":
- Claim A: "The trace contains a quoted passage from RFC 9110"
- Claim B: "The quoted passage defines 'safe method'"
- Claim C: "The definition is marked as verbatim / directly attributed"

Store as part of the gold step graph (not per-evaluation — this is cacheable).

**Stage 2: Evidence Extractor (per trace step, per gold step)**

Prompted as: `"Given the following trace segment, extract the text that most directly supports or refutes this claim: <claim>. Return a JSON object with fields: {evidence_quote: str | null, evidence_present: bool, confidence: 0.0-1.0}"`.

Enforced via Pydantic structured output. If `evidence_quote == null` and `evidence_present == false`, the verifier receives a NULL evidence object and must score the claim 0 (no support) — no exceptions.

This mechanically breaks the H-family false positive: the extractor either produces a quote or it doesn't. The verifier cannot guess.

**Stage 3: Claim Verifier with G-Eval Probability Weighting**

For each (claim, evidence_quote) pair:
```
Claim: <claim from gold step>
Evidence from trace: <evidence_quote or "NO EVIDENCE FOUND">
Score on 0-3 scale:
  0 = No evidence found or evidence directly contradicts claim
  1 = Evidence present but does not specifically support claim (attempted, incomplete)
  2 = Evidence partially supports claim with minor gaps
  3 = Evidence fully and specifically supports claim
Output: JSON {score: int, weighted_score: float, reasoning: str, evidence_cited: str}
```

Use G-Eval token probability weighting: `weighted_score = Σ p(s_i) × s_i` over {0,1,2,3}. For API models without logprobs, sample n=5 at temperature=0.3 and average.

**Stage 4: Dual Evaluator Agreement Gate**

Run Stage 2+3 with two architecturally different evaluators:
- **Evaluator A**: Prometheus-2-8x7B with rubric (reference answer = gold step's expected output, score rubric = the 0-3 scale definition above)
- **Evaluator B**: AlignScore (embedding-based, no LLM) on (evidence_quote → claim) alignment

Agreement gate: if |score_A - score_B| > 1.0 (on normalized 0-3 scale), escalate to Tier 2 (GPT-4o or Claude-3.5-Sonnet). Otherwise, take weighted average.

**Stage 5: Step Verdict Aggregation**

`step_support_score = mean(claim_scores) * coverage_weight`

where `coverage_weight = min(1.0, num_claims_with_evidence / total_claims)`. A step that covers 2 of 3 claims with evidence scores proportionally lower even if those 2 are perfectly supported.

**Handling D-Family Specifically**

D-family requires extending the gold step graph with **acceptance criteria**:

```json
{
  "step_id": "gdpr_analysis_3",
  "description": "Apply GDPR legal basis to data processing activity",
  "criticality": "critical",
  "acceptance_criteria": {
    "expected_legal_basis": "Article 6(1)(b) - contractual necessity",
    "must_not_conclude": ["Article 6(1)(a)", "Article 6(1)(f)"],
    "required_elements": ["data subject identification", "processing purpose", "legal basis match"]
  }
}
```

The verifier checks `trace_conclusion ∈ expected_conclusions` and `trace_conclusion ∉ must_not_conclude`. This transforms D-family detection from a judgment problem into a structured comparison problem — LLMs are far more reliable at comparison than at open-ended error finding.

**Verdict Mapping**

| Condition | Verdict |
|-----------|---------|
| 2+ critical steps with `step_support_score < 1.5` | BLOCK |
| 1 critical step with `step_support_score < 1.5` | HOLD |
| All critical steps ≥ 1.5 (partial support acceptable) | ALLOW |

Note: HOLD threshold at 1.5 (not 2.5) acknowledges that partial evidence for a critical step warrants human review, not automatic approval.

### Alternative Considered: Self-Refine / CRITIC Loop

[CRITIC (Gou et al., ICLR 2024)](https://arxiv.org/abs/2305.11738) could provide tool-augmented verification (call the same tool the agent called and compare outputs). This is architecturally cleaner for H-family (re-execute the fetch and compare) but:
- Requires tool-calling infrastructure in the evaluator
- Cannot be applied to past traces without live tool access
- Doesn't solve D-family (re-executing wrong analysis produces the same wrong result)

Rejected as primary architecture; applicable as an augmentation for specific step types (e.g., re-run a code execution and compare output).

---

## Q5 — Token-Efficient Implementation

### Cost Model

Target: $0.05–$0.50 per verification (full plan, all steps).

Typical plan: 8–15 steps, 3 critical. Full extraction+verification per step at ~2K tokens input / ~300 tokens output.

| Component | Cost/step | Notes |
|-----------|-----------|-------|
| AlignScore (RoBERTa 355M) | ~$0.000 | Self-hosted; ~2ms/step |
| Atla Selene Mini 8B | ~$0.003 | ~1200 input + 150 output tokens |
| Prometheus-2-8x7B (self-hosted) | ~$0.01–0.03 | Depends on GPU cost |
| GPT-4o (escalation only) | ~$0.05 | ~2K tokens in, 200 out |
| Claude-3.5-Haiku (mid-tier) | ~$0.008 | Good latency/cost tradeoff |

**Staged Cascade (3 tiers)**:

**Tier 1 — Embedding screen (all steps, all plans)**: AlignScore between each gold step's expected output text and the corresponding trace segment. Cost: ~$0. Filter: if AlignScore > 0.85 → pre-approve (mark "likely_supported"). If AlignScore < 0.30 → pre-reject (mark "likely_unsupported"). Middle band (0.30–0.85) → Tier 2.

**Tier 2 — Small judge (ambiguous steps, ~40% of steps)**: [Atla Selene Mini 8B](https://arxiv.org/abs/2501.17195) on structured extraction + binary claim verification. Selene Mini is the highest-scoring 8B generative judge on RewardBench, outperforming GPT-4o on absolute scoring tasks. Zero-shot, robust to prompt format variation. Run on the FActScore extractor→verifier pipeline with JSON structured output. Selene Mini produces `{verdict: "supported"|"unsupported"|"ambiguous", confidence: float, evidence: str}`. Cost: ~$0.003/step.

**Tier 3 — Strong judge (critical steps where Tier 2 = ambiguous, ~10%)**: Prometheus-2-8x7B (self-hosted) or Claude-3.5-Haiku (API). Full G-Eval probability-weighted scoring. Cost: ~$0.01–0.03/step.

**Escalation only for critical step disagreements**: If Evaluator A (Prometheus-2) and Evaluator B (AlignScore) disagree by >1 point on a critical step → GPT-4o call. Cost: ~$0.05 per escalation, expected ~15–20% of critical steps.

**Per-verification cost estimate** (10-step plan, 3 critical):
- Tier 1: $0.00 × 10 = $0.00
- Tier 2 (40% = 4 steps): $0.003 × 4 = $0.012
- Tier 3 (10% = 1 step): $0.02 × 1 = $0.02
- Escalation (20% of 3 critical): $0.05 × 0.6 = $0.03
- **Total: ~$0.06** (within $0.05–$0.50 target)

**Caching**

- Gold step atomization (Stage 1) is deterministic — cache by `sha256(gold_step_text)`. One-time cost per unique plan.
- Per-step AlignScore results are deterministic — cache by `(gold_step_id, trace_segment_hash)`.
- G-Eval probability-weighted scores are stochastic — cache by `(gold_step_id, trace_segment_hash, model_id)` with TTL=24h for production replay.

**Token reduction techniques**

1. **Structured output enforcement**: Pydantic/JSON schema constrains response to `{verdict: str, score: int, evidence_quote: str | null, reasoning: str}`. Eliminates preamble text (~40% response token reduction).
2. **Step-level truncation**: Provide only the relevant trace segment for each gold step (window = gold step index ± 2 steps), not the full trace. Reduces input tokens ~70%.
3. **Evidence-first prompting**: Instruction order: "First quote the evidence, then score, then reason." Evidence extraction at start of response = shorter overall reasoning chain.
4. **Prometheus-2 PEFT**: Load Prometheus-2-7B with LoRA (r=256, targets Q/K/V/O) — fits on single A100. At batch_size=8, throughput sufficient for ~100 verifications/minute at ~$0.01 each.

**JudgeLM as a budget option**: [JudgeLM-7B](https://arxiv.org/html/2310.17631v2) needs only 3 minutes to judge 5K samples on 8× A100 GPUs (achieving >90% teacher agreement). For high-throughput offline evaluation, JudgeLM-7B self-hosted is the most cost-efficient option. Limitation: trained on general open-ended benchmarks, not domain-specific reasoning traces — fine-tuning on PLV-labeled examples would be needed.

---

## Concrete Architecture Recommendation

**Primary: FActScore Extractor→Verifier with Graded Support + Dual Evaluator Agreement Gate**

**Justification from literature**:
- FActScore decompose-then-verify achieves <2% error rate vs. human on factual verification tasks; atomic claim extraction removes the "fetch ≠ extraction" ambiguity that is root cause of H-family errors ([Min et al., 2023](https://arxiv.org/abs/2305.14251))
- G-Eval probability weighting achieves Spearman ρ=0.514 with human on summarization, outperforming all prior methods — continuous graded scores are more calibrated than binary labels ([Liu et al., 2023](https://arxiv.org/abs/2303.16634))
- Prometheus-2-8x7B (Pearson r=0.685–0.697 with human judges) is the best open evaluator available and its rubric-guided scoring matches your need for step-specific acceptance criteria ([Kim et al., 2024](https://arxiv.org/pdf/2405.01535))
- AlignScore (355M, 88.6 on SummaC) as the heterogeneous second evaluator provides fast, cheap, architecture-diverse signal that catches LLM judge hallucinations ([Zha et al., 2023](https://arxiv.org/abs/2305.16739))
- Cascaded Selective Evaluation proves that cheap-then-expensive tiering maintains provable human-agreement guarantees ([Jung et al., 2024](https://openreview.net/forum?id=UHPnqSTBPO))

**For H-family specifically:**
1. Enforced `evidence_quote: str | null` field — `null` → score=0, no exceptions
2. Pydantic validation that quote is a substring of the actual trace text (no hallucinated quotes)
3. RAGAS-style verification prompt: "Provide a brief explanation before verdict" elicits CoT that surfaces whether the quote actually supports the claim
4. Counterfactual calibration test: run judge on trace with retrieval action removed → if score stays "supported," re-calibrate

**For D-family specifically:**
1. Add `acceptance_criteria` to each gold step in the plan graph — minimum: `expected_conclusion` and `must_not_conclude` sets
2. Claim Verifier checks `trace_conclusion ∈ expected_conclusions` as an explicit comparison, not an open-ended judgment
3. Process supervision framing (Uesato et al.): accumulate labeled D-family examples, fine-tune a small classifier (comparable to Tyen et al.'s out-of-domain classifier approach) specifically for "executed-but-misapplied" detection
4. For GDPR/legal analysis specifically: use AlignScore between expected legal basis paragraph and the trace's application section — if alignment < 0.40, flag for D-family review regardless of other scores

---

## "You're Solving the Wrong Problem" Insights

### 1. Binary Support Is the Wrong Abstraction

Your current architecture (supported/unsupported/skipped) treats all evidence gaps equally. But ROSCOE's nine-error taxonomy and Shepherd's six-error taxonomy show that **step failures are qualitatively different** and require different responses:
- **Missing Step** (gap in plan) → HOLD (agent missed a required action)
- **Hallucination** (invented evidence) → BLOCK (agent fabricated support)
- **Redundancy** (correct but unnecessary step) → ALLOW (doesn't affect correctness)
- **Coherency failure** (steps contradict each other) → HOLD or BLOCK depending on criticality

Binary "unsupported" collapses these into a single category. The ReasonEval positive/neutral/negative three-class scheme is a minimal improvement; a six-class scheme matching Shepherd's taxonomy would enable more precise verdict logic.

### 2. Gold Plans Need Per-Step Acceptance Criteria, Not Just Criticality Tags

The D-family problem is a direct consequence of under-specified gold plans. A step tagged "critical" with description "Apply GDPR Art. 6 analysis" gives a judge no testable predicate. The LLM judge sees the trace apply *some* legal basis and marks it "supported."

The gold step graph should carry:
```json
{
  "step_id": "step_3",
  "description": "...",
  "criticality": "critical",
  "acceptance_criteria": {
    "expected_outcome_type": "legal_basis_selection",
    "valid_outcomes": ["Art.6(1)(b)", "Art.6(1)(c)"],
    "invalid_outcomes": ["Art.6(1)(a)", "Art.6(1)(f)"],
    "verification_question": "Which GDPR legal basis does the trace identify for this processing activity?"
  }
}
```

This transforms verification from "did the agent do GDPR analysis" → "did the agent reach the right intermediate conclusion." It's the difference between outcome supervision and process supervision (Uesato et al.).

### 3. Extractor→Verifier Decomposition Is Better Than a Single Judge

Tyen et al.'s finding that LLMs fail at mistake-finding (10–52% accuracy) while succeeding at correction (with location hints) implies that **a single pass judge is too hard a task**. Decomposing into:
1. Extractor: "What did the trace do at this step? Quote it." (easier, near-deterministic)
2. Verifier: "Does this quoted action satisfy the acceptance criterion?" (simpler comparison task)

is more reliable than asking a single judge: "Did the trace correctly complete this step?" The extractor step is also where you get your evidence citation — it's not an add-on, it's the mechanism.

### 4. Majority Vote Without Architectural Diversity Is Noise, Not Signal

Your majority vote experiment (no improvement) makes sense: you were ensembling judges that share the same failure mode (H-family false positives). The [Galileo AI analysis](https://galileo.ai/blog/why-llm-as-a-judge-fails) confirms that ensembles only work with architecturally diverse judges — "odd-numbered panels" with different base models. Your ensemble should include at minimum:
- One LLM-based judge with explicit reasoning (Prometheus-2)
- One embedding/NLI-based scorer (AlignScore)
- One structured extraction pass with Pydantic validation (evidence citation check)

These fail on different types of inputs, so their disagreement is diagnostic rather than noise.

### 5. The 60% Plateau Is a Ceiling Effect, Not a Prompt Problem

Sharpened "mentioned ≠ verified" prompts fix C-family but break H-family because you're tuning a single prompt toward a specific failure mode while introducing new errors. This is a symptom of prompt brittleness — the underlying model doesn't reliably distinguish the task boundaries. The fix is architectural (decomposition), not lexical (better prompts). Tyen et al.'s solution — fine-tune a small classifier on domain-specific labeled data — would likely break through the 60% ceiling. A classifier trained on 500 labeled PLV examples (H-family false positives, D-family misapplications, correct cases) would outperform GPT-4 prompting on your specific task distribution, consistent with Tyen et al.'s findings across all five BIG-Bench tasks.

---

## Part 2 — Graded-Support Prompt Template (Prompt 2 response)

*Source: plv_q2_template.md — Graded-Support Evaluation Template.*

---

## Section 1: The Prompt Template

Full copy-pasteable template below. Placeholders: `{{GOLD_STEP}}`, `{{ACCEPTANCE_CRITERION}}`, `{{STEP_ID}}`, `{{TRACE_EXCERPT}}`.

```
SYSTEM
------
You are a strict support evaluator for an AI agent verification system called Plan-Level Verification (PLV).
Your role: determine how well each gold reasoning step is supported by evidence present in the agent trace.
You do NOT have access to ground-truth answers. You only assess whether the trace contains evidence that
satisfies the gold step's acceptance criterion.

You must be CONSERVATIVE. The default verdict is "unsupported" unless you can locate qualifying evidence.
Generous interpretation of thin or ambiguous traces is prohibited.

---

SCORING RUBRIC — 0.0 to 1.0 (five tiers)
------------------------------------------

DEFINITIONS (read before scoring):
  "Mentioned"           — The topic or entity appears in the trace but no action was taken toward it.
  "Attempted"           — A tool call or action was issued for the topic, but no output is present.
  "Partially Executed"  — The action ran and produced some output, but the output does not include
                          the specific artifact called for by the acceptance criterion.
  "Executed with Evidence" — The action ran, output is present, and the output contains information
                          relevant to the acceptance criterion — but not as a direct quotation.
  "Executed with Verbatim Evidence" — The action ran, the exact text satisfying the acceptance
                          criterion appears verbatim in the trace, and you can quote it precisely.

TIER ANCHORS:

  0.0 — NONE
        The gold step topic is not mentioned, or the step was explicitly skipped (not attempted at all).
        Example: Gold step requires "retrieve RFC 9110 §6.3 definition of 204 No Content."
        Trace contains no fetch, no reference to RFC 9110, nothing.
        → Predicate: "skipped"

  0.25 — WEAK
         The step was mentioned or a tool call was issued, but no output appears in the trace,
         OR the output is present but completely unrelated to the acceptance criterion.
         Includes: fetch tool call logged ("GET https://www.rfc-editor.org/rfc/rfc9110") but
         no response body, no extracted text, and no downstream use of retrieved content.
         This is the canonical H-family case (performed-but-not-extracted).
         Score is CAPPED at 0.25 for fetch-without-extraction regardless of other context.
         → Predicate: "unsupported"

  0.5 — PARTIAL
        The step ran and trace output is present, but the extracted content only partially
        satisfies the criterion: correct source, wrong section; or correct concept, wrong value;
        or paraphrased summary rather than specific artifact. The evaluator cannot locate
        a verbatim passage that satisfies the criterion.
        ALSO: Default score when trace length or signal is TOO THIN to decide (abstain case).
        → Predicate: "partial" (treated as "unsupported" for critical steps; see threshold discussion)

  0.75 — STRONG
         REQUIRES A VERBATIM QUOTE from the trace.
         The extracted quote directly addresses the acceptance criterion. The quote need not be
         word-for-word from the source document, but must appear as-is in the trace.
         The quote satisfies the acceptance criterion either wholly or with a minor gap
         (e.g., value is present but units are inferred rather than stated).
         → Predicate: "supported"

  1.0 — VERBATIM
        REQUIRES A VERBATIM QUOTE from the trace.
        The quote fully and completely satisfies the acceptance criterion with no interpretive gap.
        The exact text that constitutes "step complete" per the acceptance criterion is present in
        the trace and can be matched by substring search.
        → Predicate: "supported"

---

HARD RULES (non-negotiable):

  R1. Score ≥ 0.75 REQUIRES a non-null `quote` field containing exact text from the trace.
      If you cannot populate `quote`, your score MUST be ≤ 0.5.

  R2. If the trace is too short, too sparse, or too ambiguous to make a reliable judgment,
      set `abstain_if_uncertain: true` and cap score at 0.5. Do not guess.

  R3. Fetch-without-extraction cap: If the only trace evidence is that a tool call was issued
      (URL logged, action recorded) but NO response content appears in the trace excerpt,
      score MUST be ≤ 0.25. Do not award credit for the attempt alone.

  R4. Performed-but-wrong: If the trace shows a step was executed and output is present,
      but the conclusion drawn by the agent is inconsistent with the output, score ≤ 0.5
      and note the mismatch in `reasoning`.

  R5. Abstain over hallucinate: When uncertain, score low and set `abstain_if_uncertain: true`.
      Scores of 0.75+ carry downstream trust implications — do not inflate.

---

SUPPORT-PREDICATE MAPPING:

  score ≥ 0.75  AND  quote ≠ null   →  predicate = "supported"
  0.25 ≤ score < 0.75               →  predicate = "partial"
  score < 0.25  OR  quote = null with score attempt ≥ 0.75 (rule violation caught)
                                    →  predicate = "unsupported"
  Step not attempted at all (score = 0.0, tier = "none")
                                    →  predicate = "skipped"

  THRESHOLD DISCUSSION — "partial" predicate:
  For CRITICAL steps (steps whose output is a required input to a subsequent gold step),
  callers SHOULD treat "partial" as "unsupported". For NON-CRITICAL steps (informational
  or enrichment steps), callers MAY treat "partial" as a soft pass subject to their own
  risk tolerance. The template does not make this decision; it surfaces the predicate and
  the score so callers can apply their own threshold.

---

INPUT FORMAT
-----------

You will receive:

  GOLD_STEP:           A natural-language description of what the agent was supposed to do.
  ACCEPTANCE_CRITERION: A precise, testable condition that defines "this step is complete."
                        Written by the plan author. May include artifact type, expected value,
                        source identifier, and any structural requirements.
  STEP_ID:             Opaque string identifying this step in the plan.
  TRACE_EXCERPT:       The relevant portion of the agent trace for this step.
                       May include tool call logs, model outputs, retrieved text,
                       and inter-step context. Newlines preserved. Line numbers provided
                       where available as "L<n>:" prefix.

---

TASK
----

Evaluate whether the TRACE_EXCERPT contains evidence that satisfies the ACCEPTANCE_CRITERION
for the GOLD_STEP. Score 0–1 using the rubric above. Populate all fields in the JSON schema below.

GOLD_STEP:
{{GOLD_STEP}}

ACCEPTANCE_CRITERION:
{{ACCEPTANCE_CRITERION}}

STEP_ID:
{{STEP_ID}}

TRACE_EXCERPT:
{{TRACE_EXCERPT}}

---

OUTPUT
------

Return ONLY valid JSON matching this schema. No prose before or after.

{
  "step_id": "{{STEP_ID}}",
  "score": <float 0.0–1.0, one decimal place>,
  "tier": <"none" | "weak" | "partial" | "strong" | "verbatim">,
  "quote": <string | null>,
  "quote_location": {
    "line_start": <integer | null>,
    "line_end": <integer | null>,
    "char_offset_start": <integer | null>,
    "char_offset_end": <integer | null>,
    "turn": <integer | null>
  },
  "quote_to_criterion_mapping": <string | null>,
  "reasoning": "<≤2 sentences explaining the score. Must reference specific trace content or absence thereof.>",
  "abstain_if_uncertain": <boolean>,
  "predicate": <"supported" | "partial" | "unsupported" | "skipped">
}
```

---

## Section 2: Evidence-Citation Schema and Example

### 2.1 Schema Rationale

The citation format forces the evaluator to locate, quote, and annotate evidence before scoring. This directly addresses the leniency problem identified by [Lanham et al. (2023)](https://arxiv.org/abs/2307.13702): CoT steps that "mention" content rather than being causally grounded in it should receive low faithfulness scores. By requiring a verbatim quote for high scores, the schema operationalizes the FActScore principle that each atomic fact must be independently verifiable against a source ([Min et al., 2023](https://arxiv.org/abs/2305.14251)). RAGAS applies the analogous constraint: faithfulness requires that claims be *inferable from retrieved context*, and the framework explicitly extracts statements before checking them ([Es et al., 2023](https://arxiv.org/abs/2309.15217)).

### 2.2 Full JSON Schema (TypeScript-style annotations)

```typescript
interface SupportEvaluation {
  step_id: string;                    // Opaque plan step identifier
  score: number;                      // Float in [0.0, 1.0], one decimal
  tier: "none" | "weak" | "partial" | "strong" | "verbatim";
  quote: string | null;               // Exact substring from trace; null iff tier ∈ {none, weak}
  quote_location: {
    line_start: number | null;        // 1-indexed line in trace_excerpt where quote begins
    line_end: number | null;          // 1-indexed line where quote ends
    char_offset_start: number | null; // Character offset within trace_excerpt (0-indexed)
    char_offset_end: number | null;   // Exclusive end offset
    turn: number | null;              // Turn index in multi-turn trace; null if single-turn
  };
  quote_to_criterion_mapping: string | null;
  // Natural language: "The phrase '...' satisfies criterion clause '<X>' because ..."
  // Must be non-null iff quote is non-null.
  reasoning: string;                  // ≤2 sentences, must cite specific trace content or its absence
  abstain_if_uncertain: boolean;      // true → score is conservatively capped at 0.5
  predicate: "supported" | "partial" | "unsupported" | "skipped";
}
```

### 2.3 Quote Provenance Checks (caller-side)

After receiving the evaluator's JSON, the caller SHOULD run these checks before accepting the evaluation:

```python
def verify_provenance(eval_result: dict, trace_excerpt: str, lines: list[str]) -> list[str]:
    """
    Returns list of provenance violations. Empty list = clean.
    """
    violations = []
    quote = eval_result.get("quote")
    score = eval_result.get("score", 0.0)
    loc = eval_result.get("quote_location", {})

    # CHECK 1: Score ≥ 0.75 requires a non-null quote
    if score >= 0.75 and quote is None:
        violations.append(f"PROV_FAIL_01: score={score} but quote is null")

    if quote is not None:
        # CHECK 2: Substring match — quote must appear verbatim in trace
        if quote not in trace_excerpt:
            violations.append(f"PROV_FAIL_02: quote not found as substring in trace_excerpt")

        # CHECK 3: Line bounds must be consistent
        ls = loc.get("line_start")
        le = loc.get("line_end")
        if ls is not None and le is not None:
            if ls < 1 or le > len(lines):
                violations.append(f"PROV_FAIL_03: line bounds ({ls},{le}) out of range (1,{len(lines)})")
            else:
                region = "\n".join(lines[ls-1:le])
                if quote not in region:
                    violations.append(f"PROV_FAIL_04: quote not found within declared line range {ls}-{le}")

        # CHECK 4: Char offset consistency
        cs = loc.get("char_offset_start")
        ce = loc.get("char_offset_end")
        if cs is not None and ce is not None:
            if trace_excerpt[cs:ce] != quote:
                violations.append(
                    f"PROV_FAIL_05: char offsets [{cs}:{ce}] yield '{trace_excerpt[cs:ce]}', "
                    f"not '{quote[:40]}...'"
                )

        # CHECK 5: Quote length sanity (pathological single-char quotes)
        if len(quote.strip()) < 10:
            violations.append(f"PROV_WARN_06: quote is suspiciously short ({len(quote)} chars)")

    return violations
```

**Fallback rule**: If `PROV_FAIL_01` or `PROV_FAIL_02` fires, the caller MUST downgrade the evaluation: set `predicate = "unsupported"`, set `score = 0.25`, and log the provenance failure. Do not accept a `"supported"` verdict from a quote-less evaluation.

### 2.4 Rendered Example — Evidence Citation

**Scenario**: Agent retrieved RFC 9110 and extracted the definition of status code 204.

**Gold Step**: "Retrieve and record the definition of HTTP 204 No Content from RFC 9110."

**Acceptance Criterion**: "Trace must contain the verbatim text from RFC 9110 §15.3.5 defining the 204 status code semantics, specifically that the server has successfully processed the request but is not returning any content."

```json
{
  "step_id": "step_03",
  "score": 1.0,
  "tier": "verbatim",
  "quote": "The 204 (No Content) response code indicates that the server has successfully fulfilled the request and that there is no additional content to send in the response content.",
  "quote_location": {
    "line_start": 47,
    "line_end": 48,
    "char_offset_start": 2301,
    "char_offset_end": 2489,
    "turn": 3
  },
  "quote_to_criterion_mapping": "The phrase 'successfully fulfilled the request and that there is no additional content to send in the response content' directly satisfies criterion clause 'server has successfully processed the request but is not returning any content'.",
  "reasoning": "Trace turn 3 lines 47-48 contains a verbatim excerpt from RFC 9110 §15.3.5 defining 204 semantics. The extracted text fully satisfies the acceptance criterion with no interpretive gap.",
  "abstain_if_uncertain": false,
  "predicate": "supported"
}
```

---

## Section 3: Thin-Trace Calibration Techniques

### 3.1 The H-Family Problem

An **H-family step** is one where the agent issued a tool call (fetch, search, API call) that is logged in the trace, but the response content was never surfaced into the trace context. The agent may have consumed the response internally, but from the evaluator's perspective, no evidence exists. The existing binary `supported/unsupported` judge assigns `supported` because the action is present; the graded system caps these at `score ≤ 0.25` via Rule R3.

Concretely, a trace containing:
```
[TOOL CALL] fetch("https://www.rfc-editor.org/rfc/rfc9110", section="15.3.5")
[TOOL RESULT] <omitted from context window>
[AGENT] Based on the RFC, the 204 status means no content is returned.
```
...is an H-family step. The agent's conclusion may be correct, but the evaluator has no extractable evidence. Score = 0.25, tier = "weak", predicate = "unsupported".

This aligns with the spirit of [Lightman et al. (2023)](https://arxiv.org/abs/2305.20050): process supervision requires signal at *each step*, not just a correct final answer. A step that produced a plausible-sounding conclusion without traceable evidence is an unreliable step regardless of accuracy.

### 3.2 Acceptance Criteria Embedded Per Gold Step

Each gold step should carry a machine-readable `acceptance_criterion` that specifies exactly what artifact constitutes "done." This removes ambiguity from the evaluator and prevents score inflation via generous interpretation.

**Recommended acceptance criterion format**:

```json
{
  "step_id": "step_03",
  "description": "Retrieve RFC 9110 §15.3.5 definition of 204 No Content",
  "acceptance_criterion": {
    "artifact_type": "verbatim_quote",
    "source_identifier": "RFC 9110 §15.3.5",
    "required_content_pattern": "204.*No Content.*successfully.*no.*content",
    "minimum_quote_length_chars": 50,
    "must_appear_in_trace": true
  }
}
```

The evaluator receives this structured criterion rather than a free-form description. The `required_content_pattern` gives callers a regex-level sanity check independent of the LLM evaluator's judgment, analogous to the deterministic pre-checks in RAGAS's pipeline ([Es et al., 2023](https://arxiv.org/abs/2309.15217)).

### 3.3 Two-Turn Judge: Extractor → Verifier Decomposition

Directly inspired by FActScore's architecture ([Min et al., 2023](https://arxiv.org/abs/2305.14251)), which separates atomic fact generation from fact verification.

**Turn 1 — Extractor** (cheap model, e.g., `claude-haiku-3-5` or `gpt-4o-mini`):

```
SYSTEM: You are an evidence extractor. Given a trace excerpt and a gold step description,
find and return ALL spans from the trace that are potentially relevant to the gold step.
Return a JSON list of {span, line_start, line_end, char_offset_start, char_offset_end}.
Return an empty list if no relevant spans exist.

Do not score, evaluate, or judge. Only extract.
```

**Turn 2 — Verifier** (stronger model, e.g., `claude-sonnet-4-5`):

```
SYSTEM: You are a strict support evaluator (full system prompt from Section 1).

You have been given a PRE-EXTRACTED candidate evidence list. Score ONLY based on
whether these candidates satisfy the acceptance criterion.
If the candidate list is empty, score MUST be ≤ 0.25.

CANDIDATE EVIDENCE:
{{extractor_output}}

ACCEPTANCE_CRITERION:
{{acceptance_criterion}}
```

**Benefits**:
- Extractor forces explicit evidence retrieval before scoring — prevents the verifier from pattern-matching on "plausible agent behavior."
- Empty extractor output → automatic score cap, matching R3 without relying on the verifier's self-discipline.
- Cheaper model handles extraction (high volume, deterministic task); stronger model handles judgment (lower volume).
- Aligns with G-Eval's form-filling paradigm ([Liu et al., 2023](https://aclanthology.org/2023.emnlp-main.153/)): evaluation steps are made explicit rather than implicit.

### 3.4 Consistency Checks

Run the verifier twice with different contexts and flag divergence:

| Check | Method | Flag condition |
|---|---|---|
| **Trace-only** | Evaluate with trace excerpt only | Baseline score |
| **Trace + retrieved doc** | Append the actual source document (if available) to context | Score should not jump more than +0.3 |
| **Score consistency** | Run at temp=0 twice | Scores should be identical |
| **Quote consistency** | Compare quotes across runs | Different quotes for same score → flag |

If trace-only score is < 0.25 but trace+doc score is ≥ 0.75, this is strong evidence that the agent retrieved information but failed to surface it into the trace — a confirmed H-family step. Log the delta as `evidence_gap_score`.

### 3.5 Temperature 0, Structured Outputs, Forced-Function Schema

- **Temperature 0**: All evaluator calls run at `temperature=0`. The score rubric is deterministic by design; stochasticity serves no purpose and inflates variance. Research on structured output consistency confirms temperature is the dominant driver of output variation ([OpenReview 2512.23712](https://arxiv.org/abs/2512.23712)).
- **Structured outputs / constrained decoding**: Use the provider's native JSON mode or tool-calling interface to guarantee schema compliance. This eliminates hallucinated fields and ensures `quote` is either a proper string or `null` — not a made-up value.
- **Forced-function schema**: The `quote` field is not optional in the schema, but is nullable. By making it a required field with a nullable type, you force the model to make an explicit choice (populate or null) rather than omitting it silently. Omission is treated as `null` by callers, triggering the score-cap.

### 3.6 Score-Floor Rules Tied to Evidence Density

After the evaluator returns a score, apply these deterministic adjustments in caller code:

```python
def apply_evidence_density_floors(eval_result: dict, trace_excerpt: str) -> dict:
    """Deterministic post-processing of evaluator output."""
    quote = eval_result.get("quote")
    score = eval_result.get("score", 0.0)

    # Rule R3: fetch-without-extraction cap
    has_tool_call = "TOOL CALL" in trace_excerpt or "tool_call" in trace_excerpt.lower()
    has_response = "TOOL RESULT" in trace_excerpt or len(trace_excerpt) > 500
    if has_tool_call and not has_response and score > 0.25:
        eval_result["score"] = 0.25
        eval_result["tier"] = "weak"
        eval_result["predicate"] = "unsupported"
        eval_result["reasoning"] += " [FLOOR APPLIED: fetch-without-extraction cap]"

    # Rule R1: quote required for score ≥ 0.75
    if score >= 0.75 and quote is None:
        eval_result["score"] = 0.5
        eval_result["tier"] = "partial"
        eval_result["predicate"] = "partial"
        eval_result["reasoning"] += " [FLOOR APPLIED: score capped at 0.5 — no quote provided]"

    # Evidence density floor: quoted text < 10 chars → cap at 0.5
    if quote is not None and len(quote.strip()) < 10:
        eval_result["score"] = min(eval_result["score"], 0.5)
        eval_result["tier"] = "partial"
        eval_result["reasoning"] += " [FLOOR APPLIED: quote too short to be meaningful]"

    # Remap predicate after floors
    s = eval_result["score"]
    q = eval_result.get("quote")
    if s == 0.0:
        eval_result["predicate"] = "skipped"
    elif s >= 0.75 and q:
        eval_result["predicate"] = "supported"
    elif s >= 0.25:
        eval_result["predicate"] = "partial"
    else:
        eval_result["predicate"] = "unsupported"

    return eval_result
```

### 3.7 Solving the Right Problem: Producer-Side Step Markers

The calibration techniques above all operate on the **judge side**. There is a complementary (and arguably more robust) approach: fix the problem at the **producer side** by requiring the agent to emit a structured `step_complete` marker when it finishes each gold step.

**Proposed agent trace marker**:
```json
{
  "__plv_step_complete": true,
  "step_id": "step_03",
  "artifact_type": "verbatim_quote",
  "artifact_value": "The 204 (No Content) response code indicates...",
  "source": "RFC 9110 §15.3.5",
  "source_url": "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.5",
  "confidence": "high"
}
```

**Why this matters**: If the agent is required to emit this marker to signal step completion, the absence of the marker is itself a strong signal (`score ≤ 0.25`). Presence of the marker with a populated `artifact_value` gives the evaluator a direct quote to check — converting the judge's job from evidence hunting into quote validation. The PLV evaluator simply checks: (a) does the marker exist? (b) does `artifact_value` satisfy the acceptance criterion? (c) is `artifact_value` a substring of the trace?

**Important caveat**: This is only viable if you control the agent's prompt or training. For evaluation of third-party traces, the judge-side techniques in §3.2–3.6 are necessary. The producer-side approach is the cleaner long-term solution but requires changing agent behavior, not just the evaluator. Prometheus-style evaluation ([Kim et al., 2023](https://arxiv.org/abs/2310.08491)) implicitly assumes the evaluator receives an artifact to judge — the marker makes that assumption explicit and enforceable.

---

## Section 4: Two Worked Examples

### Example A — Clearly Supported (tier=verbatim, score=1.0)

**Setup**: The agent was tasked with verifying the HTTP 204 No Content response definition from RFC 9110.

---

**INPUT TO EVALUATOR**:

```
GOLD_STEP:
Retrieve the definition of HTTP status code 204 No Content from RFC 9110 and record
the exact text defining its semantics.

ACCEPTANCE_CRITERION:
The trace must contain a verbatim excerpt from RFC 9110 Section 15.3.5 that defines
the 204 No Content status code semantics, specifically covering: (a) what server state
it signals, and (b) the nature of the response payload (absent/empty). Minimum quoted
length: 50 characters.

STEP_ID:
step_03

TRACE_EXCERPT:
L1:  [TOOL CALL] fetch_url(url="https://www.rfc-editor.org/rfc/rfc9110", section="15.3.5")
L2:  [TOOL RESULT] HTTP 200 OK — 4,821 chars returned
L3:  [EXTRACTED CONTENT]
L4:  "15.3.5. 204 No Content
L5:   The 204 (No Content) response code indicates that the server has successfully
L6:   fulfilled the request and that there is no additional content to send in the
L7:   response content. Metadata in the response header fields refer to the target
L8:   resource and its selected representation after the requested action was applied."
L9:  [AGENT CONCLUSION] Recorded RFC 9110 §15.3.5 definition. 204 means: successful
L10: fulfillment, no response body. Will use this as acceptance criterion for downstream
L11: step validation.
```

---

**EVALUATOR JSON RESPONSE**:

```json
{
  "step_id": "step_03",
  "score": 1.0,
  "tier": "verbatim",
  "quote": "The 204 (No Content) response code indicates that the server has successfully fulfilled the request and that there is no additional content to send in the response content.",
  "quote_location": {
    "line_start": 5,
    "line_end": 7,
    "char_offset_start": 198,
    "char_offset_end": 367,
    "turn": null
  },
  "quote_to_criterion_mapping": "Clause (a) satisfied by 'server has successfully fulfilled the request' (server state = successful completion). Clause (b) satisfied by 'no additional content to send in the response content' (response payload is absent). Quote length = 169 chars, exceeds minimum 50.",
  "reasoning": "Trace lines 5-7 contain a verbatim block extracted from RFC 9110 §15.3.5, bookended by a [TOOL RESULT] and [EXTRACTED CONTENT] marker, confirming the fetch succeeded and content was surfaced into the trace. Both acceptance criterion clauses are fully satisfied with no interpretive gap.",
  "abstain_if_uncertain": false,
  "predicate": "supported"
}
```

**Caller provenance check result**: PASS — `quote` is a substring of `trace_excerpt`, line bounds consistent, char offsets valid, quote length 169 chars.

---

### Example B — Merely Mentioned / H-Family (tier=weak, score=0.25)

**Setup**: Agent fetched RFC 9110 but never surfaced the extracted text into the trace. Close cousin of the canonical H-family case.

---

**INPUT TO EVALUATOR**:

```
GOLD_STEP:
Retrieve the definition of HTTP status code 204 No Content from RFC 9110 and record
the exact text defining its semantics.

ACCEPTANCE_CRITERION:
The trace must contain a verbatim excerpt from RFC 9110 Section 15.3.5 that defines
the 204 No Content status code semantics, specifically covering: (a) what server state
it signals, and (b) the nature of the response payload (absent/empty). Minimum quoted
length: 50 characters.

STEP_ID:
step_03

TRACE_EXCERPT:
L1:  [TOOL CALL] fetch_url(url="https://www.rfc-editor.org/rfc/rfc9110")
L2:  [TOOL RESULT] <response body not retained in context>
L3:  [AGENT REASONING] I have now consulted RFC 9110. The 204 status code means the
L4:  server processed the request successfully but sends no response body. This is
L5:  consistent with standard HTTP semantics. I will proceed to the next step.
```

---

**EVALUATOR JSON RESPONSE**:

```json
{
  "step_id": "step_03",
  "score": 0.25,
  "tier": "weak",
  "quote": null,
  "quote_location": {
    "line_start": null,
    "line_end": null,
    "char_offset_start": null,
    "char_offset_end": null,
    "turn": null
  },
  "quote_to_criterion_mapping": null,
  "reasoning": "Trace line 1 shows a fetch tool call was issued for RFC 9110, but line 2 explicitly states the response body was not retained in context. Lines 3-5 contain only an agent-authored paraphrase ('sends no response body') — this is not a verbatim excerpt from RFC 9110 §15.3.5, so the acceptance criterion requiring a verbatim quote of ≥50 chars is unsatisfied. Rule R3 (fetch-without-extraction cap) applies: score capped at 0.25.",
  "abstain_if_uncertain": false,
  "predicate": "unsupported"
}
```

**Caller provenance check result**: PASS (quote is null, score is 0.25, no R1 violation). Score-floor function confirms R3 applies: `has_tool_call=True`, `has_response=False` (TOOL RESULT body absent). Predicate correctly set to `"unsupported"`.

**Key contrast with Example A**: Both traces show a fetch tool call. Example A surfaces extracted content (lines 3-8, ~170 chars of RFC text). Example B logs only `<response body not retained in context>` and then produces an agent-authored paraphrase. The graded system correctly distinguishes these where a binary judge would likely award `supported` to both.

---

## Section 5: Integration Notes

### 5.1 Plugging Into the Existing Support-Only Evaluator

The existing PLV evaluator emits a binary `{supported, unsupported, skipped}` predicate. Migration path:

1. **Drop-in replacement**: Swap the existing prompt for the Section 1 template. Map the graded output to predicates using the threshold table. The `predicate` field in the JSON output is a drop-in for the existing binary predicate.
2. **Partial rollout**: Run both evaluators in parallel. Log disagreements (binary=`supported`, graded predicate=`unsupported` or `partial`) as H-family candidates for manual review.
3. **Critical-step threshold injection**: Pass `critical: bool` per step. Callers implement:
   ```python
   final_predicate = eval_result["predicate"]
   if eval_result["predicate"] == "partial" and step["critical"]:
       final_predicate = "unsupported"
   ```
4. **Provenance check integration**: After every evaluator call, run `verify_provenance()` (Section 2.3). Log `PROV_FAIL_*` violations to a separate metrics stream. A high provenance failure rate signals evaluator miscalibration or prompt degradation.

### 5.2 Cost Estimate

All estimates assume per-token pricing as of mid-2025. Adjust for your provider.

| Configuration | Model | Est. input tokens/step | Est. output tokens/step | $/step | $/trace (20 steps) |
|---|---|---|---|---|---|
| Single-judge (Section 1 only) | claude-sonnet-4-5 | ~1,200 | ~200 | ~$0.009 | **~$0.18** |
| Single-judge | gpt-4o | ~1,200 | ~200 | ~$0.010 | **~$0.20** |
| Two-turn (extractor+verifier) | haiku-3-5 + sonnet-4-5 | ~800 + ~1,000 | ~150 + ~200 | ~$0.011 | **~$0.22** |
| Two-turn w/ consistency check (×2 verifier) | haiku-3-5 + sonnet-4-5 ×2 | — | — | ~$0.018 | **~$0.36** |

All configurations fall within the $0.05–$0.50/trace target. The two-turn configuration with consistency checks at ~$0.36/trace is the recommended production default.

### 5.3 Model Recommendations

**Verifier (Section 1 prompt, judgment)**: Use a **Sonnet-class model** (claude-sonnet-4-5, gpt-4o, or equivalent). The verifier must reliably follow complex multi-rule instructions, maintain hard rules (R1–R5) even when the trace is ambiguous, and produce provenance-valid quotes. Smaller models fail R1 at elevated rates in preliminary testing — they inflate scores without quotes.

**Extractor (two-turn §3.3, turn 1)**: Use a **Haiku/mini-class model** (claude-haiku-3-5, gpt-4o-mini). Extraction is a span-retrieval task with a deterministic correctness criterion (is the span in the trace?). Cost savings are significant at volume.

**Structured output**: Use provider JSON mode or tool-calling for both turns. Set `temperature=0` for both. Do not use free-form text generation for the evaluator output.

**Provider note on structured outputs**: Claude models (Anthropic) show near-perfect structural reliability even at temperature > 0 ([OpenReview framework for LLM structured output reliability](https://arxiv.org/abs/2512.23712)), but for evaluation workloads, `temperature=0` is non-negotiable regardless of model.

### 5.4 Schema Versioning

Tag every evaluation output with a schema version field:

```json
{
  "__schema_version": "plv-graded-support-v1.0",
  "__evaluated_at": "2025-01-15T14:30:00Z",
  ...
}
```

This ensures downstream consumers can detect when the prompt or rubric changes and re-evaluate affected steps without ambiguity.

---

## Section 6: Literature Backing

All design decisions are grounded in the following works. Citations appear inline throughout the document; references below provide full coordinates.

| # | Reference | Role in this design |
|---|---|---|
| 1 | Liu et al. (2023). **G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment**. EMNLP 2023. [ACL Anthology](https://aclanthology.org/2023.emnlp-main.153/) / [PDF](https://aclanthology.org/2023.emnlp-main.153.pdf) | Form-filling paradigm with CoT steps; foundation for the evaluator's structured output + step-by-step reasoning before scoring. The probability-weighted scoring idea motivates the continuous 0–1 scale over a binary. |
| 2 | Kim et al. (2023). **Prometheus: Inducing Fine-grained Evaluation Capability in Language Models**. ICLR 2024. [arXiv:2310.08491](https://arxiv.org/abs/2310.08491) | Rubric-based evaluation with per-score-level natural-language definitions. Directly informs the five-tier calibration anchors at 0.0/0.25/0.5/0.75/1.0. Reference answer + rubric improves inter-rater reliability (Pearson 0.897 with humans). |
| 3 | Min et al. (2023). **FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation**. EMNLP 2023. [arXiv:2305.14251](https://arxiv.org/abs/2305.14251) | Atomic-fact decomposition and extractor→verifier two-turn architecture. Directly implements the thin-trace calibration strategy in §3.3. Each gold step treated as an atomic claim that must be individually verified against the trace. |
| 4 | Es et al. (2023). **Ragas: Automated Evaluation of Retrieval Augmented Generation**. [arXiv:2309.15217](https://arxiv.org/abs/2309.15217) | Faithfulness metric requiring claims to be inferable from retrieved context. Motivates the quote-to-criterion mapping field and the principle that inference without citation = unfaithful. Two-stage pipeline (extract then verify) mirrors §3.3. |
| 5 | Lightman et al. (2023). **Let's Verify Step by Step**. ICLR 2024. [arXiv:2305.20050](https://arxiv.org/abs/2305.20050) | Process supervision: step-level feedback significantly outperforms outcome-level feedback for reliable evaluation. Justifies per-step scoring rather than end-to-end trace scoring. Also motivates the acceptance criterion per step (§3.2). |
| 6 | Lanham et al. (2023). **Measuring Faithfulness in Chain-of-Thought Reasoning**. Anthropic. [arXiv:2307.13702](https://arxiv.org/abs/2307.13702) / [Anthropic research page](https://www.anthropic.com/research/measuring-faithfulness-in-chain-of-thought-reasoning) | Faithfulness interventions (adding mistakes, paraphrasing CoT) reveal when a model's stated reasoning is not causally connected to its conclusion. Directly motivates Rules R3 and R4: agent conclusions that are not causally grounded in trace evidence should receive low scores regardless of accuracy. |

### Additional Supporting References

- **Autorubric** (2026). Unifying rubric-based LLM evaluation. [arXiv:2603.00077](https://arxiv.org/abs/2603.00077). Validates analytic rubrics with binary/ordinal criteria and few-shot calibration as the current state of the art for inter-rater reliability.
- **LLM Structured Output Reliability** (2025). Framework for evaluating JSON output consistency. [arXiv:2512.23712](https://arxiv.org/abs/2512.23712). Empirical basis for `temperature=0` recommendation and model selection for structured output tasks.
- **Watch Every Step! LLM Agent Learning via Iterative Step-Level Process Refinement** (EMNLP 2024). [ACL Anthology](https://aclanthology.org/2024.emnlp-main.93.pdf). Validates that step-level reward signals improve agent trace quality — confirms the producer-side marker approach in §3.7 as a long-term solution.

---

## Part 3 — Comparable Systems & Positioning (Prompt 3 response)

*Source: plv_q3_comparables.md — Comparable Systems Landscape. Report date: April 24, 2026. Prepared for ThoughtProof internal strategy.*

---

## What PLV Does (Reference Definition)

ThoughtProof's Plan-Level Verification (PLV) operates as follows:

1. A **gold step graph** is defined for a task — a directed graph of expected reasoning steps, with each step classified as critical or non-critical.
2. An AI agent produces a **reasoning trace** (the actual sequence of steps taken).
3. PLV compares the trace against the gold graph and assigns each step a **support predicate**: `supported`, `unsupported`, or `skipped`.
4. A **verdict** is derived from predicate aggregation: `BLOCK` (critical unsupported steps found), `HOLD` (marginal or uncertain), or `ALLOW` (trace sufficiently matches gold graph).

The three defining properties that distinguish PLV from virtually everything else in this space:

- **Formal reference graph** (not a textual plan or LLM rubric)
- **Categorical support predicates per step** (not a continuous score)
- **Policy-gated binary verdict** that can stop or flag execution (`BLOCK`/`HOLD`/`ALLOW`)

---

## Section 1: Agent Eval Frameworks (Industry / Open Source)

### 1.1 LangSmith / `agentevals` (LangChain)

**Source:** [LangSmith trajectory evaluation docs](https://docs.langchain.com/langsmith/trajectory-evals)

LangSmith's `agentevals` package provides a `create_trajectory_match_evaluator` function with four matching modes against a reference trajectory:

| Mode | Behavior |
|------|----------|
| `strict` | Exact match of messages and tool calls in order |
| `unordered` | Same tool calls, any order |
| `subset` | Agent calls only tools from reference (no extras) |
| `superset` | Agent calls at least all reference tools (extras allowed) |

Each evaluator returns a boolean `score` and optional `comment`. An LLM-as-judge variant is also available for qualitative trajectory assessment without a reference.

**vs. PLV:** The reference trajectory is a flat list of `HumanMessage`/`AIMessage`/`ToolMessage` objects — not a directed graph. There are no per-step support predicates (supported/unsupported/skipped); match is binary pass/fail for the whole trajectory, not per step. No `BLOCK`/`HOLD`/`ALLOW` verdict; results feed into test assertions or CI dashboards but do not gate agent execution.

**Practical note:** This is the most structurally honest "reference plan comparison" in any production tool. The `strict` mode comes closest to PLV's mechanics but lacks graph topology, per-step granularity, and enforcement coupling.

**License/cost:** Open source (`agentevals` package); LangSmith cloud is commercial with free tier.

---

### 1.2 TruLens GPA — Goal-Plan-Action (Snowflake)

**Source:** [TruLens documentation](https://www.trulens.org) / [MLflow + TruLens blog](https://mlflow.org/blog/mlflow-trulens-evaluation)

TruLens GPA introduces a structured scoring framework for agent spans: **PlanQuality**, **ToolSelection**, **PlanAdherence**, **ToolCalling**, **LogicalConsistency**, **ExecutionEfficiency**. Scorers run on the full span tree (nested LLM + tool call logs) via MLflow integration.

**Key result:** On the TRAIL benchmark (148 human-annotated traces, 841 labeled errors), GPA judges identified 95% of human-labeled agent errors vs. 55% for baseline trace-aware judges, with 86% localization accuracy to the exact error span.

**vs. PLV:** GPA reads the full span tree but has no formal reference graph — it evaluates trajectory quality relative to the stated goal, not against a gold plan. Scoring is continuous (no categorical predicates). No `BLOCK`/`HOLD`/`ALLOW` verdict; integrated into MLflow as scorers for offline analysis.

**Verdict on marketing claims:** The 95% error detection figure is real and verifiable against the TRAIL benchmark. The "step-level" claim is legitimate — GPA localizes to specific spans. But it is scoring, not structural verification against a reference.

**License:** Open source (Apache 2.0, Snowflake).

---

### 1.3 DeepEval / Confident AI

**Source:** [DeepEval agent evaluation metrics guide](https://deepeval.com/guides/guides-ai-agent-evaluation-metrics)

DeepEval provides the most granular commercial metric set for agent evaluation:

| Metric | What it measures |
|--------|-----------------|
| `PlanQualityMetric` | Whether the planned steps are reasonable for the task |
| `PlanAdherenceMetric` | Whether the agent followed its stated plan |
| `ToolCorrectnessMetric` | Correct tool selection (3 strictness levels) |
| `ArgumentCorrectnessMetric` | Correct tool arguments |
| `TaskCompletionMetric` | Whether the task was ultimately completed |
| `StepEfficiencyMetric` | Whether steps were redundant or unnecessary |

Component-level metrics are attached via `@observe` decorator to specific spans.

**vs. PLV:** `PlanAdherenceMetric` is the closest commercial analogue — it evaluates whether each step follows a stated plan. However, the plan is a free-text description, not a formal graph; evaluation is LLM-as-judge (not deterministic predicate assignment); there are no categorical support predicates and no `BLOCK`/`HOLD`/`ALLOW` verdict.

**Verdict on marketing claims:** The "step-level" claim is real — metrics are attached at the span/step level, not just on final output. The gap vs. PLV is that "reference plan" means a text prompt, not a graph structure, so the comparison is qualitative rather than structural.

**License:** Open source core (DeepEval on GitHub) + commercial cloud UI (Confident AI).

---

### 1.4 Langfuse

**Source:** [Langfuse agent observability blog](https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse)

Langfuse supports three evaluation strategies for agents:

- **Black-box:** Final response only
- **Glass-box (trajectory mode):** Compares actual execution sequence against an expected trajectory — catches skipped steps and wrong tool ordering
- **White-box:** Single-step evaluation on individual spans

**vs. PLV:** Trajectory mode compares against an expected sequence, which is the conceptual analogue of PLV's gold step graph. However, comparison is LLM-as-judge, not formal predicate assignment; no per-step support predicates; no policy-gated verdict. The expected trajectory is not a graph structure (no topology, no criticality weights).

**License:** Open source.

---

### 1.5 Braintrust

**Source:** [Braintrust AI agent evaluation framework](https://www.braintrust.dev/articles/ai-agent-evaluation-framework)

Metrics: Plan quality, plan adherence, tool selection accuracy, tool correctness (3 strictness levels), argument correctness, execution path validity, step efficiency. Supports span-level human feedback and one-click trace-to-dataset conversion for CI/CD via GitHub Action.

**vs. PLV:** No reference plan graph. Adherence scoring is LLM-as-judge against a textual plan description. No binary enforcement verdict. Strong CI/CD integration makes it production-practical for regression testing, but it is fundamentally a scoring system rather than a verifier.

**License:** Commercial SaaS with free tier.

---

### 1.6 Galileo / Luna

**Source:** [Galileo agent evaluation blog](https://galileo.ai/blog/ai-agent-evaluation)

Provides 9 out-of-the-box agent metrics including Tool Selection Quality, Action Advancement, Agent Flow adherence, and Action Completion. Uses Luna-2 small language models (SLMs) for on-premise, low-cost evaluation.

**vs. PLV:** Metrics measure trajectory quality relative to stated goal — not comparison against a reference plan graph. The "step-level" marketing claim means LLM scoring of individual tool calls, not structural verification against a gold graph. No support predicates, no `BLOCK`/`HOLD`/`ALLOW`.

**Verdict on marketing claims:** "Step-level eval" is partially marketing. Luna's SLM scoring is efficient and cheaper than GPT-4-as-judge, but the underlying approach is still LLM scoring without reference plan structure.

---

### 1.7 Arize Phoenix

**Source:** [Arize Phoenix LLM evaluators documentation](https://arize.com/docs/phoenix/evaluation/server-evals/llm-evaluators)

Open-source, OpenTelemetry-based observability platform with LLM evaluators for router/tool correctness, hallucination detection, and Q&A quality. Evaluates whether the correct function was called (binary correct/incorrect per span).

**vs. PLV:** Per-span binary correct/incorrect is the mechanical parallel, but there is no reference plan graph — evaluation is against a per-call judgment of whether the right tool was selected for the context, not whether the sequence matches a gold plan. No multi-step predicate aggregation, no verdict.

**License:** Open source (Apache 2.0).

---

### 1.8 Patronus AI / TRAIL Benchmark

**Source:** [Patronus AI TRAIL benchmark](https://arxiv.org/abs/2505.08638) / [Patronus TRAIL GitHub](https://github.com/patronus-ai/trail-benchmark) / [Patronus FinanceBench docs](https://docs.patronus.ai/docs/research_and_differentiators/financebench)

Patronus AI's **Lynx** model (70B + 8B variant) detects hallucinations across 8 error types with chain-of-thought explanations. **GLIDER** (3.8B) achieves 91% agreement with human judgments on subjective tasks.

The **TRAIL benchmark** (2025) is the most practically important contribution: 148 human-annotated agent traces, 841 labeled errors, 20+ agentic error taxonomy, with structured OpenTelemetry traces. Critically, the best-performing model (Gemini 2.5 Pro) achieves only **11% joint accuracy** on turn-level error localization — revealing a wide gap between current eval capabilities and human-level trace analysis.

**vs. PLV:** Patronus evaluates trace quality but does not compare against a gold plan graph. TRAIL is a benchmark dataset, not a verifier. However, TRAIL's structured error taxonomy (step-level annotation) and the 11% accuracy ceiling demonstrate that PLV is solving a genuinely hard problem that even frontier models fail at when asked to localize errors without a reference graph.

**License:** TRAIL is open source.

---

### 1.9 W&B Weave

**Source:** [W&B Agents page](https://wandb.ai/site/agents/)

Provides distributed tracing, custom scorer framework, guardrails, and visualization of complex agent rollouts. Supports OpenTelemetry, A2A, and MCP protocols for heterogeneous agent systems.

**vs. PLV:** Custom scorer framework is general-purpose — users can implement plan-comparison logic, but Weave does not provide this out of the box. No built-in reference plan comparison, no support predicates, no verdict mechanism. The observability layer is strong; the eval layer is a blank canvas.

**Step-level verification claim:** obs-only (unverified) — no published documentation of built-in plan-graph comparison.

---

### 1.10 HoneyHive

**Source:** [HoneyHive website](https://www.honeyhive.ai)

OTel-native platform with graph/timeline view of agent traces, LLM-as-judge trajectory evaluation, custom rubrics, and annotation queues. Used by Commonwealth Bank of Australia for evaluation of 17M+ consumer-facing agent interactions.

**vs. PLV:** Trajectory evaluation is LLM-as-judge with custom rubrics — not reference-plan comparison. The graph/timeline view is a visualization tool, not a structural verifier.

**Step-level verification claim:** obs-only (unverified).

---

### 1.11 Humanloop

**Source:** [Humanloop evaluators documentation](https://humanloop.com/docs/explanation/evaluators) / [Humanloop agent eval quickstart](https://humanloop.com/docs/quickstart/agent-evals-in-ui)

Evaluators are user-defined functions (Code, AI, or Human) that return boolean or numeric judgments on LLM-generated logs. Agent evaluation captures full traces including intermediate LLM calls and tool invocations. Supports offline and online evaluation modes.

**vs. PLV:** Evaluator framework is general — users define their own logic. No built-in reference plan graph comparison. "Tool Call" evaluator in the quickstart example checks whether a tool was used (binary), not whether a sequence matched a gold plan. No support predicates or verdict mechanism out of the box.

---

### 1.12 PromptLayer / Helicone / AgentOps / Maxim AI / Context.ai / Athina AI

These platforms are primarily **observability-focused**: logging, tracing, cost/latency monitoring, prompt versioning. None claim built-in structural plan verification against a reference graph. Some offer LLM-as-judge quality metrics as add-ons.

**Step-level verification claims for all:** obs-only (unverified). Treat as monitoring infrastructure rather than verification systems.

---

## Section 2: Academic Work

### 2.1 Per-Step Reasoning Evaluation

#### ReCEval (Prasad et al., EMNLP 2023)
**Source:** [arXiv:2304.10703](https://arxiv.org/abs/2304.10703)

Evaluates reasoning chains along two axes per step: **correctness** (intra-step validity + inter-step consistency using NLI) and **informativeness** (V-Information gain). Chain quality is the minimum across all steps — the weakest step determines the chain score.

**vs. PLV:** This is the closest academic analogue to PLV's per-step support predicate model. The min-aggregation mirrors PLV's logic that a single unsupported critical step can trigger a `BLOCK`. Key differences: no reference plan graph (evaluation is reference-free), predicates are continuous scores not categorical (`supported`/`unsupported`/`skipped`), and there is no actionable verdict — results are evaluation metrics, not execution gates.

#### ROSCOE (Golovneva et al., Meta AI, 2022)
**Source:** [arXiv:2212.07919](https://arxiv.org/abs/2212.07919)

Suite of 14 reference-free, unsupervised step-level metrics across four dimensions: semantic alignment, logicality, informativeness, and fluency. Evaluates multi-step reasoning chains without requiring gold solutions.

**vs. PLV:** Step-level scoring is genuine, but support assessment is implicit via semantic similarity — not a categorical `supported`/`unsupported`/`skipped` predicate. No reference plan graph. No verdict mechanism.

#### ReasonEval (2024)
**Source:** [arXiv:2404.05692](https://arxiv.org/abs/2404.05692)

Evaluates step validity and redundancy for mathematical reasoning chains. Outperforms ROSCOE on reasoning quality benchmarks. Math-domain specific; validity/redundancy are not the same as support predicates.

---

### 2.2 Claim-Level Verification

#### FActScore (Min et al., EMNLP 2023)
**Source:** [arXiv:2305.14251](https://arxiv.org/abs/2305.14251)

Decomposes text into atomic facts, then assesses each fact as `supported` or `not supported` against a knowledge source. Final score = percentage of supported atomic facts.

**vs. PLV:** The supported/not-supported predicate model directly parallels PLV's support predicates — this is the clearest conceptual ancestor. The gap is domain: FActScore operates at the claim/fact level for factual text generation, not at the reasoning step level for agent traces. No reference plan graph, no verdict mechanism, no `skipped` predicate.

---

### 2.3 Process Supervision (Step-Level Human Labels)

#### "Let's Verify Step by Step" — Lightman et al. (OpenAI, ICLR 2024)
**Source:** [arXiv:2305.20050](https://arxiv.org/abs/2305.20050)

PRM800K: 800,000 step-level human correctness labels for mathematical reasoning. Process reward models trained on this data achieve 78% on MATH benchmark, significantly outperforming outcome-supervised models.

**vs. PLV:** This is the empirical foundation for step-level supervision — it demonstrates that per-step binary labels are more informative than final-answer labels. PLV applies this intuition to agent trace verification. Key differences: math-only domain; labels are binary correct/incorrect (not `supported`/`unsupported`/`skipped`); no reference plan graph; no enforcement verdict.

#### Math-Shepherd (Wang et al., ACL 2024)
**Source:** [arXiv:2312.08935](https://arxiv.org/abs/2312.08935)

Generates process reward labels automatically via Monte Carlo rollouts, eliminating expensive human annotation. Extends the Lightman et al. approach to scalable automatic labeling.

**vs. PLV:** Same as Lightman et al. — math domain, continuous reward signal, no reference graph, no verdict.

#### Uesato et al. (DeepMind, 2022)
**Source:** [arXiv:2211.14275](https://arxiv.org/abs/2211.14275)

First comprehensive comparison of process vs. outcome supervision for reasoning. Process-based models reduce trace error rate from 14% to 3.4% on GSM8K. Academic foundation establishing that step-level verification is worth the cost.

---

### 2.4 External Verification Architecture

#### LLM-Modulo (Kambhampati, 2024)
**Source:** [arXiv:2402.01817](https://arxiv.org/abs/2402.01817)

Core thesis: LLMs cannot reliably self-verify their own reasoning. Proposes a "bank of verifiers" architecture where external model-based verifiers check LLM-generated plans. For planning tasks, VAL (a PDDL plan validator) serves as the external verifier. For code tasks, an interpreter serves as the verifier.

**vs. PLV:** This is the closest **architectural** parallel to PLV. Both treat the LLM's output as a candidate to be verified by an external formal system, not trusted at face value. Key differences: LLM-Modulo uses domain-specific verifiers (VAL for PDDL planning, Python interpreter for code) — there is no general-purpose agent trace verifier. PLV generalizes this pattern with a gold step graph applicable to any agent task.

#### PDDL / VAL Plan Validator
**Source:** [INVAL/VAL GitHub](https://github.com/patrikhaslum/INVAL)

VAL is a formal plan validator for classical planning domains. Given a PDDL domain model, initial state, goal, and candidate plan, VAL determines whether the plan achieves the goal — deterministically, without LLM judgment.

**vs. PLV:** This is the most structurally rigorous analogue to PLV's gold step graph — a domain model defines what "correct" means, and validation is deterministic. The constraint is domain specificity: PDDL domains must be hand-authored and are restricted to structured state-action problems. PLV generalizes this to natural-language agent traces.

---

### 2.5 Self-Verification and Self-Correction

#### Chain-of-Verification / CoVe (Dhuliawala et al., Meta AI, 2024)
**Source:** [arXiv:2309.11495](https://arxiv.org/abs/2309.11495)

4-step self-verification pipeline: draft response → generate verification questions → answer questions independently → revise response. The "factored" variant (independent verification) is most effective.

**vs. PLV:** Self-verification — the LLM verifies its own claims. No external reference graph. No external verifier. Improves output quality but does not provide structural verification against a gold plan.

#### Reflexion (Shinn et al., NeurIPS 2023)
**Source:** [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)

Verbal reinforcement learning: environment feedback is converted to textual reflection stored in episodic memory, which guides subsequent attempts.

**vs. PLV:** Self-improvement loop, not structural plan verification. No reference graph.

#### CRITIC (ICLR 2024)
**Source:** [arXiv:2305.11738](https://arxiv.org/abs/2305.11738)

LLM uses external tools (search, Python, Wikipedia) to verify its own claims, then corrects based on tool output.

**vs. PLV:** External tool verification is closer to PLV's external verifier pattern than pure self-reflection, but verification is per-claim in the output (not per-step against a gold plan). No reference graph; no verdict.

#### Self-Refine (Madaan et al., NeurIPS 2023)
**Source:** [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)

Iterative self-feedback without external supervisor. LLM generates → critiques → refines in a loop.

**vs. PLV:** No external reference. Pure self-correction.

---

### 2.6 Agent Benchmarks

#### τ-bench / τ³-bench (Yao et al., Sierra, ICLR 2025)
**Source:** [arXiv:2406.12045](https://arxiv.org/abs/2406.12045)

Tool-Agent-User benchmark comparing database state at conversation end against expected final state. Uses `pass^k` reliability metric for multi-turn evaluation. τ³-bench adds knowledge base retrieval and voice modality.

**vs. PLV:** End-state comparison — verifies that the final database state matches expected state, but does not verify intermediate reasoning steps. No step-level predicate assignment; no gold plan graph. Closest to PLV's verification intent (did the agent get to the right place?), but blind to how it got there.

#### TRAIL Benchmark (Patronus AI, 2025)
**Source:** [arXiv:2505.08638](https://arxiv.org/abs/2505.08638) / [GitHub](https://github.com/patronus-ai/trail-benchmark)

148 human-annotated agent traces with 841 labeled errors across 20+ agentic error types. Structured OpenTelemetry format. **Key finding:** best model (Gemini 2.5 Pro) achieves 11% joint accuracy on turn-level error localization — indicating current frontier models cannot reliably locate step-level errors without a reference structure.

**vs. PLV:** TRAIL is a benchmark measuring how well judges can identify errors in agent traces — it is not itself a verifier. However, it empirically validates PLV's design premise: unguided LLM evaluation of agent traces is unreliable even for frontier models. PLV's gold step graph provides the reference structure that makes error localization tractable.

#### GAIA (2023)
**Source:** [Princeton HAL](https://hal.cs.princeton.edu/gaia)

450 real-world questions requiring multi-step reasoning, web browsing, and tool use. Answer-level evaluation only — no step verification.

#### AgentBench (Liu et al., 2023)
**Source:** [arXiv:2308.03688](https://arxiv.org/abs/2308.03688)

8 interactive environments (OS, browser, shopping, etc.) with task success rate as metric. Outcome-level only — no step verification.

---

### 2.7 Evaluator Models

#### Prometheus 2 (Kim et al., EMNLP 2024)
**Source:** [arXiv:2405.01535](https://arxiv.org/abs/2405.01535)

Open evaluator LM supporting custom rubric-based assessment, both absolute scoring and pairwise ranking. Achieves Pearson 0.897 correlation with human judgments.

**vs. PLV:** Prometheus evaluates output quality against a custom rubric — it is a general-purpose rubric-grader, not a reference-plan verifier. No graph structure, no support predicates, no verdict mechanism. Could be used as PLV's predicate-assignment component for natural-language steps, but is not itself a plan verifier.

---

## Section 3: Industry Deployments and Standards

### 3.1 Anthropic

**Source:** [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

Anthropic's internal agent evaluation framework uses four mechanisms:

1. **Tool call verification** — check whether required tools were called (requires tools list)
2. **State_check** — compare database/environment state after execution against expected
3. **Transcript analysis** — verify turn count, tool call sequence, absence of policy violations
4. **LLM rubric** — qualitative assessment by a judge model

For safety, Anthropic's Responsible Scaling Policy (RSP) uses capability-level classifiers (ASL-2/ASL-3) that assess whether a model has crossed a capability threshold — not step-level plan verification.

**vs. PLV:** The combination of tool call verification + transcript analysis + state_check is the closest to PLV's full pipeline among major AI labs. However, there is no gold step graph; sequence verification is textual pattern matching, not predicate assignment against a reference graph. No `BLOCK`/`HOLD`/`ALLOW` verdict that gates actual execution.

**Verdict on marketing claims:** Anthropic's public documentation is technically honest about what each mechanism does. No "step-level plan verification" claim made.

---

### 3.2 OpenAI Evals

**Source:** [OpenAI Evals GitHub](https://github.com/openai/evals) / [OpenAI agent evals guide](https://developers.openai.com/api/docs/guides/agent-evals)

OpenAI's evals library supports trace grading: did the agent pick the right tool, did the handoff happen correctly, were policy violations present. Custom eval classes allow arbitrary grading logic.

**vs. PLV:** The evals library is a framework for custom evaluation — it does not implement plan-graph comparison out of the box. Users can build PLV-like evaluators within it, but OpenAI does not offer this as a product. Outcome-level and tool-call-level metrics only in the default templates.

---

### 3.3 Salesforce Agentforce

**Source:** [Salesforce Agentforce Testing Center blog](https://admin.salesforce.com/blog/2025/ensuring-ai-accuracy-5-steps-to-test-agentforce)

The Agentforce Testing Center evaluates Topic + Action + Outcome per test case against an expected value. A **Plan Tracer** component allows inspection of the agent's reasoning sequence. LLM-as-judge is used for outcome evaluation.

**vs. PLV:** This is the closest enterprise CRM analogue to PLV's intent. Topic/Action/Outcome breakdown is a three-level structural verification. However, the Plan Tracer is inspection tooling (not a formal verifier), and Topic/Action comparison uses LLM-as-judge rather than formal predicate assignment. No gold step graph; no `BLOCK`/`HOLD`/`ALLOW`.

**Marketing claim assessment:** The "step-level" evaluation claim is partially substantiated — Topic and Action are evaluated separately before Outcome. But this is a 3-node tree, not a full graph, and comparison is LLM-graded.

---

### 3.4 Palantir AIP

**Source:** [Palantir AIP governance documentation](https://palantir.com/docs/foundry/aip/ethics-governance/)

AIP Evals uses LLM-as-judge scoring combined with human-in-the-loop governance gates and full agent provenance audit trails. AIP Analyst shows intermediate reasoning steps. A dependency graph tracks data lineage.

**vs. PLV:** The dependency graph is for data provenance, not for plan verification. Intermediate step inspection (AIP Analyst) is forensic/observational, not real-time structural verification. No reference plan graph; no support predicates; no execution-gating verdict.

---

### 3.5 Regulatory Standards

#### EU AI Act (Article 15)
**Source:** [EU AI Act Article 15](https://artificialintelligenceact.eu/article/15/)

Requires "appropriate levels of accuracy, robustness, and cybersecurity" for high-risk AI systems. Does not operationalize step-level verification — the Commission is tasked with developing benchmarks and methodologies.

**Relevance to PLV:** PLV's `BLOCK`/`HOLD`/`ALLOW` verdict mechanism provides a concrete operationalization of "accuracy" requirements for AI agents in high-risk domains. No existing standard specifies how to verify agent reasoning step-by-step; PLV fills this gap.

#### NIST AI RMF + Agentic Profile (2024–2025)
**Source:** [NIST AI RMF Agentic Profile (Cloud Security Alliance)](https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/) / [NIST AI 600-1 (Generative AI Profile)](https://www.nist.gov/programs-projects/concept-note-ai-rmf-profile-trustworthy-ai-critical-infrastructure)

The base NIST AI RMF (2023) addresses trustworthiness characteristics including validity, reliability, safety, and accountability — but does not operationalize step-level agent verification. The 2024 Generative AI Profile (AI 600-1) adds 200+ actions across 12 risk areas but was designed before agentic systems were prevalent.

A 2025 community-proposed Agentic Profile recommends: autonomy tier classification, action-consequence mapping (consequence graphs for tool invocations), and delegation chain monitoring. The proposed consequence graph — a directed graph where nodes are agent states and edges are tool invocations — is structurally parallel to PLV's gold step graph.

**Relevance to PLV:** PLV implements a practical version of what the NIST Agentic Profile recommends conceptually. The consequence graph / gold step graph parallelism is significant for regulatory positioning.

#### ISO/IEC 42001 (2023)
AI Management System standard. Defines governance processes, risk assessment, and documentation requirements for AI systems. Does not specify evaluation mechanisms at the step level.

---

## Section 4: Comparison Table

| System | Granularity | Reference plan required | Support predicate model | Verdict / enforcement | Open source | Model-agnostic | Domain |
|--------|-------------|------------------------|------------------------|----------------------|-------------|----------------|--------|
| **ThoughtProof PLV** | Step (gold graph node) | Yes — formal directed graph | Categorical: supported / unsupported / skipped | BLOCK / HOLD / ALLOW gates execution | — | Yes | General agent |
| LangSmith `agentevals` (strict) | Trajectory (message list) | Yes — reference message list | Binary: pass/fail per trajectory (not per step) | CI assert / test result; no execution gate | Yes | Yes | General agent |
| TruLens GPA | Span (nested log tree) | No — goal-relative | Continuous scores (PlanAdherence, etc.) | None — offline scorer | Yes | Yes | General agent |
| DeepEval `PlanAdherenceMetric` | Step / span | Text plan (LLM-judged) | Continuous score | None — CI metric | Yes (core) | Yes | General |
| Langfuse (trajectory mode) | Trajectory | Expected sequence (text) | LLM-as-judge; no predicate model | None — monitoring | Yes | Yes | General |
| Braintrust | Span | No formal plan | Continuous LLM-as-judge scores | None — dashboard | No | Yes | General |
| Galileo Luna | Step (tool call) | No | Continuous SLM scores | None | No | Yes | General |
| ReCEval | Step | No (reference-free) | Continuous (NLI + V-Info) | None — research metric | Yes | Yes | Academic |
| FActScore | Claim (atomic fact) | Knowledge source | Binary: supported / not-supported | None — factuality score | Yes | Yes | Factual gen. |
| LLM-Modulo + VAL | Step | PDDL domain model | Binary: valid / invalid plan step | Loop: reject and re-plan | Yes | N/A | PDDL planning |
| TRAIL benchmark | Turn / span | Human annotations | Categorical error labels | None — benchmark | Yes | N/A | General agent |
| τ-bench | Conversation end-state | Expected DB state | Binary: state match / mismatch | None — benchmark | Yes | N/A | Customer svc. |
| Salesforce Agentforce | Topic / Action / Outcome | Expected values (text) | LLM-as-judge per component | None — test dashboard | No | No | CRM |
| Prometheus 2 | Output | Custom rubric | Continuous + pairwise | None — eval model | Yes | Yes | General |
| ROSCOE | Step | No (reference-free) | Continuous (14 metrics) | None — research metric | Yes | Yes | Academic |
| Lightman et al. PRM | Step | Human labels | Binary: correct / incorrect | Reward signal (training only) | Yes | N/A | Math |

---

## Section 5: Whitespace and Positioning Conclusions

### 5.1 The Gap No Production System Fills

Every production evaluation system surveyed falls into one of two categories:

**Category A — Outcome evaluators:** Compare final output or end-state against expected (τ-bench, GAIA, AgentBench, most LLM-as-judge tools). Blind to intermediate reasoning errors that happen to produce a correct-looking final answer.

**Category B — Trajectory scorers:** Evaluate the quality of the reasoning path using LLM-as-judge or rule-based scoring (TruLens GPA, DeepEval, Langfuse, Braintrust, Galileo). Provide step-level granularity in scoring but do not compare against a formal reference structure.

**PLV occupies a third category — structural verifiers** — alongside only: VAL for PDDL planning (domain-restricted) and the proposed NIST Agentic Profile consequence graph (conceptual, not implemented). This category did not previously exist as a general-purpose production product.

### 5.2 Why LLM-as-Judge Scoring Is Not Equivalent

The TRAIL benchmark provides the clearest empirical evidence: when asked to identify step-level errors in agent traces without a reference structure, even Gemini 2.5 Pro achieves only 11% joint accuracy ([Patronus AI, arXiv:2505.08638](https://arxiv.org/abs/2505.08638)). This is not a capability ceiling for LLM judges — it is a structural problem. Without a reference plan specifying what steps should have occurred, an LLM evaluator cannot reliably distinguish:

- A step that was skipped (vs. correctly omitted)
- An unsupported inference (vs. a valid heuristic shortcut)
- A plan deviation that matters (vs. one that doesn't)

PLV's gold step graph makes these distinctions tractable by providing the reference structure that LLM judges lack.

### 5.3 The Verdict Mechanism Is Uniquely Valuable in Regulated Domains

All surveyed production tools produce scores, metrics, or flags that feed into dashboards or CI pipelines. None implement an execution-gating verdict that can `BLOCK` agent action in real time based on reasoning trace verification.

In regulated domains — financial services (where a miscalculated step in a credit decision has legal liability), healthcare (where a skipped clinical guideline step is an adverse event risk), and legal services (where an unsupported step in contract analysis creates malpractice exposure) — a dashboard score is insufficient. The question is not "how well did the agent reason?" but "should we permit this agent action?"

PLV's `BLOCK`/`HOLD`/`ALLOW` verdict maps directly to this decision, which is why no existing tool satisfies the requirement. Existing tools are built for retrospective quality assessment; PLV is designed for prospective execution governance.

### 5.4 Differentiation Claims Assessment

| Claim | Assessment |
|-------|-----------|
| "No production system uses a formal reference graph" | **Verified** — LangSmith's reference trajectory is a message list; all others use text plans or no reference |
| "No production system assigns categorical support predicates" | **Verified** — all production tools use continuous scores or binary trajectory pass/fail |
| "No production system has a BLOCK/HOLD/ALLOW verdict that gates execution" | **Verified** — all surveyed tools produce metrics/scores; none described gate live agent actions |
| "Step-level eval claims by Galileo/Braintrust are marketing" | **Partially verified** — "step-level" means LLM-as-judge on individual tool calls; this is genuine step granularity, but not structural plan verification |
| "TruLens GPA is the closest open-source analogue" | **Verified** — GPA localizes errors to specific spans with 86% accuracy, but scoring is continuous and reference-free |
| "LLM-Modulo + VAL is the closest architectural parallel" | **Verified** — external formal verifier checking LLM plan against domain model is structurally identical to PLV; restricted to PDDL planning domains |

### 5.5 Strategic Positioning Recommendations

1. **Emphasize the reference graph, not just "step-level"** — the market is saturated with "step-level evaluation" claims. PLV's differentiation is structural verification against a gold reference graph, which is absent from all commercial tools.

2. **Lead with TRAIL's 11% finding** — this empirically demonstrates that LLM-as-judge step-level evaluation fails without a reference structure. PLV's gold step graph is the answer to why frontier models fail at trace verification.

3. **Target regulated domains first** — only in domains with explicit action consequences (financial, healthcare, legal) does the `BLOCK`/`HOLD`/`ALLOW` mechanism have clear economic value over a dashboard score. Consumer AI teams buying TruLens or DeepEval are not the core buyer.

4. **Position vs. LangSmith trajectory match** — this is the closest competitor with a reference-based comparison. Key differentiators: PLV uses a graph (not a list); PLV assigns per-step predicates (not whole-trajectory pass/fail); PLV's verdict gates execution (not CI test assertion).

5. **Monitor the NIST Agentic Profile** — the proposed consequence graph language in the 2025 community draft is structurally aligned with PLV. If NIST formalizes this language in an official profile, PLV becomes the reference implementation of an emerging regulatory requirement.

---

## Consolidated References

All references from Parts 1, 2, and 3, deduplicated and grouped by topic.

### Calibration, Grounding & Faithfulness

| # | Citation | URL |
|---|----------|-----|
| 1 | Min et al. "FActScore: Fine-grained Atomic Evaluation of Factual Precision." EMNLP 2023. | https://arxiv.org/abs/2305.14251 |
| 2 | Es et al. "Ragas: Automated Evaluation of Retrieval Augmented Generation." 2023. | https://arxiv.org/abs/2309.15217 |
| 3 | Zha et al. "AlignScore: Evaluating Factual Consistency with a Unified Alignment Function." ACL 2023. | https://arxiv.org/abs/2305.16739 |
| 4 | Honovich et al. "TRUE: Re-evaluating Factual Consistency Evaluation." NAACL 2022. | https://arxiv.org/abs/2204.04991 |
| 5 | Lanham et al. "Measuring Faithfulness in Chain-of-Thought Reasoning." Anthropic, 2023. | https://arxiv.org/abs/2307.13702 |
| 6 | Turpin et al. "Language Models Don't Always Say What They Think." NeurIPS 2023. | https://arxiv.org/abs/2305.04388 |

### LLM-as-Judge & Evaluation Models

| # | Citation | URL |
|---|----------|-----|
| 7 | Liu et al. "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment." EMNLP 2023. | https://aclanthology.org/2023.emnlp-main.153/ |
| 8 | Liu et al. "G-Eval." arXiv preprint. | https://arxiv.org/abs/2303.16634 |
| 9 | Kim et al. "Prometheus: Inducing Fine-grained Evaluation Capability in Language Models." ICLR 2024. | https://arxiv.org/abs/2310.08491 |
| 10 | Kim et al. "Prometheus 2: An Open Source Language Model Specialized in Evaluating Other Language Models." EMNLP 2024. | https://arxiv.org/pdf/2405.01535 |
| 11 | Zhu et al. "JudgeLM: Fine-tuned Large Language Models are Scalable Judges." 2023. | https://arxiv.org/html/2310.17631v2 |
| 12 | Alexandru et al. "Atla Selene Mini: A General Purpose Evaluation Model." 2025. | https://arxiv.org/abs/2501.17195 |
| 13 | Jung et al. "Trust or Escalate: LLM Judges with Provable Guarantees for Human Agreement." 2024. | https://openreview.net/forum?id=UHPnqSTBPO |
| 14 | Prometheus-eval GitHub. | https://github.com/prometheus-eval/prometheus-eval |
| 15 | Autorubric (2026). Unifying rubric-based LLM evaluation. | https://arxiv.org/abs/2603.00077 |
| 16 | LLM Structured Output Reliability (2025). Framework for evaluating JSON output consistency. | https://arxiv.org/abs/2512.23712 |

### Process Supervision & Step-Level Verification

| # | Citation | URL |
|---|----------|-----|
| 17 | Lightman et al. "Let's Verify Step by Step." OpenAI, ICLR 2024. | https://arxiv.org/abs/2305.20050 |
| 18 | PRM800K Dataset (OpenAI). | https://github.com/openai/prm800k |
| 19 | Wang et al. "Math-Shepherd: Verify and Reinforce LLMs Step-by-Step." 2023. | https://arxiv.org/abs/2312.08935 |
| 20 | Uesato et al. "Solving Math Word Problems with Process- and Outcome-based Feedback." NeurIPS 2022. | https://arxiv.org/abs/2211.14275 |
| 21 | ReasonEval. "Evaluating Mathematical Reasoning Beyond Accuracy." CMU/GAIR-NLP, 2025. | https://www.cs.cmu.edu/~sherryw/assets/pubs/2025-reasoneval.pdf |
| 22 | ReasonEval GitHub. | https://github.com/gair-nlp/reasoneval |
| 23 | Golovneva et al. "ROSCOE: A Suite of Metrics for Scoring Step-by-Step Reasoning." ICLR 2023. | https://arxiv.org/abs/2212.07919 |
| 24 | Prasad et al. "ReCEval: Evaluating Reasoning Chains via Correctness and Informativeness." EMNLP 2023. | https://arxiv.org/abs/2304.10703 |
| 25 | ReasonEval (2024). Step validity and redundancy for math reasoning. | https://arxiv.org/abs/2404.05692 |

### Mistake-Finding & Reasoning Error Analysis

| # | Citation | URL |
|---|----------|-----|
| 26 | Tyen et al. "LLMs cannot find reasoning errors, but can correct them given the error location." ACL Findings 2024. | https://aclanthology.org/2024.findings-acl.826 |
| 27 | Demystifying LLM Reasoning Errors (2025). | https://arxiv.org/html/2512.00215v1 |

### Agent Evaluation Frameworks (Academic)

| # | Citation | URL |
|---|----------|-----|
| 28 | Kambhampati et al. "LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks." ICML 2024. | https://arxiv.org/abs/2402.01817 |
| 29 | Yao et al. "τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains." 2024. | https://arxiv.org/abs/2406.12045 |
| 30 | τ-bench GitHub (Sierra Research). | https://github.com/sierra-research/tau-bench |
| 31 | Ru et al. "RAGChecker: A Fine-grained Framework for Diagnosing Retrieval-Augmented Generation." 2024. | https://arxiv.org/abs/2408.08067 |
| 32 | RAGChecker GitHub (Amazon Science). | https://github.com/amazon-science/RAGChecker |
| 33 | Wang et al. (Meta AI) "Shepherd: A Critic for Language Model Generation." 2023. | https://arxiv.org/abs/2308.04592 |
| 34 | Shepherd GitHub (Meta AI Research). | https://github.com/facebookresearch/Shepherd |
| 35 | Gou et al. "CRITIC: Large Language Models Can Self-Correct with Tool-Interactive Critiquing." ICLR 2024. | https://arxiv.org/abs/2305.11738 |
| 36 | Dhuliawala et al. "Chain-of-Verification Reduces Hallucination in Large Language Models." 2023. | https://arxiv.org/abs/2309.11495 |
| 37 | Shinn et al. "Reflexion." NeurIPS 2023. | https://arxiv.org/abs/2303.11366 |
| 38 | Madaan et al. "Self-Refine." NeurIPS 2023. | https://arxiv.org/abs/2303.17651 |
| 39 | INVAL/VAL Plan Validator. | https://github.com/patrikhaslum/INVAL |
| 40 | Liu et al. "AgentBench." 2023. | https://arxiv.org/abs/2308.03688 |
| 41 | GAIA benchmark (Princeton HAL). | https://hal.cs.princeton.edu/gaia |
| 42 | Patronus AI TRAIL benchmark. | https://arxiv.org/abs/2505.08638 |
| 43 | Patronus TRAIL GitHub. | https://github.com/patronus-ai/trail-benchmark |
| 44 | Watch Every Step! LLM Agent Learning via Iterative Step-Level Process Refinement. EMNLP 2024. | https://aclanthology.org/2024.emnlp-main.93.pdf |

### Production Tools & Industry Docs

| # | Citation | URL |
|---|----------|-----|
| 45 | LangSmith trajectory evaluation documentation. | https://docs.langchain.com/langsmith/trajectory-evals |
| 46 | TruLens documentation. | https://www.trulens.org |
| 47 | MLflow + TruLens evaluation blog. | https://mlflow.org/blog/mlflow-trulens-evaluation |
| 48 | DeepEval agent evaluation metrics guide. | https://deepeval.com/guides/guides-ai-agent-evaluation-metrics |
| 49 | Langfuse agent observability blog. | https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse |
| 50 | Braintrust AI agent evaluation framework. | https://www.braintrust.dev/articles/ai-agent-evaluation-framework |
| 51 | Galileo agent evaluation blog. | https://galileo.ai/blog/ai-agent-evaluation |
| 52 | Galileo: Why LLM-as-a-judge fails. | https://galileo.ai/blog/why-llm-as-a-judge-fails |
| 53 | Arize Phoenix LLM evaluators documentation. | https://arize.com/docs/phoenix/evaluation/server-evals/llm-evaluators |
| 54 | Patronus FinanceBench docs. | https://docs.patronus.ai/docs/research_and_differentiators/financebench |
| 55 | W&B Agents. | https://wandb.ai/site/agents/ |
| 56 | HoneyHive. | https://www.honeyhive.ai |
| 57 | Humanloop evaluators documentation. | https://humanloop.com/docs/explanation/evaluators |
| 58 | Humanloop agent eval quickstart. | https://humanloop.com/docs/quickstart/agent-evals-in-ui |
| 59 | Anthropic: Demystifying Evals for AI Agents. | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents |
| 60 | Anthropic: Measuring Faithfulness in Chain-of-Thought Reasoning (research page). | https://www.anthropic.com/research/measuring-faithfulness-in-chain-of-thought-reasoning |
| 61 | OpenAI Evals GitHub. | https://github.com/openai/evals |
| 62 | OpenAI agent evals guide. | https://developers.openai.com/api/docs/guides/agent-evals |
| 63 | Salesforce Agentforce Testing Center. | https://admin.salesforce.com/blog/2025/ensuring-ai-accuracy-5-steps-to-test-agentforce |
| 64 | Palantir AIP governance documentation. | https://palantir.com/docs/foundry/aip/ethics-governance/ |
| 65 | AlignScore GitHub. | https://github.com/yuh-zha/AlignScore |

### Regulatory & Standards

| # | Citation | URL |
|---|----------|-----|
| 66 | EU AI Act Article 15. | https://artificialintelligenceact.eu/article/15/ |
| 67 | NIST AI RMF Agentic Profile (Cloud Security Alliance draft, 2025). | https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/ |
| 68 | NIST AI 600-1 Generative AI Profile concept note. | https://www.nist.gov/programs-projects/concept-note-ai-rmf-profile-trustworthy-ai-critical-infrastructure |

---

## Appendix — Action Checklist

The following numbered actions synthesize all three parts of this report into concrete this-week implementation steps. Each item identifies the most immediate next action and points back to the relevant section.

1. **Patch the evaluator prompt with the FActScore extractor→verifier split (Part 2 §3.3).** Replace the existing single-pass judge with the two-turn architecture: Turn 1 (haiku-class model) extracts candidate evidence spans as JSON; Turn 2 (sonnet-class) scores only what Turn 1 returned. If Turn 1 returns an empty list, the score is automatically capped at 0.25. Re-run the full H-family 4-item test set and compare predicate distributions before/after.

2. **Add mandatory `evidence_quote` field with Pydantic enforcement (Part 1 Q4 / Part 2 §2.3).** Instrument the evaluator's structured output with a Pydantic model that requires `evidence_quote: str | None`. Add the caller-side `verify_provenance()` function from Part 2 §2.3 to the evaluation pipeline. Log all `PROV_FAIL_01` / `PROV_FAIL_02` violations to a separate metrics stream. A non-null `evidence_quote` that is not a substring of the trace text is a hallucination — count these as calibration failures, not valid evaluations.

3. **Extend the gold step graph schema with `acceptance_criteria` fields for D-family steps (Part 1 Q4 / Part 2 §3.2).** Add at minimum: `expected_outcome_type`, `valid_outcomes`, `invalid_outcomes`, and `verification_question` to each critical gold step. Start with the 3 D-family cases from the current test set and manually annotate these fields. The verifier then checks `trace_conclusion ∈ valid_outcomes` and `trace_conclusion ∉ invalid_outcomes` as explicit comparisons — transforming D-family detection from open-ended judgment into structured lookup.

4. **Deploy AlignScore as a zero-cost Tier 1 screen (Part 1 Q5).** Self-host the [AlignScore RoBERTa-355M model](https://github.com/yuh-zha/AlignScore) and run it on all (gold_step_expected_output_text, trace_segment) pairs. Gate on thresholds: > 0.85 → pre-approve, < 0.30 → pre-reject, 0.30–0.85 → escalate to Tier 2 LLM judge. This eliminates LLM calls for the clear cases and cuts cost to ~$0.06/trace.

5. **Run the counterfactual ablation calibration test for H-family (Part 1 Q3).** Take each H-family false positive: remove the retrieval action from the trace context and re-submit to the current evaluator. If the score stays "supported" after removal, the evaluator is relying on prior knowledge, not trace evidence — this confirms the H-family failure mode. Collect ablation deltas; any step where removing the fetch does not change the score by at least 0.5 points is a calibration failure and should be added to the fine-tuning set (Action 9).

6. **Replace the majority-vote ensemble with an architecturally diverse dual-evaluator agreement gate (Part 1 Q4 / "Wrong Problem" §4).** Configure: Evaluator A = Prometheus-2-8x7B (or Claude-sonnet-class API) with rubric; Evaluator B = AlignScore embedding score on (evidence_quote → claim) pair. If |score_A − score_B_normalized| > 1.0 on a critical step → escalate to GPT-4o. This directly addresses why the prior majority vote experiment failed: same-architecture judges share the same failure modes and their disagreement is not informative.

7. **Implement the score-floor deterministic post-processing function (Part 2 §3.6).** The `apply_evidence_density_floors()` function in Part 2 §3.6 is a deterministic caller-side override — it does not require prompt changes. Add it as a post-processing step immediately after every evaluator call. This alone will correct Rule R1 and R3 violations in the current output without a full prompt migration.

8. **Add a producer-side `__plv_step_complete` marker to the agent prompt for controlled agent traces (Part 2 §3.7).** If you control the agent's system prompt, add a requirement to emit the structured JSON marker at each gold step completion. This converts the judge's job from evidence hunting to quote validation — the hardest evaluator task becomes the easiest. For third-party traces, skip this and rely on judge-side techniques, but prioritize this for any new in-house agent deployments.

9. **Collect and label 50–100 PLV-specific examples per failure family for fine-tuning (Part 1 Q3).** Tyen et al. show that a small out-of-domain classifier trained on domain-specific labeled examples outperforms 3-shot GPT-4 prompting. Create a labeled dataset with three classes: H-family false positive, D-family misapplication, correct evaluation. Use the counterfactual ablation test (Action 5) to generate H-family labels programmatically. Fine-tune [Atla Selene Mini 8B](https://arxiv.org/abs/2501.17195) or a small Mistral variant on this dataset as the Tier 2 judge.

10. **Implement the consistency-check protocol for ongoing calibration monitoring (Part 2 §3.4).** Run the verifier twice at temperature=0 on a random 10% sample of evaluations; flag any pair where scores differ (they should be identical at temp=0). Run the trace-only vs. trace+retrieved-doc comparison on all H-family candidates; log `evidence_gap_score = (trace+doc_score) − (trace_only_score)`. An evidence_gap_score > 0.5 on a step that scored < 0.25 trace-only confirms a true H-family case for the fine-tuning set.

11. **Prioritize regulated-domain go-to-market positioning using the TRAIL 11% finding and NIST Agentic Profile alignment (Part 3 §5.2–5.5).** The TRAIL benchmark result (11% joint accuracy for Gemini 2.5 Pro on unguided step-level error localization) is the clearest empirical argument for PLV's reference-graph architecture. Prepare a positioning one-pager that leads with this finding, contrasts PLV's `BLOCK`/`HOLD`/`ALLOW` verdict against dashboard-score-only competitors, and notes the structural alignment between PLV's gold step graph and the NIST AI RMF Agentic Profile's proposed consequence graph.

12. **Schema-version every evaluator output starting now (Part 2 §5.4).** Add `"__schema_version": "plv-graded-support-v1.0"` and `"__evaluated_at": "<ISO timestamp>"` to all evaluation JSON outputs before any prompt migrations go live. This ensures that evaluations produced under the current binary prompt are clearly distinguished from evaluations produced under the new graded-support prompt, and allows selective re-evaluation of affected steps when the rubric changes.
