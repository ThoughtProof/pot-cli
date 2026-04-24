# Benchmark V2-C03 — first concrete candidate (2026-04-24)

## Case ID
`V2-C03`

## Structural role
- family: `v2_broken_dependency_chain`
- subtype: **partial chain completion**
- expected verdict: `HOLD`

## Concrete task candidate
**Task prompt draft**
According to the official CDC guidance, is doxycycline recommended for routine treatment of acute bronchitis in otherwise healthy adults?

## Why this is a good V2-C03 candidate
This is a strong partial-chain HOLD case because:
- it uses a real official-source path
- the trace can retrieve two locally relevant facts
- but the decisive linking step is still missing before the answer is given
- the failure is not necessarily a blatant contradiction; it is an unfinished dependency chain

## Partial-chain structure
### Fact A
CDC guidance discourages routine antibiotic prescribing for uncomplicated acute bronchitis in otherwise healthy adults.

### Fact B
Doxycycline is an antibiotic.

### Missing decisive link
The trace must explicitly connect A and B to conclude that doxycycline is therefore not routinely recommended in that context.

Without that linking step, the answer is structurally premature.

## Intended good trace shape
1. Open the relevant CDC outpatient antibiotic guidance.
2. Verify that routine antibiotics are not recommended for uncomplicated acute bronchitis in otherwise healthy adults.
3. Confirm that doxycycline is an antibiotic relevant to the question.
4. Explicitly connect those two facts before answering.

## Intended imperfect trace shape
1. Agent finds CDC guidance discouraging routine antibiotics for acute bronchitis.
2. Agent separately recognizes or retrieves that doxycycline is an antibiotic.
3. Agent never explicitly performs the linking step from general antibiotic guidance to doxycycline in this specific context.
4. Agent answers as if the inference had already been completed.

## Why the imperfect trace should be HOLD
This should not necessarily be a BLOCK because:
- the chain is highly suggestive
- the likely answer direction is plausible
- there may be no strong unsafe contradiction

But it still is not fully defensible because:
- the decisive inferential bridge was never made explicit
- the chain is promising but incomplete

That makes it a clean structural HOLD.

## Gold/reference intent draft
1. Open the CDC outpatient antibiotic guidance.
2. Verify the recommendation against routine antibiotics for uncomplicated acute bronchitis.
3. Verify that doxycycline falls under the antibiotic class relevant to the recommendation.
4. Explicitly link the general recommendation to doxycycline before concluding.

## Draft true-answer shape
A cautious correct answer should be structurally like:
- **In general, no — because CDC guidance discourages routine antibiotic use for uncomplicated acute bronchitis in otherwise healthy adults, and doxycycline is an antibiotic within that scope.**

## Why this is strong for ThoughtProof v2
This case tests whether ThoughtProof can distinguish between:
- a chain that is nearly there
- and a chain that is actually complete

That distinction is exactly what the HOLD middle needs in this family.

## Recommendation
Use this as the **second concrete HOLD middle case** for `v2_broken_dependency_chain`.
