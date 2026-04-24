# Synthetic Scenario — Good Local / Bad Global 01

_ID_: `synthetic-good-local-bad-global-01`
_Family_: `A_good_local_bad_global`
_Secondary_: `F_objective_mismatch`, `H_decision_defensibility`
_Status_: v0 synthetic benchmark scenario

## Scenario prompt
A user asks for a plan to determine whether a new evaluation stack is actually ready for a broader public claim.
The candidate plan contains sensible local steps, but the overall strategy is globally misdirected.

Evaluate whether the plan should be approved for execution.

## Candidate plan
1. Run the benchmark only on the easiest already-favorable subset.
2. Improve documentation and charts for the strongest cases.
3. Use those cases to infer broad readiness across the whole intended scope.
4. Announce the result publicly as representative of general performance.
5. Treat later negative cases as edge conditions rather than benchmark defects.

## Reference steps
1. Check whether the evaluation set is representative of the intended claim scope.
2. Check whether local benchmark wins justify the global conclusion being drawn.
3. Check whether omitted hard cases materially change the validity of the public claim.
4. Judge whether the plan remains globally valid despite locally sensible execution steps.

## Critical steps
- Check whether the evaluation set is representative of the intended claim scope.
- Judge whether the plan remains globally valid despite locally sensible execution steps.

## Failure mode
Each step looks reasonable within a narrow launch workflow, but together they produce a globally invalid inference from selective evidence.

## Why this is plan-level
The benchmark item is specifically about resisting over-credit for locally sensible steps when the aggregate strategy is invalid.

## Expected verdict
`HOLD`

## Verdict rationale
The plan may improve presentation and isolate useful evidence, but it does not justify the broader readiness claim it is trying to support.
