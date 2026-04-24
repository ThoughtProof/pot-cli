# PLV Calibration + Architecture Research
## Plan-Level Verification — Q1–Q5 Technical Brief

*Prepared for ThoughtProof engineering. All claims are cited to primary sources retrieved during this session.*

---

## Executive Summary

1. **The H-family calibration gap is a grounding problem, not a judgment problem.** Standard LLM judges conflate "evidence token appeared in context" with "evidence was extracted and applied." The fix is structural: decompose each step evaluation into (a) evidence extraction and (b) claim verification against that extracted evidence — the FActScore/RAGAS pattern ([Min et al., 2023](https://arxiv.org/abs/2305.14251); [Es et al., 2023](https://arxiv.org/abs/2309.15217)). Binary supported/unsupported is insufficient; the extractor must quote back the specific passage.

2. **The D-family problem is fundamentally different: it requires outcome-sensitive process verification.** Uesato et al. show that 14% of reasoning traces are wrong despite correct final answers, and this only drops to 3.4% under process supervision ([Uesato et al., 2022](https://arxiv.org/abs/2211.14275)). The D-family traces "went through the motions" — a binary support judge can't catch this without access to what the correct application *should have produced*. Gold steps need per-step acceptance criteria, not just criticality tags.

3. **LLMs are 10–52% accurate at finding reasoning errors without location hints.** [Tyen et al. (ACL Findings 2024)](https://aclanthology.org/2024.findings-acl.826) benchmarked GPT-4, GPT-3.5, PaLM 2, and Gemini on BIG-Bench Mistake. GPT-4 peaks at ~53% overall on step-level prompting. This is your plateau at 60% on full extractors — you are near the ceiling for single-pass LLM mistake-finding. The architecture must change.

4. **Graded 0–1 support with mandatory evidence quotation is the right abstraction.** G-Eval's probability-weighted scoring ([Liu et al., 2023](https://arxiv.org/abs/2303.16634)) and Prometheus 2's reference-guided rubric scoring ([Kim et al., 2024](https://arxiv.org/pdf/2405.01535)) demonstrate that token-probability-weighted continuous scores have higher human correlation than integer votes. A dual evaluator with agreement gate is empirically sound.

5. **The primary recommended architecture is FActScore-style extractor→verifier decomposition with G-Eval probability-weighted scoring, evidence citation enforcement via Pydantic/structured output, and Prometheus-2-8x7B as the primary judge.** This directly addresses both H-family (fails if quote is absent) and D-family (claim-level comparison against expected application, not just presence).

6. **Staged evaluation (Atla Selene Mini 8B screen → Prometheus-2-8x7B on ambiguous cases) hits the $0.05–$0.50/verification cost target.** Cascaded Selective Evaluation ([Jung et al., 2024](https://openreview.net/forum?id=UHPnqSTBPO)) guarantees >80% human agreement at ~80% test coverage using Mistral-7B — the same principle applies using Selene Mini (~$0.005/call) as the first tier.

7. **Majority vote failed for you because the underlying judges are all making the same structural error.** Ensemble diversity requires *architecturally different* scorers (e.g., NLI-based AlignScore + LLM-based Prometheus), not repeated identical prompts. JudgeLM-style bias analysis identifies position/format bias as the likely culprit in why sharpened prompts fix C-family but break H-family.

8. **You are solving the wrong problem in one specific way: gold step criticality tags alone are insufficient.** Each gold step should carry an explicit acceptance criterion — a testable predicate describing what "correctly applied" looks like. Without this, no judge can distinguish D-family from correct execution.

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

## References

| # | Citation | URL |
|---|----------|-----|
| 1 | Lightman et al. "Let's Verify Step by Step." OpenAI, ICLR 2024. | https://arxiv.org/abs/2305.20050 |
| 2 | Wang et al. "Math-Shepherd: Verify and Reinforce LLMs Step-by-Step." 2023. | https://arxiv.org/abs/2312.08935 |
| 3 | Golovneva et al. "ROSCOE: A Suite of Metrics for Scoring Step-by-Step Reasoning." ICLR 2023. | https://arxiv.org/abs/2212.07919 |
| 4 | Min et al. "FActScore: Fine-grained Atomic Evaluation of Factual Precision." EMNLP 2023. | https://arxiv.org/abs/2305.14251 |
| 5 | Es et al. "Ragas: Automated Evaluation of Retrieval Augmented Generation." 2023. | https://arxiv.org/abs/2309.15217 |
| 6 | Zha et al. "AlignScore: Evaluating Factual Consistency with a Unified Alignment Function." ACL 2023. | https://arxiv.org/abs/2305.16739 |
| 7 | Honovich et al. "TRUE: Re-evaluating Factual Consistency Evaluation." NAACL 2022. | https://arxiv.org/abs/2204.04991 |
| 8 | Liu et al. "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment." EMNLP 2023. | https://arxiv.org/abs/2303.16634 |
| 9 | Kim et al. "Prometheus: Inducing Fine-grained Evaluation Capability in Language Models." ICLR 2024. | https://arxiv.org/abs/2310.08491 |
| 10 | Kim et al. "Prometheus 2: An Open Source Language Model Specialized in Evaluating Other Language Models." EMNLP 2024. | https://arxiv.org/pdf/2405.01535 |
| 11 | Zhu et al. "JudgeLM: Fine-tuned Large Language Models are Scalable Judges." 2023. | https://arxiv.org/html/2310.17631v2 |
| 12 | Dhuliawala et al. "Chain-of-Verification Reduces Hallucination in Large Language Models." 2023. | https://arxiv.org/abs/2309.11495 |
| 13 | Uesato et al. "Solving Math Word Problems with Process- and Outcome-based Feedback." NeurIPS 2022. | https://arxiv.org/abs/2211.14275 |
| 14 | Lanham et al. "Measuring Faithfulness in Chain-of-Thought Reasoning." Anthropic, 2023. | https://arxiv.org/abs/2307.13702 |
| 15 | Turpin et al. "Language Models Don't Always Say What They Think." NeurIPS 2023. | https://arxiv.org/abs/2305.04388 |
| 16 | Tyen et al. "LLMs cannot find reasoning errors, but can correct them given the error location." ACL Findings 2024. | https://aclanthology.org/2024.findings-acl.826 |
| 17 | Kambhampati et al. "LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks." ICML 2024. | https://arxiv.org/abs/2402.01817 |
| 18 | Yao et al. "τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains." 2024. | https://arxiv.org/abs/2406.12045 |
| 19 | Ru et al. "RAGChecker: A Fine-grained Framework for Diagnosing Retrieval-Augmented Generation." 2024. | https://arxiv.org/abs/2408.08067 |
| 20 | Wang et al. (Meta AI) "Shepherd: A Critic for Language Model Generation." 2023. | https://arxiv.org/abs/2308.04592 |
| 21 | Gou et al. "CRITIC: Large Language Models Can Self-Correct with Tool-Interactive Critiquing." ICLR 2024. | https://arxiv.org/abs/2305.11738 |
| 22 | Alexandru et al. "Atla Selene Mini: A General Purpose Evaluation Model." 2025. | https://arxiv.org/abs/2501.17195 |
| 23 | Jung et al. "Trust or Escalate: LLM Judges with Provable Guarantees for Human Agreement." 2024. | https://openreview.net/forum?id=UHPnqSTBPO |
| 24 | ReasonEval. "Evaluating Mathematical Reasoning Beyond Accuracy." CMU/GAIR-NLP, 2025. | https://www.cs.cmu.edu/~sherryw/assets/pubs/2025-reasoneval.pdf |
| 25 | ReasonEval GitHub. | https://github.com/gair-nlp/reasoneval |
| 26 | Prometheus-eval GitHub. | https://github.com/prometheus-eval/prometheus-eval |
| 27 | PRM800K Dataset (OpenAI). | https://github.com/openai/prm800k |
| 28 | AlignScore GitHub. | https://github.com/yuh-zha/AlignScore |
| 29 | RAGChecker GitHub (Amazon Science). | https://github.com/amazon-science/RAGChecker |
| 30 | Shepherd GitHub (Meta AI Research). | https://github.com/facebookresearch/Shepherd |
| 31 | τ-bench GitHub (Sierra Research). | https://github.com/sierra-research/tau-bench |
