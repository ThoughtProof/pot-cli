# ADR-0001: Canonical Verdict Model

**Status:** Accepted
**Date:** 2026-04-27
**Deciders:** Raul, Paul, Hermes
**Editor:** Computer
**Supersedes:** prior implicit divergence between `pot-cli/verdict-mapper.ts` and `Pot-sdk/verify.ts`

---

## Context

ThoughtProof's verdict model existed in three different shapes across the
ecosystem before this ADR:

| Repo | Internal Set | HOLD-mapping | DISSENT-mapping |
|---|---|---|---|
| `pot-cli/verdict-mapper.ts` | 5-tier (declared since v0.8.1, unused until PR-E) | HOLD → UNCERTAIN | not yet emitted |
| `Pot-sdk` v2.1 | 4-tier (no CONDITIONAL_ALLOW) | HOLD → BLOCK | DISSENT → BLOCK |
| `pot-cli/graded-support-evaluator.ts` (pre PR-E) | 3-tier (ALLOW/HOLD/BLOCK) | via mapper | not emitted |
| `shadow-mode-sdk` | 3-tier consumer only | passthrough | passthrough |

The same internal token (`HOLD`) carried different downstream semantics
depending on which SDK a consumer used. Confusion-matrix metrics computed on
pot-cli's HOLD→UNCERTAIN basis are not interpretable by Pot-sdk consumers
because they see HOLD-derived cases as BLOCK.

This ADR fixes the mapping across all three repos.

## Decision

**Canonical internal verdict model is the 5-tier set defined in
`pot-cli/verdict-mapper.ts`.** All other repos must converge on this model
or its public 3-tier projection.

### Internal verdicts (engine / CLI)

```
ALLOW              — all critical steps pass, no weaknesses
CONDITIONAL_ALLOW  — all critical steps pass, ≥1 non-critical weakness exists
HOLD               — moderate concerns, insufficient evidence, needs review
DISSENT            — evaluators do not converge (multi-model split)
BLOCK              — critical step(s) unsupported (≥2 unsupported = failScore ≥ 2.0)
```

### Public verdicts (API / SDK)

```
ALLOW       — verified, proceed
UNCERTAIN   — cannot determine, human review or policy decision required
BLOCK       — definitively rejected
```

### Mapping table

| Internal | Public | Metadata |
|---|---|---|
| `ALLOW` | `ALLOW` | — |
| `CONDITIONAL_ALLOW` | `ALLOW` | `conditions: string[]` |
| `HOLD` | `UNCERTAIN` | `review_needed: true` |
| `DISSENT` | `UNCERTAIN` | `dissent: true` |
| `BLOCK` | `BLOCK` | — |

`schema_version: 'v2'` is set on every public response.

`severity_score` is non-null only for `BLOCK` verdicts. `ALLOW`,
`UNCERTAIN` (whether HOLD- or DISSENT-derived), and the metadata-tagged
ALLOW (CONDITIONAL_ALLOW) all return `severity_score: null`.

## Rationale

### Why HOLD → UNCERTAIN (not BLOCK)

HOLD is an **epistemic** state: "we have moderate concerns, but we lack
sufficient evidence to either approve or definitively reject." The honest
public projection of that state is `UNCERTAIN`.

Mapping HOLD to BLOCK (as Pot-sdk v2.1 does today) is a severity inversion:
it presents API consumers a "rejected" verdict for cases that semantically
mean "unclear, please review." This is a false-negative generator —
it loses information that consumers would use to escalate to human review.

### Why DISSENT → UNCERTAIN (not BLOCK)

DISSENT means "evaluators do not converge" — a **consensus signal**, not a
defect signal. Three reasons for the UNCERTAIN mapping:

1. **Semantic honesty.** UNCERTAIN = "no consensus reached" is literally
   what DISSENT means. BLOCK overstates what we know.

2. **No single-model veto.** If DISSENT → BLOCK, a single contrarian model
   can override a majority of approvers. That undermines the multi-model
   principle PLV is built on. The aggregator becomes a 3-model pipeline
   that behaves like a 1-model conservative-mode system.

3. **Consumer sovereignty / asymmetric correctability.** A consumer who
   wants to treat dissent as a hard block can do so via policy on the
   `dissent: true` metadata field. The reverse (downgrading a BLOCK to
   ALLOW in consumer code) requires actively overriding a vendor safety
   signal, which is much harder to justify and audit. Defaults should be
   the more correctable variant.

Consumer-side recommendation (non-normative): safety-critical consumers
(medical dosing, financial-risk gating, etc.) **SHOULD** treat
`dissent: true` as BLOCK in their policy layer.

### Why CONDITIONAL_ALLOW exists

