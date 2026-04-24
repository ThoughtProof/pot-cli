# PLV Q3 Comparable Systems

**Report date:** April 24, 2026  
**Prepared for:** ThoughtProof internal strategy  
**Subject:** Systems comparable to Plan-Level Verification (PLV) — production tools, open-source frameworks, and academic work

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

## Executive Summary

After surveying 17 production/open-source frameworks and 16 academic papers, no system does all three things PLV does. The closest analogues cluster in two groups:

**Closest production systems:**
1. **LangSmith `agentevals` trajectory match** — supports strict/unordered/subset/superset modes against a reference trajectory, returns boolean pass/fail per evaluator. Closest production tool to PLV's reference-graph comparison, but the reference is a flat message list, not a graph; no categorical predicates; no BLOCK/HOLD/ALLOW.
2. **TruLens GPA (Snowflake)** — Goal-Plan-Action framework with span-level scorers; identifies 95% of human-labeled errors on the TRAIL benchmark. No formal reference graph; scoring is continuous, not categorical.
3. **DeepEval `PlanAdherenceMetric`** — LLM-as-judge against a textual plan per step. Most sophisticated commercial analogue but uses free-text plan, not a graph; no binary verdict.

**Closest academic work:**
1. **ReCEval (EMNLP 2023)** — per-step correctness via NLI + V-Information; min-aggregation (weakest step determines chain quality). No reference plan; no actionable verdict.
2. **LLM-Modulo + VAL (Kambhampati 2024)** — architectural parallel: external model-based verifier (VAL) checks LLM plan step-by-step against PDDL domain model. The most structurally similar framework to PLV, but domain-restricted to classical planning.
3. **FActScore (EMNLP 2023)** — atomic fact → supported/not-supported predicate model directly parallels PLV's support predicates, applied at claim level rather than reasoning step level.

**Key whitespace:** No production system combines (a) a formal reference graph, (b) categorical per-step predicates, and (c) a policy-gated verdict that determines execution fate. Most tools use LLM-as-judge scoring on a continuous scale with no enforcement mechanism. The gap is largest in regulated domains (legal, healthcare, finance) where a `BLOCK` that prevents agent action has direct liability value.

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

## References

1. Langfuse agent observability blog — https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse
2. LangSmith trajectory evaluation documentation — https://docs.langchain.com/langsmith/trajectory-evals
3. Braintrust AI agent evaluation framework — https://www.braintrust.dev/articles/ai-agent-evaluation-framework
4. Arize Phoenix LLM evaluators — https://arize.com/docs/phoenix/evaluation/server-evals/llm-evaluators
5. Galileo agent evaluation blog — https://galileo.ai/blog/ai-agent-evaluation
6. Patronus AI TRAIL benchmark — https://arxiv.org/abs/2505.08638
7. Patronus AI TRAIL GitHub — https://github.com/patronus-ai/trail-benchmark
8. Patronus FinanceBench docs — https://docs.patronus.ai/docs/research_and_differentiators/financebench
9. DeepEval agent evaluation metrics — https://deepeval.com/guides/guides-ai-agent-evaluation-metrics
10. TruLens documentation — https://www.trulens.org
11. MLflow + TruLens evaluation blog — https://mlflow.org/blog/mlflow-trulens-evaluation
12. W&B Agents — https://wandb.ai/site/agents/
13. HoneyHive — https://www.honeyhive.ai
14. Humanloop evaluators documentation — https://humanloop.com/docs/explanation/evaluators
15. Humanloop agent eval quickstart — https://humanloop.com/docs/quickstart/agent-evals-in-ui
16. ROSCOE (Golovneva et al., Meta AI 2022) — https://arxiv.org/abs/2212.07919
17. ReCEval (Prasad et al., EMNLP 2023) — https://arxiv.org/abs/2304.10703
18. FActScore (Min et al., EMNLP 2023) — https://arxiv.org/abs/2305.14251
19. CoVe / Chain-of-Verification (Dhuliawala et al., Meta AI 2024) — https://arxiv.org/abs/2309.11495
20. "Let's Verify Step by Step" (Lightman et al., OpenAI, ICLR 2024) — https://arxiv.org/abs/2305.20050
21. Math-Shepherd (Wang et al., ACL 2024) — https://arxiv.org/abs/2312.08935
22. Uesato et al. process supervision (DeepMind, 2022) — https://arxiv.org/abs/2211.14275
23. LLM-Modulo (Kambhampati, 2024) — https://arxiv.org/abs/2402.01817
24. INVAL/VAL Plan Validator — https://github.com/patrikhaslum/INVAL
25. Reflexion (Shinn et al., NeurIPS 2023) — https://arxiv.org/abs/2303.11366
26. CRITIC (ICLR 2024) — https://arxiv.org/abs/2305.11738
27. Self-Refine (Madaan et al., NeurIPS 2023) — https://arxiv.org/abs/2303.17651
28. ReasonEval (2024) — https://arxiv.org/abs/2404.05692
29. Prometheus 2 (Kim et al., EMNLP 2024) — https://arxiv.org/abs/2405.01535
30. τ-bench (Yao et al., Sierra, ICLR 2025) — https://arxiv.org/abs/2406.12045
31. GAIA benchmark — https://hal.cs.princeton.edu/gaia
32. AgentBench (Liu et al., 2023) — https://arxiv.org/abs/2308.03688
33. Anthropic: Demystifying Evals for AI Agents — https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
34. OpenAI Evals GitHub — https://github.com/openai/evals
35. Salesforce Agentforce Testing Center — https://admin.salesforce.com/blog/2025/ensuring-ai-accuracy-5-steps-to-test-agentforce
36. Palantir AIP governance documentation — https://palantir.com/docs/foundry/aip/ethics-governance/
37. EU AI Act Article 15 — https://artificialintelligenceact.eu/article/15/
38. NIST AI RMF Agentic Profile (Cloud Security Alliance draft, 2025) — https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/
39. NIST AI 600-1 Generative AI Profile concept note — https://www.nist.gov/programs-projects/concept-note-ai-rmf-profile-trustworthy-ai-critical-infrastructure
