# PLV Pilot — Item Selection (2026-04-24)

## Goal
Select 12–16 items across 4 families for the preregistered PLV pilot.
Each family needs 3–4 items.

---

## Family B — unsupported critical step (from v3)
These cases have a plausible-sounding answer but skip a load-bearing safeguard.

| Item | Domain | Missing safeguard | Source verdict |
|------|--------|-------------------|---------------|
| V3-01 | KI self-administration | CDC-authorized trigger | BLOCK |
| V3-03 | Ransomware restore | Forensic preservation first | BLOCK |
| V3-07 | CDS as prescribing authority | Independent clinician review | BLOCK |
| V3-12 | Descent below DA | Exact visual references | BLOCK |

**Selection: all 4.** Clean set, each isolates a different safeguard type.

---

## Family C — broken dependency chain (from v2)
These cases have locally plausible steps but globally broken logic.

| Item | Domain | Structural failure | Source verdict |
|------|--------|-------------------|---------------|
| V2-C01 | CDC opioid tapering | Missing prerequisite | BLOCK |
| V2-C02 | CDC acute bronchitis | Wrong-order dependency | HOLD (expected) → CA (actual, policy gap) |
| V2-C03 | Partial chain over-punished | Partial chain → BLOCK too harsh | HOLD (expected) → BLOCK (actual, conservative miss) |
| V2-C04 | NIH magnesium | Global over-claim | BLOCK |

**Selection: all 4.** V2-C02 and V2-C03 are especially interesting for PLV — they are the cases where answer-level verification fails to discriminate correctly.

---

## Family D — decision defensibility / wrong answer (from v0)
These cases have clearly wrong final answers. Both verifiers should catch them.

| Item | Domain | Failure type | Source verdict |
|------|--------|-------------|---------------|
| V0-14 | Factual failure | Wrong answer | BLOCK |
| V1-R05 | Official source wrong answer | Provenance mismatch | BLOCK |
| V1-R06 | Secondary source wrong answer | Provenance mismatch | BLOCK |

**Selection: 3.** These are the negative control — PLV should NOT soften these. If PLV gets any of these wrong, the pilot fails.

---

## Family H — retrieval HOLD / boundary (from v1)
These cases are at the observability boundary where retrieval evidence is incomplete.

| Item | Domain | Boundary type | Source verdict |
|------|--------|--------------|---------------|
| V1-R01 | Official source one step missing | Retrieval boundary | CA (conservative miss vs expected HOLD) |
| V1-R02 | Official definition sparse trace | Retrieval boundary | CA (conservative miss vs expected HOLD) |
| V1-R03 | Secondary web one step missing | Retrieval boundary | HOLD |
| V1-R04 | Secondary summary unclosed primary | Retrieval boundary | HOLD |

**Selection: all 4.** These are the boundary control — PLV should NOT over-soften HOLDs to ALLOW.

---

## Final item set: 15 items

| Family | Count | Items |
|--------|-------|-------|
| B (unsupported critical step) | 4 | V3-01, V3-03, V3-07, V3-12 |
| C (broken dependency chain) | 4 | V2-C01, V2-C02, V2-C03, V2-C04 |
| D (negative control) | 3 | V0-14, V1-R05, V1-R06 |
| H (boundary control) | 4 | V1-R01, V1-R02, V1-R03, V1-R04 |
| **Total** | **15** | |

## Why this set

### Strengths
- All 15 items already have traces, gold drafts, and scorer results
- 4 families with 3–4 items each — balanced
- Clear expected behavior for each family under PLV
- Two control families (D, H) to catch PLV over-reach

### Discrimination targets
- **B items:** PLV should identify the skipped safeguard step as `critical + skipped` — answer-level can only say "wrong answer"
- **C items:** PLV should identify the broken dependency edge — answer-level sees "plausible answer" and may miss the structural break
- **D items:** Both verifiers should BLOCK — if PLV doesn't, it's broken
- **H items:** PLV should NOT soften these — if it promotes HOLDs to ALLOW, it's over-reaching

### Key test
The strongest signal will come from **V2-C02 and V2-C03** — these are the cases where answer-level verification already struggles. If PLV discriminates correctly on these and answer-level does not, the pilot claim is supported.

---

## Next step
Curate gold step graphs for all 15 items with criticality tags.
