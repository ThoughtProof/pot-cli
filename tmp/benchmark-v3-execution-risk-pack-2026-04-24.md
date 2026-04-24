# Benchmark v3 execution risk pack — 2026-04-24

## Goal
Define the next benchmark surface after:
- `v0` baseline / safety core
- `v1` retrieval-boundary
- `v2` broken dependency chain / global structure

`v3` should open a new dimension:
**action / consequence / execution risk**.

This surface is not primarily about whether an answer is factually correct or structurally complete.
It is about whether a plan, recommendation, or next action is **operationally dangerous** even when the reasoning chain may look superficially plausible.

## Why this is the right next surface
The benchmark progression becomes:
- **v0** → baseline correctness + conservative safety
- **v1** → evidence / retrieval boundary
- **v2** → dependency chain / global structural defensibility
- **v3** → actionability / consequence / execution risk

This gives a clean escalation:
**facts -> evidence -> structure -> consequences**

## What v3 should test
v3 should capture cases where:
- the answer or plan appears coherent
- but execution would create real-world danger
- or an irreversible/externally risky action is recommended without the safeguards needed to make it defensible

## Proposed first family
Suggested family name:
- `v3_execution_risk_surface`

Suggested first slice size:
- **4 to 6 cases**

## Proposed subtypes

### V3-A01 — unsafe action despite plausible reasoning
The chain seems sensible, but the recommended action would create material real-world risk.

### V3-A02 — missing irreversible-action check
A plan recommends an irreversible or high-impact action without the final verification step required before execution.

### V3-A03 — tool/output trust overreach
A tool result is treated as sufficient to justify action even though the output should have remained advisory or provisional.

### V3-A04 — human-oversight bypass
The chain skips a necessary human approval / domain-expert checkpoint before action.

### V3-A05 — low-probability high-impact risk ignored
The plan looks locally reasonable but fails to account for a tail-risk that should block or at least hold execution.

### V3-A06 — unsafe recommendation under uncertainty
The answer gives an execution recommendation as if uncertainty were already resolved.

## Recommended first slice
To mirror the compact shape that worked well today, start with **4 cases**:
- `V3-A01` unsafe action despite plausible reasoning
- `V3-A02` missing irreversible-action check
- `V3-A03` tool/output trust overreach
- `V3-A04` human-oversight bypass

## Design constraints
- Keep v3 distinct from v2: the issue should be **execution danger**, not merely global support structure.
- Prefer cases where harm comes from acting, not just from being epistemically messy.
- Keep the action/risk concrete enough that annotator steps can express what safeguard was skipped.
- Use cases where a system could sound competent while still being operationally unsafe.

## Practical next step
Create the machine-readable v3 draft with:
- `id`
- `expectedVerdict`
- `taskPrompt`
- `failureMode`
- `whyThisCaseExists`
- `isolatedBoundary`
- `referenceStepIntent`

That should follow the same workflow used for v1 and v2.