Cases where every critical step is supported but a non-critical
(supporting/optional) step is weakly evidenced are common in our 40-case
benchmark (e.g., C-08 R7 cross-step, GAIA cases with one weak step).
Collapsing these to either pure `ALLOW` (loses the weakness signal) or
`HOLD` (overstates the concern, blocks proceed) loses information. The
public mapping `ALLOW + conditions[]` carries the signal as metadata
without changing the gate behavior.

`CONDITIONAL_ALLOW` is emitted only when:

- All critical steps pass (no `unsupported` / `skipped` / `unfaithful`
  predicates on critical steps, no critical-partial weight that pushes
  failScore ≥ 0.5).
- At least one non-critical step has score in the open interval
  `(0, 0.75)`. Score `0` is absence (not weakness). Score `≥ 0.75` is
  strong (no weakness to flag).

## Consequences

### Required changes

| Repo | Change | PR |
|---|---|---|
| `pot-cli` | InternalVerdict type incl. CONDITIONAL_ALLOW; `deriveVerdict()` emits CA + conditions; `provenance-sweep` uses `collapseVerdict()` for confusion matrix | PR-E (#12, in flight) |
| `Pot-sdk` | `mapVerdict()` HOLD → UNCERTAIN (was BLOCK); `severity_score` returns null for HOLD; CONDITIONAL_ALLOW support; CHANGELOG with migration notes | PR-G1 + PR-G2 |
| `shadow-mode-sdk` | No code change required (already 3-tier consumer); doc update referencing this ADR | docs PR |
| `pot-benchmarks` | Verify `expected_verdict` cases are 3-tier (no internal-tier values); update if any leakage | review-only |

### Versioning

Pot-sdk's HOLD→UNCERTAIN fix is a public-API behavior change. It requires
a major version bump. Convention in this project: next major after
current `2.x` is `3.0.0`.

(The terms "v0.3.0" / "v0.3.0 breaking" used in earlier discussions refer
to a working name. Final tag is `pot-sdk@3.0.0`.)

### Compatibility

Consumers branching on `verdict === 'BLOCK'` to handle "human review
needed" cases will see those cases as `UNCERTAIN` after PR-G1. Migration
snippet in the PR-G1 CHANGELOG.

Consumers reading `severity_score` for HOLD-derived verdicts will see
`null` after PR-G1 (was 0.30–0.65). If granular severity data is needed,
use the internal trace fields (only available with `THOUGHTPROOF_INTERNAL=1`).

### Future-proofing

`verdict-mapper.ts` uses an exhaustiveness check (`const _exhaustive: never`)
in its switch statement. Any new `InternalVerdict` value added without
updating the mapper will fail TypeScript compilation. This guarantees the
mapping table cannot drift silently.

## Alternatives Considered

### Alt 1: HOLD → BLOCK (Pot-sdk v2.1 status quo)
Rejected. Severity inversion, false-negative generator. Explained above.

### Alt 2: DISSENT → BLOCK (initial proposal in Hermes briefing)
Rejected. Single-model veto problem, undermines multi-model aggregation,
asymmetric correctability favors UNCERTAIN.

### Alt 3: 4-tier internal (drop CONDITIONAL_ALLOW)
Considered. Aligns with current Pot-sdk v2.1 internal model. Rejected
because it loses the non-critical-weakness signal, which is observable in
our benchmark cases and useful for downstream policy decisions.

### Alt 4: 6-tier internal (CONDITIONAL_ALLOW + CONDITIONAL_BLOCK)
Considered. CONDITIONAL_BLOCK would mean "block but with caveats showing
why it might still be acceptable." Rejected as scope creep without a
demonstrated benchmark need. Can be revisited if 40-case run surfaces
cases that fit the pattern.

## References

- `pot-cli/src/verdict-mapper.ts` — implementation, single source of truth
- `pot-cli/src/plan/graded-support-evaluator.ts` — `deriveVerdict()` emits internal
- `verdict_model_alignment_briefing.md` (Raul, 2026-04-26) — initial diagnosis
- `pr_g_pot_sdk_patch_plan.md` (Raul, 2026-04-27) — Pot-sdk migration plan
- PR #12 (`pot-cli`) — PR-E, 5-tier evaluator + CONDITIONAL_ALLOW
- PR-G1 / PR-G2 (`Pot-sdk`) — pending, Pot-sdk alignment

## Decision Log

- 2026-04-25: Initial 5-tier internal model documented in
  `pot-cli/verdict-mapper.ts` as `@since v0.8.1`. Engine still emits
  3-tier; mapper is dormant.
- 2026-04-26: Cross-repo divergence diagnosed (verdict_model_alignment_briefing.md).
- 2026-04-26: Paul + Hermes confirm 5-tier internal, HOLD → UNCERTAIN,
  rule-based deterministic aggregator.
- 2026-04-27: PR-E (#12) implements 5-tier emission with CONDITIONAL_ALLOW.
- 2026-04-27: DISSENT → UNCERTAIN ratified (single-model-veto argument).
- 2026-04-27: This ADR drafted to lock the canonical model across repos.
