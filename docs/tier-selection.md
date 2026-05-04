# Tier Selection — End-User Decision Matrix

**Audience:** Platform integrators, end-user developers, procurement reviewers.
**Companion to:** [ADR-0008 — Primary-Model Selection Matrix](./adr/0008-primary-model-selection-matrix.md) (architecture rationale, empirical backing).
**Last updated:** 2026-05-04 (v0.4 — Track-2 n=3 stability refresh across fast/standard/balanced/max + offline ensemble simulation)
**Status:** v0.4 — n=3 measured accuracy, recall, P1 safety, and reproducibility metrics backfilled from `runs/track2-n3-aggregation-and-ensemble-2026-05-04.md`.

---

## TL;DR

PLV exposes six verification tiers. **If unsure, use `thorough_balanced` (default).** It wins on the metrics most regulated buyers care about: best measured n=3 accuracy (84.7%), `BLOCK→ALLOW = 0/360`, lowest measured oscillation (3.3% pairwise), 96.1% ALLOW-recall, $0.0271 per call, median latency under 2 seconds.

For everything else, use the matrix below.

---

## At a glance

| Tier | n | Cost/call (USD) | Accuracy (mean) | ALLOW-recall | BLOCK-recall | B→A observed | Latency (median) | Default? |
|------|---|-----------------|---------------------|--------------|--------------|--------------|------------------|----------|
| `fast` | 3 | $0.0013 | 78.6% | 91.2% | 73.1% | 1/360 | <0.5s | — |
| `standard` | 3 | $0.0080 | 77.8% | 75.5% | 84.0% | 0/360 | ~1s | — |
| **`thorough_balanced`** | **3** | **$0.0271** | **84.7%** | **96.1%** | 77.6% | **0/360** | <2s | ✅ **default** |
| `thorough_strict` | 1 | $0.0212 | 76.2% | 73.5% | 84.6% | 0/120 | <2s | — |
| `thorough_ensemble` | — | $0.0175 | =standard (offline†) | =standard | =standard | **0 structural** | <2s | — |
| `thorough_max` | 3 | $0.0542 | 82.5% | 97.1% | 75.0% | 1/360 | ~3s | — |

`*` `thorough_strict` is single-run/backfill (n=1); `thorough_ensemble` is offline-simulated (†). All other rows use Track-2 n=3 means over 120 cases per run. The `n` column shows how many independent runs back the numbers.

Across n=3 stability runs over 4 runtime tiers (**1440 case evaluations**), the `BLOCK→ALLOW` rate was measured at **0.14%** (2/1440); the cascade-architected default tier `thorough_balanced` recorded **0/360**. `thorough_ensemble` provides the B→A=0 guarantee **structurally** via parallel BLOCK-veto (by construction, not empirical), but is currently offline-simulated and output equals `standard` on the 120v3 suite (†).

† On this suite, DS Pro is always ≥ Gemini in strictness (0 cases where Gemini vetoes a DS-ALLOW). The structural guarantee holds but produces no accuracy differentiation from `standard`. A Gemini+Sonnet veto pair (documented complementary biases) would be the correct runtime implementation. See [ADR-0008](./adr/0008-primary-model-selection-matrix.md) for the empirical methodology.

**Why `standard` exists despite lower ALLOW-recall:** `standard` trades ALLOW-recall (75.5% vs 96.1% for `thorough_balanced`) for **5× lower cost** ($0.0080 vs $0.0271). It is the right tier for high-volume pre-filtering on ML-risk, insurance, and AML domains where DS Pro Solo's domain-bias compensates and per-call cost dominates the procurement decision. For audit-ready record-first workflows, escalate to `thorough_balanced`.

**Why `thorough_strict` is not the default for high-BLOCK-recall use-cases:** `thorough_strict` (DS Pro → Sonnet) has only a single full 120-case backfill so far: 76.2% accuracy, 0 B→A, 73.5% ALLOW-recall, 84.6% BLOCK-recall. That is promising for cost-efficient strict-gating, but it is not n=3-stability-validated yet. For use-cases where a false-negative is unacceptable — sanctions, AML high-risk, fraud — `thorough_balanced` remains the better default because it is n=3-validated and cascade-protected. Use `thorough_strict` when cost dominates or when a separate n=3 strict run has been accepted for the target domain.

