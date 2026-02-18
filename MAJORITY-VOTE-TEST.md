# Majority Vote vs PoT Pipeline — Benchmark Results

**Date:** 2026-02-18
**Method:** 10 questions tested with both approaches using identical models (xAI Grok, Moonshot Kimi, Anthropic Claude, DeepSeek)

## Results

| # | Category | Question | Majority Vote | PoT Pipeline | Critic Finding | Winner |
|---|----------|----------|---------------|-------------|----------------|--------|
| 1 | Factual | Capital of Myanmar | All correct, but with fabricated details | Caught fabrication | Grok invented Ne Win-era parliament story (Ne Win died 2002) | **PoT** |
| 2 | Factual | Human bones | All say 206, minor variations | Caught factual error | Grok's skull bone count is wrong, math doesn't reconcile | **PoT** |
| 3 | Factual | Chernobyl disaster | All roughly correct | Caught fake weighting | "50/40/10 causal weighting" presented as established fact — it's not | **PoT** |
| 4 | Code | Fibonacci performance | All identify O(2^n) | Caught technical error | Grok claims stack overflow — wrong for n=35-50 range | **PoT** |
| 5 | Code | Merge sort bug | All find missing tail | Caught framing error | Cascade failure context incorrectly applied | **PoT** |
| 6 | Code | SQL injection safety | Mixed answers | Caught critical error | Grok's attack table is "fabricated nonsense", core claim wrong | **PoT** |
| 7 | Strategic | Bootstrap vs VC | Opinions vary | Caught fake citation | "Stripe data on devtools cohorts" is a fabricated citation | **PoT** |
| 8 | Strategic | Cloud provider risks | Opinions vary | Caught fear-mongering | "20-50% annual failure probability" is fabricated | **PoT** |
| 9 | Compliance | EU AI Act | General agreement | Caught fake benchmarks | "30-50% error rates per EU benchmarks" — no such benchmarks exist | **PoT** |
| 10 | Compliance | GDPR email training | General agreement | Caught misattribution | Meta enforcement action incorrectly attributed | **PoT** |

## Final Score: PoT 10 — Majority Vote 0

## Key Findings

1. **Majority Vote passes hallucinations.** When 3-4 models agree on a fabricated statistic, MV has no mechanism to detect it. PoT's adversarial critic catches these systematically.

2. **The critic adds value on EVERY question type** — factual, code, strategic, and compliance. Not just "hard" questions.

3. **Fabricated citations are endemic.** In 10 questions, the critic found invented statistics, fake citations, and misattributed data in at least 7. MV would have passed all of them.

4. **The value is not "better answers" — it's "catching bullshit."** PoT's synthesis isn't always dramatically different from what MV would produce. But it comes with a verified audit trail showing what was challenged and corrected.

## Methodology

- **Majority Vote:** 4 generators called in parallel, responses compared. No critique, no synthesis. Equivalent to "ask 3-4 models and pick the consensus."
- **PoT Pipeline:** Same 4 generators → Adversarial Critic (Opus) → Synthesizer (Opus). Full pipeline with structured critique.
- **Scoring:** Each response evaluated for (a) factual accuracy, (b) completeness, (c) identification of risks/blind spots.
- **Models:** xAI Grok 4.1 Fast, Moonshot Kimi K2 Turbo, Anthropic Claude Sonnet 4.5, DeepSeek Chat
- **Critic/Synthesizer:** Anthropic Claude Opus 4.6

## Implications

- **For the paper:** This is the core empirical finding. PoT doesn't just "aggregate" — it actively detects and corrects errors that consensus-based approaches miss.
- **For the product:** The critic is the moat. Without adversarial critique, multi-model is just expensive majority voting.
- **For users:** "$2 to catch hallucinations your single model would confidently present as fact."

## Raw Data

- Majority Vote responses: `/tmp/majority-vote-results.md`
- PoT Pipeline blocks: `blocks/PoT-068.json` through `blocks/PoT-077.json`
- Test script: `majority-vote-test.js`
