# ADR-0008: Primary-Model Selection Matrix (DRAFT)

**Status:** DRAFT v1 — pending review (Paul, Hermes), pending M5 Ensemble-Experiment
**Date:** 2026-04-29 (16:30 CEST)
**Owners:** Computer (Architektur, Tier-Schema), Paul (Decisions), Hermes (Empirik, M4)
**Related:** ADR-0005 (failScore-Gate-Decoupling), ADR-0007 (Cross-Model-Verification), zukünftige ADR-0009 (Ensemble-Veto, falls M5 erfolgreich)

---

## Context

ADR-0007 etablierte Cross-Model-Verification als architektonisches Prinzip (Primary → Secondary Cascade). Die ursprüngliche Annahme war: **es gibt ein optimales Primary-Modell**, das auf Accuracy maximiert ist; Secondary fungiert als Safety-Net auf den Edge-Cases.

Drei empirische Datenpunkte aus dieser Woche zeigen: **diese Annahme ist falsch.** Es gibt nicht ein optimales Primary, sondern mehrere Primary-Modelle mit **unterschiedlichen, komplementären Stärken** — alle mit identischer Sicherheits-Invariante (B→A=0).

### Empirischer Anker — drei validierte Cascade-Konfigurationen auf 120v3-Suite

**1. Gemini → Sonnet (Cascade-Fix2, 2026-04-29):**
- Overall Accuracy: **81.7%**
- ALLOW Recall: **96.0%** 🥇
- HOLD Recall: 68.2%
- BLOCK Recall: 80.0%
- B→A: 0 ✅
- Cost: ~$3.25/run
- **Critical Property:** Gemini-Primary leakt 2 ALLOW-Cases ohne Sonnet-Rescue (V0-14, H-05). **Strukturell abhängig von Secondary.**

**2. DeepSeek v4 Pro → Sonnet (DS-Primary-Cascade, 2026-04-29):**
- Overall Accuracy: 78.0%
- ALLOW Recall: 64.0%
- HOLD Recall: 63.6%
- BLOCK Recall: **97.1%** 🥇
- B→A: 0 ✅
- Cost: ~$2.55/run (78% Early-Exit-Rate, 26 Sonnet-Calls statt 44)
- **Critical Property:** DS-Primary fängt BLOCK-Cases nativ (97.1% recall, +17pp über Gemini-Primary). Strukturell **weniger abhängig** von Secondary. Fängt GAIA-16, MED-04, FIN-01 als BLOCK — alle Cases die Gemini+Sonnet als HOLD durchwinken.

**3. Sonnet Solo (Baseline, 2026-04-29):**
- Overall Accuracy: 78.0%
- ALLOW Recall: 76.0%
- BLOCK Recall: 91.4%
- B→A: 0 ✅
- Cost: ~$6.50/run
- **Property:** Höchste Cost, mittelmäßige Recall-Profile. Disagreement-Resolver-Rolle bleibt — keine Primary-Rolle.

### Confusion-Matrix Cross-Compare (n=82 gold-mapped)

DS-Primary vs. Gemini-Primary auf den gleichen 82 Cases:
- **DS wins (DS✅, Gem❌): 8 Cases** — alle BLOCK oder HOLD (V3-07, V2-C04, V1-R05, FIN-01, GAIA-16, MED-04, V0-14, H-05)
- **Gem wins (Gem✅, DS❌): 11 Cases** — fast alle ALLOW (6× Gold=ALLOW + DS=COND_ALLOW, 3× Gold=HOLD + DS=BLOCK)
- **Both wrong: 7 Cases** — Gold-Schwächen oder trace-sparse (V1-R06, GAIA-01, GAIA-19, MED-03, ENV-03, H-06, D-08)

**Kappa Sonnet ↔ DS-Pro auf Single-Model-Runs: 0.773** (substantial, nicht redundant). **Joint-Errors auf Disagreements: 0** — bei jedem Disagreement hat einer der beiden Modelle recht.

### Kernbefund

Die beiden Modelle haben **ungefähr gleiche Gesamtfehlerzahl (18 vs 15) an unterschiedlichen Cases**. Das ist kein Modell-Ranking, das ist eine **Bias-Achse**:

| Bias | Charakteristik | Stärke | Schwäche |
|------|----------------|--------|----------|
| Balanced (Gemini-Primary) | Lenient bei Borderline | ALLOW-Recall 96% | BLOCK-Leakage zu HOLD |
| Strict (DS-Primary) | Konservativ bei Partial-Support | BLOCK-Recall 97% | ALLOW-Cases zu COND_ALLOW |

---

## Decision

