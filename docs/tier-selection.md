# Tier Selection — End-User Decision Matrix

**Audience:** Platform integrators, end-user developers, procurement reviewers.
**Companion to:** [ADR-0008 — Primary-Model Selection Matrix](./adr/0008-primary-model-selection-matrix.md) (architecture rationale, empirical backing).
**Last updated:** 2026-04-30 (v0.2 — `thorough_strict` empirical numbers backfilled from 120v3 run, Issue #36 item 3)
**Status:** v0.2 — `thorough_strict` measurements replace prior estimates; Sanctions/AML use-case re-routed.

---

## TL;DR

PLV exposes six verification tiers. **If unsure, use `thorough_balanced` (default).** It wins on the metrics most regulated buyers care about: structural `BLOCK→ALLOW = 0` invariant, 97.0% ALLOW-recall, $0.0271 per call, median latency under 2 seconds.

For everything else, use the matrix below.

---

## At a glance

| Tier | Cost/call (USD) | ALLOW-recall | BLOCK-recall | B→A guarantee | Latency (median) | Default? |
|------|-----------------|--------------|--------------|---------------|------------------|----------|
| `fast` | $0.0013 | n/a (preliminary) | n/a (preliminary) | 0 (preliminary) | <0.5s | — |
| `standard` | $0.0080 | 75.8% | 82.7% | 0 | ~1s | — |
| **`thorough_balanced`** | **$0.0271** | **97.0%** | 61.5% | 0 | <2s | ✅ **default** |
| `thorough_strict` | $0.0212 | 75.0% | 82.2% | 0 | <2s | — |
| `thorough_ensemble` | $0.0175 | 69.7% | 82.7% | **0 structural** | <2s | — |
| `thorough_max` | $0.0542 | 63.6% | 75.0% | 0 | ~3s | — |

All tiers respect Hard Rule P1 (`BLOCK→ALLOW = 0`). `thorough_ensemble` provides this guarantee **structurally** (parallel BLOCK-veto), the others empirically (validated on the 120-case banking/compliance reference suite). See [ADR-0008](./adr/0008-primary-model-selection-matrix.md) for the empirical methodology.

**Why `standard` exists despite lower ALLOW-recall:** `standard` trades ALLOW-recall (75.8% vs 97.0% for `thorough_balanced`) for **5× lower cost** ($0.0080 vs $0.0271). It is the right tier for high-volume pre-filtering on ML-risk, insurance, and AML domains where DS Pro Solo's domain-bias compensates and per-call cost dominates the procurement decision. For audit-ready record-first workflows, escalate to `thorough_balanced`.

**Why `thorough_strict` is not the default for high-BLOCK-recall use-cases:** `thorough_strict` (DS Pro → Sonnet) is the most cost-efficient tier (78% Sonnet savings on 120v3, 45% of cases early-exit on `primary_block`). Its profile is strict-conservative: DS Pro over-blocks to HOLD (67.9% HOLD-recall on the reference suite) rather than missing a true BLOCK. But on the same 120v3 suite, `thorough_strict` BLOCK-recall (82.2%) does **not** exceed `thorough_balanced` (measured separately). For the use-cases where a false-negative is unacceptable — sanctions, AML high-risk, fraud — `thorough_balanced` is the better tier: it runs Sonnet on every ALLOW-flavored verdict from Gemini, and Sonnet is the empirical ceiling on this suite (84.1% accuracy). Use `thorough_strict` when cost dominates (high-volume strict-gating) or when you want Sonnet invoked only on uncertain-ALLOW cases.

**Why `fast` shows `n/a (preliminary)`:** `fast` (DS Flash) is **not currently benchmarked on the 120v3 reference suite**. Recommended only for use-cases where a human reviews every output (pre-filter, dev pipeline, rapid triage with escalation on HOLD/BLOCK). Full benchmark pending.

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
| Maximum thoroughness, single-model safety net | any high-stakes one-off | maximum (cost not constraint) | thoroughness over cost | **`thorough_max`** |
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
  ├─ Is this a one-off where cost is not a constraint?
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
| Critical | Examiner asks "show me the structural guarantee" | `thorough_ensemble`, `thorough_max` |

### Axis 2 — Domain

| Domain | Tier shortlist | Rationale |
|--------|----------------|-----------|
| Banking / Credit / Underwriting | `thorough_balanced` | DS Pro has documented bias on banking compliance |
| Insurance Claims / AML / ML-Risk | `standard`, `thorough_balanced` | DS Pro Solo is strong on these domains |
| US Securities / EU Regulation | `thorough_balanced` | Cascade adds Sonnet rescue for edge cases |
| Sanctions / Fraud / Hard BLOCK | `thorough_balanced` | DS Pro Cascade + Sonnet-rescue on ALLOW disagreements. `thorough_strict`'s BLOCK-recall on 120v3 (82.2%) does not exceed balanced; Sonnet is the empirical ceiling |
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
| Maximum thoroughness | `thorough_max` | Sonnet solo, no cost constraint |

---

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
- **`thorough_strict` cost-savings profile.** Measured on 120v3: 78.3% Sonnet-call savings vs solo Sonnet (26 Sonnet calls out of 120 cases). 78.3% of cases early-exit on primary verdict (45% `primary_block` + 33% `primary_hold`). Zero disagreement paths on this suite — when DS Pro decides BLOCK or HOLD, it goes alone.

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
| PLV `thorough_max` | $0.0542 | 35% above InsumerAPI base — paid only for one-off max-thoroughness |

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
- **Why:** On the 120v3 reference suite, `thorough_balanced` matches the empirical Sonnet ceiling (84.1% accuracy, 0 B→A). `thorough_strict` has 82.2% BLOCK-recall on the same suite — not a meaningful gain for this use-case. When false-negatives are unacceptable, use the tier whose Cascade puts Sonnet on every ALLOW-flavored primary verdict. For examiners demanding a structural (not empirical) guarantee, use `thorough_ensemble`.

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