**Why `thorough_ensemble` is an examiner profile, not the default:** The offline Gemini + DeepSeek-Pro BLOCK-veto simulation provides a structural P1 guarantee (B→A=0 by construction). However, on the 120v3 suite DS Pro is always ≥ Gemini in strictness, so the veto never fires and output equals `standard` (†). The structural guarantee remains valid for the audit story (if either model ever produces a BLOCK, output is BLOCK), but it does not improve accuracy over `standard` on the current suite. Recommend it when a procurement conversation explicitly values structural guarantee. Runtime runner remains pending.

**Why `thorough_max` is not a premium upgrade:** `thorough_max` is Sonnet solo: useful for research/inspection and one-off maximum-thoroughness review, but not safe-by-construction. In n=3 stability runs it recorded 1 BLOCK→ALLOW violation (1/360), while the cascade-protected default recorded 0/360. For autonomous gating, prefer cascade-protected tiers.

**Why `fast` remains triage-only despite good mean accuracy:** `fast` (DS Flash) now has n=3 stability data: 78.6% mean accuracy, 91.2% ALLOW-recall, 73.1% BLOCK-recall, but one observed `BLOCK→ALLOW` in 360 evaluations and the highest oscillation of the measured tiers (12.5% any-case). Recommended use remains pre-filter, dev pipeline, and rapid triage with escalation on HOLD/BLOCK or high-stakes outputs.

---

## Decision matrix — by use-case

This is the recommended way to select a tier. Three axes: **stakes**, **domain**, **operating mode**. Pick the row that matches your dominant use-case; if multiple match, escalate to the higher-stakes row.

| If your use-case is… | Domain emphasis | Stakes / Audit posture | Operating mode | → Recommended tier |
|----------------------|-----------------|------------------------|----------------|--------------------|
| Pre-filter / triage before human review | any | low (no record kept) | high-volume, low-latency | **`fast`** |
| High-volume compliance screening | ML-risk, insurance, AML | medium (logged, reviewable) | volume-cost dominates | **`standard`** |
| **General-purpose verification** | **any (default)** | **medium-high (audit-ready record)** | **balanced** | **`thorough_balanced`** ✅ |
| Banking / EU-reg / US-securities compliance | banking, EU-reg, US-sec | high (regulatory examination) | balanced | **`thorough_balanced`** |
| High-consequence BLOCK detection | sanctions, AML high-risk, fraud | critical (false-negative is unacceptable) | BLOCK-recall dominates | **`thorough_balanced`** |
| Strict-gating at scale (cost-dominated) | any | medium-high | cost/latency-efficient strict-gating | **`thorough_strict`** |
| Audit-compliance with structural guarantee required | regulated workflows demanding mathematical proof | critical (audit story) | structural B→A=0 dominates | **`thorough_ensemble`** |
| Research / inspection, single-model baseline | any high-stakes one-off | maximum (cost not constraint) | inspection over autonomous gating | **`thorough_max`** |
| Rapid first-pass with escalation | any | low → escalates on signal | tiered routing | **`fast` → escalate to thorough on HOLD/BLOCK** |

---

## Decision tree (compact)

For programmatic tier-selection or quick mental routing:

```text
START
  │
  ├─ Is this a pre-filter where humans review every output?
  │   YES → fast
  │   NO ↓
  │
  ├─ Does cost-per-call dominate (high-volume, ML-risk/insurance/AML)?
  │   YES → standard
  │   NO ↓
  │
  ├─ Is the domain banking, EU-reg, or US-securities?
  │   YES → thorough_balanced
  │   NO ↓
  │
  ├─ Is missing a true BLOCK unacceptable (sanctions, AML, fraud)?
  │   YES → thorough_balanced
  │   NO ↓
  │
  ├─ Does an examiner / auditor demand structural (not empirical) B→A=0 proof?
  │   YES → thorough_ensemble
  │   NO ↓
  │
  ├─ Is this a research/inspection one-off where single-model output is explicitly desired?
  │   YES → thorough_max
  │   NO ↓
  │
  └─ DEFAULT → thorough_balanced
```

---

## Three-axis cheat sheet

