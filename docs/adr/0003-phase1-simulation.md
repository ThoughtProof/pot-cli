# ADR-0003 v2.1 — Step-Level Predicate-Drift Simulation

Source: Hermes DS-Recon, 4 runs × 4 models, 158 steps per model.
Method: re-classify each post-floor score bucket under the new band.
Scope: STEP-level predicate transitions only. VERDICT-level CM = Phase 2 (Hermes M4).

## Grok (n=159)

| Transition | Steps | Share |
|---|---:|---:|
| skipped → skipped | 64 | 40.3% |
| supported → supported | 54 | 34.0% |
| partial → partial | 11 | 6.9% |
| partial → supported | 30 | 18.9% |

- Unchanged: 129 (81.1%)
- Promoted partial→supported (the 0.50 bucket): 30 (18.9%)
- Demoted: 0

## DS (n=159)

| Transition | Steps | Share |
|---|---:|---:|
| skipped → skipped | 77 | 48.4% |
| supported → supported | 56 | 35.2% |
| partial → partial | 9 | 5.7% |
| partial → supported | 17 | 10.7% |

- Unchanged: 142 (89.3%)
- Promoted partial→supported (the 0.50 bucket): 17 (10.7%)
- Demoted: 0

## Gemini (n=159)

| Transition | Steps | Share |
|---|---:|---:|
| skipped → skipped | 71 | 44.7% |
| supported → supported | 51 | 32.1% |
| partial → partial | 24 | 15.1% |
| partial → supported | 13 | 8.2% |

- Unchanged: 146 (91.8%)
- Promoted partial→supported (the 0.50 bucket): 13 (8.2%)
- Demoted: 0

## Aggregate

- Total step-evaluations across 3 models: 477
- Total promoted partial→supported: 60 (12.6%)
- Total demoted: 0

## Interpretation

The shift exclusively converts the 0.50-bucket from `partial` to `supported`.
No downgrades occur in the simple shift. Demotions only enter via:
  - R1 (no-quote at score≥0.50) — capped to 0.25, predicate becomes `partial`.
  - R7/Quote-too-short — capped to 0.40, predicate becomes `partial`.
Both floors are applied BEFORE the predicate band, so the buckets above
already reflect their effect. No additional Phase-1 demotion is expected.

## Hard-Rule Compatibility (User)

User's acceptance hard-rule (from session memory): zero BLOCK→ALLOW or
HOLD→ALLOW regressions on the 40-case CM. This Phase-1 simulation cannot
verify that — it requires Hermes' Phase-2 CM run on 82 cases with the
seed pin (PR-G #18). Phase 1 evidence: only `partial→supported` transitions
on the 0.50 bucket; never `unsupported→supported`. A BLOCK→ALLOW regression
would require a critical step flipping unsupported→supported, which the
shift cannot produce by construction (no score crosses the 0.25 boundary).
