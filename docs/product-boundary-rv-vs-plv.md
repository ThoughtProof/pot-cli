# Product Boundary: PoT/RV vs PLV

Status: working boundary, 2026-05-06
Owner: ThoughtProof

## Why this exists

The repo currently mixes two related but different products:

1. **PoT/RV — classic Proof-of-Thought / Reasoning Verification**
2. **PLV — Plan-Level Verification**

This has caused communication and implementation errors, especially around SERV Reasoning. From now on, every experiment, API route, benchmark, and result must explicitly identify which product it belongs to.

## Hard rules

Before any SERV/OpenServ note or experiment:

- If the input is `claim + rationale + evidence/context`, it is **PoT/RV**.
- If the input is `plan_steps + trace/final action`, it is **PLV**.
- Never report PoT/RV outputs as PLV metrics.
- Never call `/v2/verify` a PoT/RV run; API v2 is PLV/trace-oriented.
- Daniel/OpenServ's reply permits private, synthetic, functional SERV testing for both PoT/RV and the later Sentinel/PLV-adjacent track, as long as it stays private and non-public. Label each run by product: SERV PoT/RV or SERV PLV. Do not publish SERV-related artifacts, model outputs, screenshots, metrics, or benchmark-style claims without explicit written approval.

## Product 1: PoT/RV — Reasoning Verification

### Product question

Is this reasoning defensible from the provided context/evidence?

### Input shape

```json
{
  "claim": "The invoice can be approved for payment.",
  "rationale": "The invoice amount matches the purchase order and the vendor is approved.",
  "evidence": "PO amount equals invoice amount. Vendor registry approved. No sanctions-screening record provided."
}
```

### Verification object

- Claim
- Rationale / reasoning
- Evidence / context

### Output shape

```json
{
  "verdict": "ALLOW|UNCERTAIN|BLOCK",
  "confidence": 0.0,
  "rationale": "Why the reasoning is or is not defensible",
  "dissent": [],
  "evidence_gaps": [],
  "risk_flags": []
}
```

### Verdict policy

- `ALLOW`: the stated claim is adequately supported and scoped by the rationale/evidence.
- `UNCERTAIN`: evidence is incomplete, important controls are missing, or the claim may be true but is not fully defensible from the record.
- `BLOCK`: the claim contradicts the evidence, dismisses a critical risk, or materially overclaims beyond the evidence.

### Examples

- `ALLOW`: “The model showed promising performance on this internal synthetic benchmark, but is not yet validated for regulated deployment.”
- `UNCERTAIN`: “The invoice can be approved” when amount/vendor evidence exists but sanctions/duplicate checks are missing.
- `BLOCK`: “The invoice can be approved” while dismissing a confirmed unresolved sanctions hit.

### Current code status

PoT/RV currently exists mostly as:

- original `pot-cli ask`, `deep`, `review`, `audit`, `debug` adversarial pipeline
- ad hoc SERV experiment scripts under `runs/serv-pot-rv-*`

It does **not** currently have a clean dedicated source module or API surface.

### SERV PoT/RV track

The current `serv-pot-rv-*` artifacts belong to **PoT/RV**. Daniel/OpenServ's reply also permits private, synthetic, functional SERV testing in the later PLV/Sentinel-adjacent track, but those runs must be labeled separately as SERV PLV and kept private.

Current SERV PoT/RV smoke artifacts are local-private and ignored by git:

- `experiments/serv-private/rv/serv-pot-rv-runner.mjs`
- `experiments/serv-private/rv/serv-pot-rv-smoke-8cases.json`
- `experiments/serv-private/rv/serv-pot-rv-smoke-8cases-results-2026-05-06b.json`
- `experiments/serv-private/rv/serv-pot-rv-test-clarification-2026-05-06.md`

These are claim/rationale/evidence tests. They are not PLV. Do not commit them or publish their outputs without explicit written approval.

## Product 2: PLV — Plan-Level Verification

### Product question

Does the agent output/action faithfully follow a supported plan or execution trace?

### Input shape

```json
{
  "question": "What should the agent do?",
  "answer": "The final answer or action",
  "trace": "Agent trace / execution trace",
  "plan_steps": [
    {
      "index": 0,
      "description": "Verify sanctions-screening status",
      "criticality": "critical",
      "acceptance_criterion": "Trace must show sanctions screening was checked and clear"
    }
  ]
}
```

### Verification object

- Goal/question
- Final answer/action
- Agent trace
- Gold/expected plan steps or acceptance criteria

### Output shape

```json
{
  "verdict": "ALLOW|UNCERTAIN|BLOCK",
  "confidence": 0.0,
  "steps": [
    {
      "index": 0,
      "score": 0.0,
      "predicate": "supported|unsupported|contradicted"
    }
  ],
  "objections": []
}
```

### Modes

- `support`: Are plan steps supported by the trace/evidence?
- `faithfulness`: Does the final answer/action follow from the reasoning/trace?

