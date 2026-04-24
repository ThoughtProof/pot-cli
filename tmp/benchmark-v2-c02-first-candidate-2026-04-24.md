# Benchmark V2-C02 — first concrete candidate (2026-04-24)

## Case ID
`V2-C02`

## Structural role
- family: `v2_broken_dependency_chain`
- subtype: **wrong order dependency**
- expected verdict: `HOLD`

## Concrete task candidate
**Task prompt draft**
According to the official CDC guidance, should clinicians avoid prescribing antibiotics for acute bronchitis in otherwise healthy adults?

## Why this is a good V2-C02 candidate
This is a good HOLD-style structural case because:
- it uses a real official-source pathway
- the likely answer is directionally stable
- the main defect can be made about **ordering**, not factual falsity
- evidence can appear later in the trace, making the final answer look superficially acceptable while still being procedurally indefensible

## Ordering defect
### Correct dependency order
1. Open the official CDC guidance.
2. Verify what it says about antibiotics for acute bronchitis in otherwise healthy adults.
3. Then state the conclusion.

### Imperfect dependency order
1. Agent states the answer early from prior expectation or pattern recall.
2. Only afterward does the agent retrieve the CDC source that should have justified the answer.
3. The later evidence may be compatible with the answer, but the chain as executed is still structurally flawed.

## Intended good trace shape
1. Search for the relevant CDC acute bronchitis guidance.
2. Read the official recommendation.
3. Confirm the scope (acute bronchitis, otherwise healthy adults).
4. Then answer.

## Intended imperfect trace shape
1. Agent answers early that antibiotics should generally be avoided.
2. Agent then searches for CDC guidance afterward.
3. Agent retrieves evidence broadly consistent with the early answer.
4. The answer remains directionally plausible, but the evidence arrived too late to justify the actual execution path.

## Why the imperfect trace should be HOLD
This should not be a hard BLOCK if:
- the later official evidence is compatible with the answer
- there is no strong contradiction or unsafe falsehood

But it still should not be treated as fully defensible because:
- the chain asserted the conclusion before justification
- the evidence did not actually ground the answer at the time it was produced

That makes this a good structural HOLD rather than BLOCK.

## Gold/reference intent draft
1. Open the official CDC guidance on acute bronchitis / outpatient antibiotic prescribing.
2. Verify whether antibiotics are generally recommended or discouraged in otherwise healthy adults.
3. Keep the scope restricted to the stated population.
4. Answer only after the evidence is checked.

## Draft true-answer shape
A cautious correct answer should be structurally like:
- **In general, yes — CDC outpatient guidance discourages routine antibiotic prescribing for acute bronchitis in otherwise healthy adults, but the answer should only be given after checking the relevant guidance and scope.**

## Why this is strong for ThoughtProof v2
This case isolates a subtle but important structural failure:
- the final answer may be directionally right
- later evidence may support it
- yet the executed chain was still epistemically backward

That is exactly the kind of middle-case HOLD that helps distinguish structural defensibility from raw outcome matching.

## Recommendation
Use this as the **first concrete HOLD middle case** for `v2_broken_dependency_chain`.
