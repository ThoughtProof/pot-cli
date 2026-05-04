# 120v3 Track-2 n=3 Aggregation + Ensemble Simulation

**Date:** 2026-05-04  
**Repo:** `/Users/rauljager/dev/pot-cli`

## Verification

| Tier | A | B | C |
|---|---:|---:|---:|
| fast | 120/120 | 120/120 | 120/120 |
| standard | 120/120 | 120/120 | 120/120 |
| balanced | 120/120 | 120/120 | 120/120 |
| max | 120/120 | 120/120 | 120/120 |

Gold labels assembled from source `GOLD_VERDICTS` + case-file `expected_verdict`: **120 labels** (BLOCK=52, HOLD=34, ALLOW=34).

## Source artifacts

| Tier | Run A | Run B | Run C | Model / cascade metadata |
|---|---|---|---|---|
| fast | `120v3-deepseek-flash-single-2026-05-03.json` | `120v3-fast-run-b-2026-05-03.json` | `120v3-fast-run-c-2026-05-03.json` | deepseek / cascade disabled |
| standard | `120v3-standard-remeasure-2026-05-03.json` | `120v3-standard-run-b-2026-05-03.json` | `120v3-standard-run-c-2026-05-03.json` | deepseek-pro / cascade disabled |
| balanced | `120v3-thorough-balanced-remeasure-2026-05-03.json` | `120v3-thorough-balanced-run-b-2026-05-03.json` | `120v3-thorough-balanced-run-c-2026-05-03.json` | cascade(gemini→sonnet) / enabled: primary=gemini, secondary=sonnet, earlyExit=0.3, cascaded=84/120 |
| max | `120v3-thorough-max-run-a-2026-05-03.json` | `120v3-thorough-max-run-b-2026-05-03.json` | `120v3-thorough-max-run-c-2026-05-03.json` | sonnet / cascade disabled |

## Per-run public-mapping metrics

Public mapping: `UNCERTAIN→HOLD`, `CONDITIONAL_ALLOW→ALLOW`.

| Tier | Run | Accuracy | B→A | H→A | B→H | HOLD-rate | Strict accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|
| fast | A | 78.3% (94/120) | 0 | 2 | 13 | 34.2% | 64.2% |
| fast | B | 77.5% (93/120) | 1 | 2 | 15 | 35.8% | 67.5% |
| fast | C | 80.0% (96/120) | 0 | 3 | 13 | 32.5% | 69.2% |
| standard | A | 78.3% (94/120) | 0 | 1 | 8 | 34.2% | 70.8% |
| standard | B | 77.5% (93/120) | 0 | 1 | 9 | 31.7% | 70.0% |
| standard | C | 77.5% (93/120) | 0 | 1 | 8 | 33.3% | 69.2% |
| balanced | A | 83.3% (100/120) | 0 | 3 | 13 | 35.0% | 75.8% |
| balanced | B | 84.2% (101/120) | 0 | 3 | 12 | 35.8% | 77.5% |
| balanced | C | 86.7% (104/120) | 0 | 3 | 10 | 33.3% | 79.2% |
| max | A | 80.8% (97/120) | 0 | 5 | 15 | 35.8% | 74.2% |
| max | B | 82.5% (99/120) | 0 | 5 | 12 | 32.5% | 76.7% |
| max | C | 84.2% (101/120) | 1 | 5 | 11 | 33.3% | 78.3% |

## Mean / range by tier

| Tier | Accuracy mean (range) | B→A mean (range) | H→A mean (range) | B→H mean (range) | HOLD-rate mean (range) | Strict acc mean (range) |
|---|---:|---:|---:|---:|---:|---:|
| fast | 78.6% (77.5-80.0) | 0.3 (0-1) | 2.3 (2-3) | 13.7 (13-15) | 34.2% (32.5-35.8) | 66.9% (64.2-69.2) |
| standard | 77.8% (77.5-78.3) | 0.0 (0-0) | 1.0 (1-1) | 8.3 (8-9) | 33.1% (31.7-34.2) | 70.0% (69.2-70.8) |
| balanced | 84.7% (83.3-86.7) | 0.0 (0-0) | 3.0 (3-3) | 11.7 (10-13) | 34.7% (33.3-35.8) | 77.5% (75.8-79.2) |
| max | 82.5% (80.8-84.2) | 0.3 (0-1) | 5.0 (5-5) | 12.7 (11-15) | 33.9% (32.5-35.8) | 76.4% (74.2-78.3) |

## A/B/C stability

| Tier | Cases with any verdict oscillation | Any-osc rate | Pairwise mean flip-rate | Pairwise range | Pair counts AB/AC/BC |
|---|---:|---:|---:|---:|---:|
| fast | 15/120 | 12.5% | 8.3% | 6.7-10.0% | 8/10/12 |
| standard | 8/120 | 6.7% | 4.4% | 3.3-5.8% | 7/5/4 |
| balanced | 6/120 | 5.0% | 3.3% | 2.5-4.2% | 5/4/3 |
| max | 7/120 | 5.8% | 3.9% | 3.3-4.2% | 4/5/5 |

## Offline `thorough_ensemble` simulation: intended Gemini + DeepSeek Pro

Uses Gemini primary verdicts preserved in `balanced.cascade.per_item[*].primary_verdict` plus DeepSeek Pro `standard` run verdicts. Conservative veto: `BLOCK > HOLD > ALLOW`. This is still offline/discovery-only until runtime runner is wired.

| Run | Accuracy | B→A | H→A | B→H | HOLD-rate | Output |
|---|---:|---:|---:|---:|---:|---|
| A | 78.3% (94/120) | 0 | 1 | 8 | 34.2% | `runs/120v3-thorough-ensemble-sim-run-a-2026-05-04-gemini-deepseekpro.json` |
| B | 77.5% (93/120) | 0 | 1 | 9 | 31.7% | `runs/120v3-thorough-ensemble-sim-run-b-2026-05-04-gemini-deepseekpro.json` |
| C | 77.5% (93/120) | 0 | 1 | 8 | 33.3% | `runs/120v3-thorough-ensemble-sim-run-c-2026-05-04-gemini-deepseekpro.json` |

Mean accuracy: **77.8%** (range 77.5-78.3); B→A mean **0.0** (range 0-0); HOLD-rate mean 33.1%.

## Readout

- Best measured runtime tier: **balanced** at **84.7% mean accuracy**, **0 B→A**, and lowest measured oscillation (**5.0% any-case / 3.3% pairwise**).
- `max` is close on accuracy (**82.5% mean**) but had **1 B→A in run C**; not acceptable as default without guard/cascade.
- Intended offline `thorough_ensemble` (Gemini+DS Pro veto) is safer (**0 B→A**) but lower accuracy (**77.8%**) than balanced; useful as discovery/safety profile, not default.
- Fast B/C are valid 120/120 merged chunk artifacts; keep `chunked_from` metadata as provenance.