Wir etablieren eine **Primary-Model Selection Matrix** mit **zwei Achsen**: Cost und Bias. Tiers werden nicht mehr eindimensional als Cost-Leiter (`fast`/`standard`/`thorough`) definiert, sondern als **Capability-Matrix** mit expliziten Bias-Statements pro Tier.

### Tier-Definition

| Tier | Model-Family | Bias | B→A Guarantee | ALLOW Recall | BLOCK Recall | Cost |
|------|--------------|------|---------------|--------------|--------------|------|
| `fast` | DS Flash Solo | strict-light | 0 | 76.2% | n/a | ~$0.20 |
| `standard` | DS Pro Solo | strict | 0 | 78.1% | 82.2% | ~$0.96 |
| `thorough_balanced` | Gemini → Sonnet | balanced | 0 | **96.0%** | 80.0% | ~$3.25 |
| `thorough_strict` | DS Pro → Sonnet | strict | 0 | 64.0% | **97.1%** | ~$2.55 |
| `thorough_max` | Sonnet Solo | mid | 0 | 76.0% | 91.4% | ~$6.50 |

**Hard Invariant über alle Tiers:** B→A = 0 (Hard Rule P1, ADR-0001). Das ist der Procurement-Garantieanker, unabhängig von Tier-Wahl.

### Tier-Selection-Heuristik (für Embedded-Plattform-Integratoren)

```
IF use_case = "regulated_audit" AND consequence_of_false_allow > consequence_of_false_hold:
    → thorough_strict (DS-Primary-Cascade)

IF use_case = "user_facing_response_screening" AND friction_cost matters:
    → thorough_balanced (Gemini-Cascade)

IF use_case = "bulk_compliance_screening" AND budget_per_eval matters:
    → standard (DS Pro Solo)

IF use_case = "rapid_triage_first_pass":
    → fast (DS Flash Solo) → escalate to standard or thorough on HOLD/BLOCK
```

### Ausschlusskriterien

- **DS-Primary-Cascade ist NICHT der Cost-Optimizer.** Bei $2.55 vs. $3.25 ist die Differenz marginal. Der Hauptzweck ist BLOCK-Recall-Maximierung, nicht Kosten.
- **Sonnet Solo wird NICHT als Primary-Tier ausgespielt.** $6.50 ohne Cross-Model-Verification ist kein Procurement-defensibles Angebot. Nur als Disagreement-Resolver in Cascades.
- **Kimi k2.6 ist disqualifiziert** (2× B→A auf 120v3, P1-Verletzung). Endgültig, kein Retry mit besserem Prompt.

### Was diese ADR NICHT entscheidet

- **M5 Ensemble (Parallel-Voting).** Wenn Hermes' späteres M5-Experiment zeigt dass DS+Gemini parallel mit Veto-Logik 97% BLOCK + 96% ALLOW Recall kombiniert bei <2× Sonnet-Solo-Kosten, würde das die Matrix erweitern um einen `thorough_max_recall`-Tier. Eigene ADR-0009 falls M5 erfolgreich.
- **Schema-Format für `/v2/verify/tiers`.** Diese ADR liefert die Tier-Definitionen; das HTTP-Schema und Multi-Tenancy-Locking-Modell wird in einer separaten Schema-Skizze behandelt (post-Borthwick-Feedback Embedded-First).
- **Default-Tier ohne Parameter.** Pauls Empfehlung: `standard` (DS Pro Solo). Wird im Schema-Workstream finalisiert, nicht hier.

---

## Consequences

### Positive

1. **Procurement-Story ist robuster.** "Drei economy-tier primaries validiert, 0 B→A in allen, zwei konkurrierende Design-Tradeoffs" ist die Pitch-Headline für Embedded-Buyer (Douglas-Read 2026-04-29). Modell-Agnostik wird zu einem positiven Differenzierungsmerkmal: keine Vendor-Abhängigkeit, robuste Garantie.
2. **Kunden können nach ihrem Operativ-Profil wählen.** Compliance-Audit-Buyer nehmen `thorough_strict` (97% BLOCK-Recall trotz höherer False-HOLD-Rate). User-Facing-Plattformen nehmen `thorough_balanced` (96% ALLOW-Recall, weniger Friction). Die Wahl wird explizit, nicht versteckt.
3. **Strukturelle Robustheit gegen Model-Provider-Risk.** Wenn DeepSeek aus dem Markt verschwindet oder die API ändert, ist die Tier-Matrix nicht kaputt — `thorough_balanced` bleibt verfügbar. Das ist eine Defense-Position in Procurement-Reviews.
4. **Cross-Model-Cascade-Wert wird empirisch klarer.** Gemini-Primary leakt 2 ALLOW-Cases ohne Sonnet-Rescue — Cascade ist nicht Luxus, sondern strukturelle Notwendigkeit. DS-Primary-Cascade ist weniger abhängig von Secondary, aber Secondary fängt trotzdem False-HOLDs in den 9 ALLOW-Cases wo DS Pro über-streng war. Beide Architekturen haben einen klaren Architecture-Reason für ihre Existenz.