If you prefer to pick along axes rather than scenarios:

### Axis 1 — Stakes / Audit posture

| Stakes | Profile | Tier shortlist |
|--------|---------|----------------|
| Low | No persistent record needed | `fast` |
| Medium | Logged, periodically reviewed | `standard`, `thorough_balanced` |
| High | Audit-ready record per call | `thorough_balanced` |
| Critical | Examiner asks "show me the structural guarantee" | `thorough_ensemble`; `thorough_balanced` if accuracy/default matters |

### Axis 2 — Domain

| Domain | Tier shortlist | Rationale |
|--------|----------------|-----------|
| Banking / Credit / Underwriting | `thorough_balanced` | DS Pro has documented bias on banking compliance |
| Insurance Claims / AML / ML-Risk | `standard`, `thorough_balanced` | DS Pro Solo is strong on these domains |
| US Securities / EU Regulation | `thorough_balanced` | Cascade adds Sonnet rescue for edge cases |
| Sanctions / Fraud / Hard BLOCK | `thorough_balanced` | Cascade-protected, n=3 validated, and 0/360 B→A. `thorough_strict` has higher single-run BLOCK-recall (84.6%) but lacks n=3 stability evidence |
| Cybersecurity / Generic Agent-Decision | `thorough_balanced` | Default; no domain-specific bias claim |

### Axis 3 — Operating mode

| Mode | Tier shortlist | Rationale |
|------|----------------|-----------|
| Volume-cost dominates | `fast`, `standard` | $0.0013–$0.0080/call |
| Latency dominates (<1s) | `fast`, `standard` | Median latency well under cascade tiers |
| Balanced (most workloads) | `thorough_balanced` | Default — best ALLOW-recall, cascade early-exit ~63% |
| BLOCK-recall dominates | `thorough_balanced` | Sonnet-rescue catches primary ALLOW-flavor verdicts on BLOCK cases |
| Cost-efficient strict-gating | `thorough_strict` | 78% Sonnet savings, 45% `primary_block` early-exit on 120v3 |
| Structural guarantee dominates | `thorough_ensemble` | Mathematical B→A=0 from BLOCK-veto |
| Research / inspection | `thorough_max` | Sonnet solo baseline; not cascade-protected, not autonomous-gating default |

---

## Reproducibility (n=3 stability)

Measured over A/B/C runs on the 120v3 reference suite. "Any-osc" counts cases whose public verdict changed at least once across A/B/C. Pairwise flip-rate averages AB, AC, and BC.

| Tier | Any-osc cases | Any-osc rate | Pairwise mean flip-rate | Pairwise range | Pair counts AB/AC/BC |
|---|---:|---:|---:|---:|---:|
| `fast` | 15/120 | 12.5% | 8.3% | 6.7-10.0% | 8/10/12 |
| `standard` | 8/120 | 6.7% | 4.4% | 3.3-5.8% | 7/5/4 |
| **`thorough_balanced`** | **6/120** | **5.0%** | **3.3%** | **2.5-4.2%** | **5/4/3** |
| `thorough_max` | 7/120 | 5.8% | 3.9% | 3.3-4.2% | 4/5/5 |

`thorough_balanced` is therefore the reproducibility leader as well as the accuracy/safety default. This matters for MRM reviews: LLM-based verification needs repeatability evidence, not just point accuracy.

## Operator-controlled `max_tier`

Platform operators (those issuing API-keys to downstream apps) can cap the maximum tier per key. This is for cost control, not floor enforcement.

```json
{
  "key_config": {
    "max_tier": "thorough_balanced",
    "fallback_on_demand": "thorough_strict"
  },
  "request": {
    "tier": "standard"
  }
}
```

End-user requests select **at or below** `max_tier`. Requests above are rejected with `tier_above_max_tier` error and a hint at `fallback_on_demand` if configured.

Programmatic discovery: `GET /v2/verify/tiers` returns the available tiers, costs, and the operator's `max_tier` for the calling key.

---

## What this matrix does *not* tell you