### Current code status

PLV is the active `src/plan/*` family:

- `src/plan/graded-support-evaluator.ts`
- `src/plan/cross-model-cascade.ts`
- `src/plan/policy.ts`
- `src/plan/tier1-prefilter.ts`
- `src/commands/plan-*`
- `docs/plan-level-cli-workflow.md`
- `docs/tier-selection.md`

API v2 (`verify.thoughtproof.ai/v2/verify`) is PLV/trace-oriented.

## Shared core allowed between products

The products may share implementation primitives, but not schemas or product language.

Allowed shared modules:

- model router
- provider clients
- verdict mapper
- receipts / attestations
- billing/auth
- logging/telemetry
- common `ALLOW|UNCERTAIN|BLOCK` public contract

Not shared without an explicit adapter:

- input schemas
- benchmark datasets
- prompt templates
- gold labels
- evaluation metrics
- public claims

## Naming rules

### Use `rv` for PoT/RV

Examples:

- `src/rv/*`
- `docs/rv-*`
- `runs/rv-*`
- `cases/rv-*`
- `reasoning_verification`
- `claim_rationale_evidence`

### Use `plv` or `plan` for PLV

Examples:

- `src/plan/*` — existing code
- `docs/plv-*`
- `runs/plv-*`
- `cases/plv-*`
- `plan_level_verification`
- `trace_faithfulness`

### Avoid ambiguous wording

Do not say “verification pipeline” without product qualifier.

Use:

- “PoT/RV pipeline”
- “PLV pipeline”
- “SERV PoT/RV critic experiment”
- “PLV 120-case benchmark”

## SERV privacy and communication rule

SERV/OpenServ beta material is private by default.

Do not commit or publish SERV-related:

- model outputs;
- screenshots;
- access links;
- API keys or secrets;
- metrics or benchmark-style claims;
- public comparisons against other models;
- customer data or sensitive data.

When discussing a SERV run internally or with Daniel, label the product explicitly:

```text
SERV PoT/RV: claim + rationale + evidence/context.
SERV PLV: plan_steps + trace/final action.
```

Safe external/private wording:

```text
This was a private, synthetic, functional SERV PoT/RV run. It used claim + rationale + evidence/context and is not a public benchmark.
```

or:

```text
This was a private, synthetic, functional SERV PLV run. It used plan/trace inputs and is not a public benchmark.
```

Avoid:

```text
SERV production verifier
SERV replacing Sonnet
public SERV benchmark
```

unless explicitly approved and technically true.

## Repository problem statement

Current repo state is confusing because:

- package name `pot-cli` implies PoT/RV
- README foregrounds original Proof-of-Thought adversarial pipeline
- active benchmark and API integration work is largely PLV
- plan-level code lives in `src/plan/*` but package exports expose it as `pot-cli/plan`
- SERV PoT/RV experiments were placed under `runs/`, next to PLV benchmark runs; they are now local-private under ignored `experiments/serv-private/rv/`

## Migration plan

### Phase 0 — now: label boundaries

- Keep existing code running.
- Add this document.
- Add a short README warning that PoT/RV and PLV are separate.
- Prefix new SERV PoT/RV artifacts with `rv-` or `serv-pot-rv-` only.
- Do not publish SERV PoT/RV results as PLV results.

### Phase 1 — source separation

Create:

```text
src/rv/
  types.ts
  policy.ts
  serv-critic-runner.ts
  prompts.ts

src/plv/
  README.md
```

Move or alias plan-level public exports behind PLV naming while preserving existing `pot-cli/plan` compatibility.

### Phase 2 — package exports

Add explicit package exports:

```json
{
  "./rv": "./dist/rv/index.js",
  "./plv": "./dist/plan/graded-support-evaluator.js",
  "./plan": "./dist/plan/graded-support-evaluator.js"
}
```

`./plan` stays for backwards compatibility. New code should import `pot-cli/plv` or `pot-cli/rv`.

### Phase 3 — API separation

Keep current v2 route as PLV:

```text
/v2/verify -> PLV / trace verifier
```

Add a separate RV route only when implemented:

```text
/rv/verify or /v1/reasoning/verify -> claim/rationale/evidence verifier
```

Do not overload `/v2/verify` with PoT/RV claim/rationale/evidence objects.

## Immediate next actions

1. Update README with a short “Product boundary” section linking here.
2. Keep SERV PoT/RV scripts and outputs under ignored `experiments/serv-private/rv/` until sanitized/public release is explicitly approved. If a non-SERV RV experiment becomes publishable, use `experiments/rv/` or `src/rv/` depending on whether it remains experimental.
3. Create `src/rv/types.ts` with explicit `ReasoningVerificationInput` and `ReasoningVerificationResult` types before running more SERV tests.
4. Create a small RV gold-policy file before collecting more metrics.
5. Only after that, run the next private SERV PoT/RV batch.
