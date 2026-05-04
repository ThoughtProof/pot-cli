# Track-2 n=3 Recall Addendum

**Date:** 2026-05-04  
**Source:** A/B/C artifacts in `/Users/rauljager/dev/pot-cli/runs`  
**Mapping:** public mapping (`UNCERTAIN→HOLD`, `CONDITIONAL_ALLOW→ALLOW`).

| Tier | ALLOW-recall mean (range) | BLOCK-recall mean (range) | HOLD-recall mean (range) | B→A mean (range) |
|---|---:|---:|---:|---:|
| `fast` | 91.2% (88.2-94.1) | 73.1% (69.2-75.0) | 74.5% (73.5-76.5) | 0.3 (0-1) |
| `standard` | 75.5% (73.5-79.4) | 84.0% (82.7-84.6) | 70.6% (67.6-73.5) | 0.0 (0-0) |
| `balanced` | 96.1% (94.1-97.1) | 77.6% (75.0-80.8) | 84.3% (82.4-85.3) | 0.0 (0-0) |
| `max` | 97.1% (97.1-97.1) | 75.0% (71.2-76.9) | 79.4% (76.5-82.4) | 0.3 (0-1) |
| `ensemble_gem_ds` | 75.5% (73.5-79.4) | 84.0% (82.7-84.6) | 70.6% (67.6-73.5) | 0.0 (0-0) |

## `thorough_strict` status

Only one full 120-item `thorough_strict` artifact is present: `runs/120v3-thorough-strict-issue36-3.json`. It is **single-run/backfill**, not n=3. Metrics:
- Items: 120/120
- ALLOW-recall: 73.5% (25/34)
- BLOCK-recall: 84.6% (44/52)
- HOLD-recall: 70.6% (24/34)
- B→A: 0

Recommendation: do **not** block tier-selection v0.4 on strict n=3. Mark `thorough_strict` as single-run/backfill and schedule a separate n=3 if it becomes product-critical.