### Negative / Risk

1. **Komplexitäts-Overhead in Pitch und API.** Eine 5-Tier-Matrix erfordert mehr Erklärung als eine 3-Tier-Cost-Leiter. Mitigation: Tier-Selection-Heuristik in API-Docs und `/v2/verify/tiers` Endpoint mit programmatic discovery für Plattformen.
2. **Tier-Capabilities driften mit Modell-Updates.** Wenn DeepSeek v5 Pro erscheint und die BLOCK-Recall verändert, müssen wir die Matrix neu validieren. Mitigation: `last_validated`-Feld pro Tier im Schema, Pflicht-Re-Benchmark vor jedem Modell-Upgrade.
3. **Kosten-Differenzierung zwischen `thorough_balanced` und `thorough_strict` ist gering** ($3.25 vs $2.55). Das ist kein Pricing-Hebel — beide Tiers würden ähnlich bepreist werden müssen. Mitigation: Differenzierung über Bias-Statement, nicht über Cost-Tier.
4. **DS-Primary-Cascade hat schlechtere ALLOW-Recall (64%) als Sonnet Solo (76%).** Das heißt: Plattformen mit hohem Eval-Volumen und ALLOW-Heavy-Traffic werden hohe False-HOLD-Raten sehen. Pauls Compliance-Audit-Beispiel (1000 Verifications/Tag) heißt 360 manuelle Reviews/Tag bei `thorough_strict`. Mitigation: explizit als "regulated_high_consequence"-Use-Case dokumentieren, nicht als Default.

### Open Questions

1. **Inter-Tier-Korrelation.** Wenn ein Plattform-Operator zwei Tiers parallel verwendet (z.B. `fast` für Bulk-Screening, `thorough_strict` für Final-Review), korrelieren die Fehler? Antwort hängt von M5 ab.
2. **Validierung bei Cases-Expansion.** 120v3 ist ein Snapshot. Wenn die Suite auf 200+ Cases wächst, könnten sich die Recall-Profile pro Tier verschieben. **Pflicht-Aktion vor jedem Cases-Expansion-PR**: Tier-Matrix re-validieren, ADR-0008 v2 wenn Verschiebung > 3pp.
3. **Tier-Bezeichnung-Kommunikation.** `thorough_strict` vs. `thorough_balanced` ist intern klar, aber ist es für Banking-Procurement verständlich? Möglicherweise externe Bezeichnungen wie `recall_max_block` und `recall_balanced` (axis-explicit) sinnvoller. Schema-Workstream entscheidet.

---

## Implementation Sketch (für Schema-Workstream)

```typescript
// Tier-Definition (TypeScript pseudocode)
interface PLVTier {
  id: 'fast' | 'standard' | 'thorough_balanced' | 'thorough_strict' | 'thorough_max';
  architecture: 'solo' | 'cascade';
  primary_model: string;
  secondary_model?: string;
  bias: 'balanced' | 'strict' | 'strict-light' | 'mid';
  safety_guarantee: {
    block_to_allow_violations: 0;  // hard invariant
    benchmark: '120v3';
    last_validated: string;  // ISO date
  };
  recall_profile: {
    allow: number;
    hold: number;
    block: number;
  };
  cost_per_eval_usd_estimate: number;
  use_case: string[];
}
```

`/v2/verify/tiers` endpoint returns this structure as JSON, allowing programmatic capability discovery for embedded platforms.

---

## References

- Confusion Matrix Report: `runs/cascade-dsprimary-report-2026-04-29.md`
- Multi-Model-Briefing: `briefing-2026-04-29-cascade-multimodel-summary.md`
- Borthwick Procurement-Read: Telegram 2026-04-29 14:38
- Paul Strategic-Review: `paul_briefing_2026-04-29_cascade_ds_pro_decision.md`
- ADR-0007 (Cross-Model-Verification, parent ADR)
- ADR-0001 (Verdict-Model, defines BLOCK/ALLOW/HOLD/COND_ALLOW)
- ADR-0005 (failScore-Gate-Decoupling, defines CONDITIONAL_ALLOW → public ALLOW mapping)

---

**Next Actions:**

- [ ] Paul Review (decisions on open questions, naming convention)
- [ ] Hermes Review (correctness of empirical numbers, additional data points)
- [ ] Schema-Workstream (`/v2/verify/tiers` endpoint design with embedded-first multi-tenancy)
- [ ] M5 Ensemble Experiment (DS+Gemini Parallel-Voting, ~2 weeks out — would extend matrix with `thorough_max_recall` tier if successful)