- **Plan-authoring effort.** The dominant cost-of-onboarding is plan-authoring time (4–8 hours per domain plan), not compute. Tier selection optimises compute; plan-authoring is the gating cost. See ADR-0008 §Reviewer-Burden-Balance.
- **Model-provider risk.** Tiers depend on specific model providers (Gemini, Sonnet, DeepSeek). If a provider becomes unavailable, `thorough_balanced` and `thorough_max` remain. See ADR-0008 §Consequences / Positive #4.
- **`thorough_strict` validation status.** Measured on one full 120v3 backfill: 76.2% accuracy, 0 B→A, 73.5% ALLOW-recall, 84.6% BLOCK-recall. It is not yet part of the n=3 stability set, so treat it as cost-efficient strict-gating evidence rather than a default-tier replacement.

---

## Cost comparison (procurement reference)

For procurement reviewers comparing PLV against the most-cited Agent-Compliance vendor pricing:

| Vendor / Tier | Per-call (USD) | Notes |
|---------------|----------------|-------|
| InsumerAPI base | $0.04 | USDC-prepay $5–$99 tier, `POST /v1/attest` ([source](https://insumermodel.com/terms-of-service/)) |
| InsumerAPI volume ($500+ tier) | $0.02 | USDC-prepay |
| **PLV `thorough_balanced`** | **$0.0271** | **32% under InsumerAPI base** |
| PLV `standard` | $0.0080 | 5× cheaper than InsumerAPI base |
| PLV `fast` | $0.0013 | 31× cheaper than InsumerAPI base |
| PLV `thorough_max` | $0.0542 | 35% above InsumerAPI base — research/inspection only; single-model and not safe-by-construction |

PLV is per-call, not per-session. Works in micro-payment contexts. Partner sets the markup.

---

## Worked examples

### Example 1 — Regional US bank, AI-assisted credit underwriting

- **Domain:** banking / credit
- **Stakes:** high (SR 11-7, NIST AI RMF examination posture)
- **Mode:** balanced (per-decision verification, not high-volume)
- **→ Tier:** `thorough_balanced`
- **Why:** DS Pro's banking-compliance bias + Sonnet rescue for edge cases. 0 B→A on the reference suite. Default — examiner-defensible.

### Example 2 — Mid-market insurance carrier, claims triage

- **Domain:** insurance claims
- **Stakes:** medium-high (state-insurance-reg examination, bad-faith exposure)
- **Mode:** volume-aware (claims throughput matters)
- **→ Tier:** `standard` for routine claims; **`thorough_balanced` for denied claims and high-value lines**
- **Why:** DS Pro Solo is strong on insurance domain at $0.0080. Escalate denied/high-value to default for the audit-ready record.

### Example 3 — Sanctions screening on payment flow

- **Domain:** AML / sanctions
- **Stakes:** critical (false-negative = OFAC violation)
- **Mode:** BLOCK-recall dominates
- **→ Tier:** `thorough_balanced`
- **Why:** On the n=3 120v3 reference suite, `thorough_balanced` is the best measured runtime tier: 84.7% mean accuracy, 0/360 B→A, and the lowest measured oscillation. `thorough_strict` has higher single-run BLOCK-recall (84.6%) but is not n=3-stability-validated yet. When false-negatives are unacceptable, use the cascade-protected tier with repeatability evidence. For examiners demanding a structural (not empirical) guarantee, use `thorough_ensemble`, with the caveat that it is currently offline-simulated and lower-accuracy than `thorough_balanced`.

### Example 4 — Internal experimentation / dev pipeline

- **Domain:** any
- **Stakes:** low
- **Mode:** rapid iteration
- **→ Tier:** `fast` for prototyping; `thorough_balanced` for pre-prod validation
- **Why:** $0.0013/call is cheap enough to verify every CI run; switch to default before staging.

---

## See also

- [ADR-0008](./adr/0008-primary-model-selection-matrix.md) — Architecture rationale, empirical methodology, exclusion criteria
- [ADR-0001](./adr/0001-verdict-model.md) — Hard Rule P1 definition (`BLOCK→ALLOW = 0`)
- [ADR-0007](./adr/0007-cross-model-verification-DRAFT.md) — Cross-model cascade design
- Track-2 n=3 aggregation report: `runs/track2-n3-aggregation-and-ensemble-2026-05-04.md`
- Track-2 recall addendum: `runs/track2-n3-recall-addendum-2026-05-04.md`
