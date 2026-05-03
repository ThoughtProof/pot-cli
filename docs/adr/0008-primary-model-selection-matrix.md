# ADR-0008: Primary-Model Selection Matrix (v3)

**Status:** ACCEPTED (2026-04-29, post-Paul-review on PR #32 + cost-correction patch).
**Date:** 2026-04-29 (v3 nach Hermes Validierungs-Report; ACCEPTED nach Paul-Approval)
**Owners:** Computer (Architektur, Tier-Schema), Paul (Strategic Review), Hermes (Empirik, Validierung — abgeschlossen)
**Related:** ADR-0005 (failScore-Gate-Decoupling), ADR-0007 (Cross-Model-Verification), ADR-0001 (Verdict-Model)

---

## Status-Update (v3 vs v2)

**Was sich seit v2 (17:15 CEST) geändert hat:**

1. **Hermes Validierungs-Report abgeschlossen.** Achse 1b (120-Vollstand) und Achse 3 (M5-Cross-Check) ausgewertet. Achse 2 (Domain-Cases-Expansion) **nicht mehr nötig** — die 38 unmapped Cases waren praktisch ausschließlich Banking/Compliance, deckten Achse 2 ab.
2. **DS Pro Solo 85.4%-Behauptung hält nicht** dem 120-Vollstand stand. Ehrliche Zahl: **79.2%** (-6.2pp). Differenz erklärt durch Domain-Shift zur Banking-Regulatorik.
3. **Default-Tier-Frage entschieden: Lesart B.** `thorough_balanced` (Gem→Son Cascade) bleibt Default.
4. **M5 Ensemble empirisch ohne Zusatznutzen auf 120v3-Suite** (0 Saves, 2 Demotions). Strukturelle B→A-Garantie bleibt Audit-Argument, kein Accuracy-Argument.
5. **Pauls Anker-Bias-Hypothese: bestätigt und lokalisiert.** DS Pro ist schwach auf US-Securities (FIN-ext: 17%) und EU-Regulation (LEG-ext: 25%).
6. **Reviewer-Burden-Balance** (HOLD-Rate 31% auf 120) wird zentrales Pitch-Argument, neu im ADR.

---

## Context

ADR-0007 etablierte Cross-Model-Verification als architektonisches Prinzip (Primary → Secondary Cascade). Die ursprüngliche Annahme war: **es gibt ein optimales Primary-Modell**, das auf Accuracy maximiert ist; Secondary fungiert als Safety-Net auf den Edge-Cases.

Die empirischen Datenpunkte aus dieser Woche zeigen ein anderes Bild: **Solo-Modelle, Cascade-Architekturen und Parallel-Ensembles haben jeweils unterschiedliche, komplementäre Stärken** — alle mit identischer Sicherheits-Invariante (B→A=0). Die Entscheidung ist nicht "das beste Modell finden", sondern "die richtige Architektur pro Use-Case wählen".

### Empirischer Anker — sechs Konfigurationen auf 120v3-Suite (full 120, post-Hermes-Vollstand-Validation)

| Setup | Overall 120 | B→A | A→B | ALLOW rec. | HOLD rec. | BLOCK rec. | Cost/verification (USD) |
|---|---|---|---|---|---|---|---|
| 🥇 DS Pro Solo | **79.2%** | 0 ✅ | 1 | 75.8% | 71.4% | 82.7% | **$0.0080** |
| 🥈 **Gem→Son Cascade (fix2)** | **78.3%** | 0 ✅ | **0** ✅ | **97.0%** | **80.0%** | 61.5% | **$0.0271** |
| 🥉 M5 Ensemble (DS⊕Gem) | 77.5% | 0 ✅ | 1 | 69.7% | 71.4% | 82.7% | **$0.0175** |
| Sonnet Solo | 73.3% | 0 ✅ | 0 | 63.6% | 74.3% | 75.0% | **$0.0542** |
| Gemini Solo | 68.3% | **2** ❌ | 0 | 75.8% | 68.6% | 61.5% | **$0.0033** |
| Kimi k2.6 Solo | n/a | **2** ❌ | n/a | n/a | n/a | n/a | n/a |

**Post-acceptance addendum (Issue #36 item 3, 2026-04-30):** `thorough_strict` (DS Pro → Sonnet cascade) was subsequently run on the 120v3 suite: 76.2% accuracy, 0 B→A, 75.0% ALLOW-recall, 67.9% HOLD-recall, 82.2% BLOCK-recall, 78.3% Sonnet-call savings. This resolves the prior estimate caveat and changes `thorough_strict` positioning from “max BLOCK-recall” to “cost-efficient strict-gating.” The end-user matrix in `docs/tier-selection.md` is the source of truth for current routing.

> *Per-call estimates assume ~3k-token verification (1k input plan + 2k reasoning/output). Full 120-Case benchmark validation totals: $0.96 / $3.25 / $2.10 / $6.50 / $0.40 per tier.*

### Domain-Shift-Befund (Achse 1b Auswertung)

**Auf den 38 Banking/Compliance-Cases (US-Securities, EU-Reg, AML, MRM, INS, CYBER):**

| Setup | Banking-38 Accuracy | Delta vs. 82-Subset |
|---|---|---|
| 🥇 **Gem→Son Cascade** | **71.1%** | -10.6pp |
| DS Pro Solo | 65.8% | -19.6pp |
| Sonnet Solo | 63.2% | -14.8pp |
| M5 Ensemble | 63.2% | -20.9pp |
| Gemini Solo | 52.6% | -23.0pp |

**Kernbefund**: Auf Banking-Cases (Douglas-Pitch-relevant) ist **Cascade +5.3pp besser als DS Pro**. Die 82-Subset-Ranking invertiert sich.

### DS Pro Domain-Bias (Pauls Anker-Hypothese empirisch lokalisiert)

| Domain | DS Pro Accuracy | Signal |
|---|---|---|
| MRM (Model Risk) | 100% | 🟢 stark |
| INS (Insurance) | 100% | 🟢 stark |
| AML (Anti-Money-Laundering) | 83% | 🟢 stark |
| CYBER | 50% | 🟠 schwach |
| LEG-ext (EU-Reg) | 25% | 🔴 schlecht |
| **FIN-ext (US-Securities)** | **17%** | 🔴 sehr schlecht |

**Hypothese:** DS Pro hat weniger US-Securities/EU-Regulatory-Korpus im Training. Diese Domänen sind exakt Douglas' Enterprise-Buyer-Universum.

### M5 Ensemble Cross-Check Befund (Achse 3)

Per-Case Diff DS Pro Solo vs. M5 auf allen 120 Cases:

| Category | Count |
|---|---|
| Both correct | 93 |
| **DS right, M5 wrong** | **2** |
| **M5 right, DS wrong** | **0** |
| Both wrong | 25 |

**0 Cases wo M5 DS Pro korrigiert.** Gemini-BLOCK-Veto rettet 0 Cases. Gemini-HOLD-Veto über DS-ALLOW rettet 0 Cases. Die **2 Demotions** (D-05, RISK-03) sind Gemini's COND_ALLOW-Tendenz die DS Pro's korrekte ALLOW demoviert.

**Konsequenz:** M5 ist auf v3-Suite empirisch ohne Accuracy-Zusatznutzen. Strukturelles B→A-Garantie-Argument bleibt valide, aber wir verkaufen M5 ehrlich als **Audit-Compliance-Tier**, nicht als Accuracy-Tier.

### Confusion-Matrix Cross-Compare DS-Pro × Sonnet (n=82)

- **Kappa: 0.773** (substantial agreement, nicht redundant)
- **Joint-Errors auf Disagreements: 0** — bei jedem Disagreement hat einer der beiden recht
- **Komplementäre Biases**: Sonnet 100% ALLOW-Recall (lenient), DS Pro 97.1% BLOCK-Recall (strict)

Das stützt die Cross-Model-Verification-These aus ADR-0007 weiterhin.

---

## Decision

Wir etablieren eine **Primary-Model Selection Matrix** mit zwei Achsen: **Cost** und **Bias-Profil**. Tiers sind nicht mehr eindimensional als Cost-Leiter (`fast`/`standard`/`thorough`) definiert, sondern als Capability-Matrix mit expliziten Bias-Statements und Domain-Empfehlungen pro Tier.

### Tier-Definition (v3, post-Validation)

| Tier | Architektur | Primary-Modell(e) | Bias | B→A Guarantee | ALLOW Recall | BLOCK Recall | Cost | Default? |
|------|-------------|-------------------|------|---------------|--------------|--------------|------|----------|
| `fast` | Solo | DS Flash | strict-light | 0 | 90.6% | 73.3% | **$0.0013** | — |
| `standard` | Solo | DS Pro | strict-balanced | 0 | 75.8% | 82.7% | **$0.0080** | — |
| **`thorough_balanced`** | Cascade | Gemini → Sonnet | balanced | 0 | **97.0%** | 61.5% | **$0.0271** | ✅ **DEFAULT** |
| `thorough_strict` | Cascade | DS Pro → Sonnet | strict | 0 | 75.0% | 82.2% | **$0.0212** | — |
| `thorough_ensemble` | Parallel | DS Pro ⊕ Gemini, BLOCK-Veto | strict-via-veto | **0 strukturell** | 69.7% | 82.7% | **$0.0175** | — |
| `thorough_max` | Solo | Sonnet | mid | 0 | 63.6% | 75.0% | **$0.0542** | — |

> *Cost-Spalte ist Per-Call (USD), nicht Per-Benchmark. Annahme: ~3k Tokens pro Verification (1k Plan + 2k Reasoning/Output). Full 120-Case Benchmark-Totals zur Referenz: $0.96 / $3.25 / $2.55 / $2.10 / $6.50 pro Tier. Vergleich: InsumerAPI = $0.04/Verification[^insumer-pricing] — `thorough_balanced` ist **32% günstiger**. `thorough_strict` empirical backfill is recorded in Issue #36 comment 4353425556.*

**Hard Invariant über alle Tiers:** B→A = 0 (Hard Rule P1, ADR-0001). Procurement-Garantieanker.

**Strukturell vs. empirisch B→A=0:**
- `thorough_ensemble`: BLOCK-Veto-Logik garantiert mathematisch
- Alle anderen Tiers: empirisch 0 B→A auf 120v3-Suite

### Default-Tier: `thorough_balanced` (Cascade)

**Begründung (Lesart B, post-Validation):**

1. **Knappe Overall-Accuracy-Differenz**: DS Pro Solo 79.2% führt nur 0.9pp vor Cascade 78.3% — innerhalb der Benchmark-Varianz (Hermes schätzt ±3pp Drift bei Domain-Expert-Review).
2. **Dramatische ALLOW-Recall-Differenz**: Cascade 97.0% vs. DS Pro 75.8% — **21.2pp Vorsprung** bei False-HOLD-Vermeidung. Das ist ausserhalb der Varianz.
3. **Banking-Domain-Robustheit**: Cascade +5.3pp besser auf Douglas-relevanten Banking-Cases (71.1% vs 65.8%).
4. **0 A→B bei Cascade** vs. 1 A→B bei DS Pro — Cascade zusätzlich symmetrisch fehler-resistent.
5. **Strukturelle Notwendigkeit**: Gemini Solo hat 2 B→A. Sonnet-Cascade ist nicht Luxus, sondern P1-Garantie-Voraussetzung.

DS Pro Solo ist **kein verlierer** — es ist der **strong challenger** im `standard`-Tier mit klarem Bias-Statement (siehe Tier-Selection-Heuristik).

### Tier-Selection-Heuristik (Embedded-Plattform-Integratoren)

> **End-User-Doku:** Diese Heuristik dokumentiert das **interne Reasoning** für Tier-Selection. Für **End-User-API-Doku, Procurement-Reviewer und Plattform-Integratoren** siehe die [End-User Decision Matrix](../tier-selection.md), die diese Heuristik als 3-Achsen-Matrix (Stakes × Domain × Mode), Decision-Tree und Worked-Examples aufbereitet.

```
DEFAULT (no use_case specified):
    → thorough_balanced (Gem→Son Cascade)

IF use_case.domain IN ['us_securities', 'eu_regulation', 'banking_compliance']:
    → thorough_balanced (DS Pro hat dokumentierten Domain-Bias auf US-Sec / EU-Reg)

IF use_case = "regulated_audit_with_structural_guarantee_required":
    → thorough_ensemble (mathematische B→A-Garantie für Audit-Story)

IF use_case = "high_volume_compliance_screening" AND budget_per_eval matters
   AND domain IN ['ml_risk', 'insurance', 'aml']:
    → standard (DS Pro Solo, $0.0080/call, stark auf diesen Domänen)

IF use_case = "high_consequence_compliance" AND need_max_block_recall:
    → thorough_balanced (false-negative avoidance dominates; `thorough_strict` measured 82.2% BLOCK-recall on 120v3)

IF use_case = "strict_gating_at_scale" AND budget_per_eval matters:
    → thorough_strict (DS Pro→Sonnet, 78.3% Sonnet-call savings, 0 B→A on 120v3)

IF use_case = "rapid_triage_first_pass":
    → fast (DS Flash) → escalate to thorough on HOLD/BLOCK

IF max_tier-Constraint vom Plattform-Operator (Pauls Punkt):
    → cap auf konfigurierten max_tier
```

### API-Design (Pauls `max_tier`-Semantik)

`/v2/verify/tiers` Endpoint mit programmatic discovery. Plattform-Operator konfiguriert `max_tier` per API-Key:

```json
{
  "key_config": {
    "max_tier": "thorough_balanced",
    "fallback_on_demand": "thorough_strict"
  },
  "request": {
    "tier": "standard"
  }
}
```

`max_tier` ist Obergrenze (Kosten-Kontrolle), nicht Untergrenze. End-User-Request wählt darunter.

### Ausschlusskriterien

- **Sonnet Solo wird NICHT als Primary-Tier ausgespielt** außer als `thorough_max`-Backstop. $0.0542/call ohne Cross-Model-Verification ist kein Procurement-defensibles Angebot.
- **Gemini Solo ist disqualifiziert** (2× B→A: GAIA-16 mit `Gem=CONDITIONAL_ALLOW`, GAIA-19 mit `Gem=ALLOW`). P1-Verletzung. Nur als Cascade-Primary mit Sonnet-Rescue oder als Ensemble-Voter mit DS-Veto verwendbar.
- **Kimi k2.6 ist disqualifiziert** (2× B→A auf 120v3, P1-Verletzung). Endgültig.

---

## Reviewer-Burden-Balance (Produkt-Pitch-Argument)

**Das ist das strategisch wichtigste Verkaufsargument für Embedded-Pitches.**

### Gold-Verteilung auf 120

| Verdict | Count | % | Bedeutung |
|---|---|---|---|
| BLOCK | 50 | 42% | Klarer Fehler, automatisch geblockt |
| HOLD | 37 | 31% | **Menschliches Review nötig** |
| ALLOW | 33 | 28% | Automatisch durchgewunken |

### Reviewer-Burden bei 1000 AI-Outputs/Tag (Banking-Compliance-Skalierung)

- **310 Cases** → HOLD → Reviewer-Queue
- **500 Cases** → BLOCK → Automatisch geblockt
- **280 Cases** → ALLOW → Automatisch durchgelassen
- **= 1 Reviewer-Action pro 3.2 AI-Outputs** — produkt-tauglich

### HOLD-Rate per Domain (aus 38 Banking-Cases)

| Domain | Cases | HOLD-Rate | Charakter |
|---|---|---|---|
| MRM | 6 | **67%** | Hoch-spezifische Regulatorik-Citations |
| AML | 6 | 50% | Regulatory Compliance |
| CODE-ext | 2 | 50% | Supply-Chain-Security |
| RISK | 4 | 50% | Operational Risk Framework |
| FIN-ext | 6 | 33% | Securities Law |
| INS | 4 | 25% | Insurance Compliance |
| LEG-ext | 4 | 25% | EU Regulation |
| CYBER | 6 | 17% | Clearere Yes/No-Fragen |

**Pitch-Story:** Risiko-proportionale Automation — niedrigere HOLD-Rate auf klar-faktischen Domänen, höhere HOLD-Rate auf hoch-regulatorischen Domänen wo Reviewer-Augen Pflicht sind. Kein Rubber-Stamping.

**Vergleich zu Alternativen:**
- Naive AI-Deployment (Alles-ALLOW): 0% Review, 100% Risiko-Exposure → kein Audit-Argument
- Defensive AI-Deployment (Alles-HOLD): 100% Review, 0% Automation-Wert → kein Business-Case
- **PLV mit 31% HOLD: Produkttaugliche Balance, die dem Compliance-Risiko entspricht**

Diese Sektion gehört in jedes Embedded-Pitch-Deck.

---

## Methodik-Transparenz

Die Validierung wurde durch Hermes (M4) durchgeführt mit folgender Methodik. Wir machen die Schwächen explizit, weil **Procurement-Due-Diligence ehrliche Methodik-Statements erwartet**.

### Wie die 38 unmapped Cases annotiert wurden

- **Q/A-Intent-Inspection** gegen Gold-Plan-Steps (Hermes-Annotation, Raul-Review)
- **Cross-Check** mit 4 Inter-Model-Signalen (DS Pro Solo, Gemini Solo, Sonnet Solo, Gem→Son Cascade) als Sanity
- **Drei selbst-revidierte Annotations** während des Reviews dokumentiert:
  - `MRM-04`: BLOCK → HOLD (initial too-strict)
  - `INS-01`: BLOCK → ALLOW (initial faktisch falsch — MCR ist tatsächlich 85% VaR-kalibriert)
  - `AML-04`: ALLOW → HOLD (Safety-conservatism nach Raul-Review)

Self-revision ist Methodologie in Aktion, nicht Schwäche — Trust-Signal für Procurement.

### Bekannte Limitations

1. **Annotations durch Hermes + Raul, nicht zertifizierte Domain-Experts.** Estimated drift: ±3pp bei strenger Domain-Expert-Re-Annotation.
2. **Inter-Model-Agreement als Gold-Proxy ist zirkulär** (wenn alle Modelle denselben Bias haben, ist die Annotation bias-korreliert). Mitigation: 14 Medium-Confidence Annotations einzeln durch Raul reviewt; 13 bestätigt, 1 revidiert.
3. **MRM-Family enthält "future-regulatory-probe"-Cases** (Hypothetisches "SR 26-2"-Guidance). Valide PLV-Probe für Hallucination-Test, aber Case-Taxonomie braucht Metadaten-Feld `case_type: real | hypothetical | temporal_probe` für Transparenz.
4. **Gold-Coverage**: 120v3 ist ein Snapshot. Bei Cases-Expansion auf 200+ muss Tier-Matrix re-validiert werden. Pflicht-Aktion vor Cases-Expansion-PRs.

---

## Consequences

### Positive

1. **Procurement-Story ist robuster.** Sechs validierte Tiers, 0 B→A in allen, jeweils explizite Bias-Statements + Domain-Empfehlungen. Modell-Agnostik wird zu positivem Differenzierungsmerkmal.
2. **Domain-Aware Tier-Selection.** Plattformen können explizit nach Use-Case-Domain wählen — nicht "best model", sondern "right model for this regulator".
3. **Reviewer-Burden-Pitch ist verkaufsfähig.** 31% HOLD-Rate als ehrliches Audit-Argument schlägt naive 100%-Automation-Claims.
4. **Strukturelle Robustheit gegen Model-Provider-Risk.** Wenn DeepSeek aus dem Markt verschwindet, bleibt `thorough_balanced` und `thorough_max` verfügbar.
5. **M5 Ensemble bleibt im Portfolio** als Audit-Compliance-Tier — strukturelle B→A-Garantie ist ein Banking-Procurement-Asset, auch ohne Accuracy-Premium.
6. **Self-revision als Trust-Signal**: Die drei dokumentierten Annotation-Korrekturen während Validation sind ein Vertrauens-Anker in Methodik-Reviews.
7. **Agentic-Commerce-kompatible Per-Call-Ökonomie.** Default-Tier `thorough_balanced` liegt bei $0.0271/call — **32% unter InsumerAPI** ($0.04/Verification[^insumer-pricing]) und damit verteidigbar gegen den derzeit dominanten Agent-Compliance-Vergleichspunkt. `standard` ($0.0080) und `fast` ($0.0013) öffnen High-Volume-Triage-Workloads, die bei Per-Verification-Pricing >$0.04 unwirtschaftlich sind. Cost-Story ist damit nicht nur Genauigkeits-, sondern auch Volumen-Argument.
8. **`fast` ist nicht mehr unbenchmarked.** DS Flash Single Run auf 120v3 (2026-05-03, `runs/120v3-deepseek-flash-single-2026-05-03.json`) erreicht 78.1% Accuracy (82/105 labeled), 0 B→A, 90.6% ALLOW-recall und 73.3% BLOCK-recall. Das reicht für ehrliche Triage-Positionierung; für Audit-/High-Stakes-Default bleibt `thorough_balanced`.

[^insumer-pricing]: InsumerAPI Pricing-Quelle: $0.04/Call ist der Base-Preis für `POST /v1/attest` im USDC-Prepay-Tier $5–$99 (1 Credit à $0.04). Volume-Discounts: $0.03/Call ($100–$499 Tier), $0.02/Call ($500+ Tier). Alternative Pricing-Pfad via Subscription: Pro-Tier $9/Monat = ~$0.09/Call, Enterprise-Tier $29/Monat = ~$0.058/Call. Der **$0.04-Vergleichspunkt ist der niedrigste publizierte On-Chain-Pay-as-you-go-Preis** und damit der härteste Procurement-Vergleich. Quellen: [insumermodel.com/terms-of-service](https://insumermodel.com/terms-of-service/), [Smithery Insumer Skill](https://smithery.ai/skills/douglasborthwick/insumer-skill). Stand: 2026-04 — Re-Verifizierung quartalsweise empfohlen.

### Negative / Risk

1. **Komplexitäts-Overhead in Pitch und API.** Sechs Tiers brauchen mehr Erklärung als drei. Mitigation: Tier-Selection-Heuristik in API-Docs, programmatic discovery.
2. **DS Pro Solo Domain-Bias muss kommuniziert werden.** Wenn ein Plattform-Operator naiv `standard` für US-Securities-Use-Case wählt, sieht er 17% Accuracy. Mitigation: Tier-Selection-Heuristik flaggt das, API-Response kann Domain-Mismatch-Warnings liefern.
3. **Tier-Capabilities driften mit Modell-Updates.** DeepSeek v5 Pro könnte BLOCK-Recall ändern. Mitigation: `last_validated`-Feld pro Tier, Pflicht-Re-Benchmark vor Modell-Upgrade.
4. **M5-Marketing ist heikel.** "Strukturelle Garantie ohne Accuracy-Premium" ist ehrlicher als "best of both worlds", aber schwieriger zu pitchen. Mitigation: explizit als Banking-Audit-Compliance-Tier positionieren, nicht als Accuracy-Optimum.
5. **DS-Primary-Cascade ist kein Max-BLOCK-Recall-Tier.** Der 120v3-Backfill misst `thorough_strict` bei 75.0% ALLOW-recall und 82.2% BLOCK-recall, nicht bei den ursprünglichen 64.0% / 97.1%-Schätzungen. Mitigation: als "cost-efficient strict-gating" dokumentieren; High-consequence false-negative Use-Cases zu `thorough_balanced` routen.
6. **`fast` hat nur Single-Run-Empirie.** 0 B→A auf einem Run ist ein gutes Signal, aber kein strukturelles Guarantee und noch keine Varianzstudie. Mitigation: weiter als pre-filter / dev-pipeline / rapid-triage positionieren und HOLD/BLOCK/high-stakes Outputs zu `thorough_balanced` eskalieren.

### Open Questions

1. **`case_type`-Metadaten** (real | hypothetical | temporal_probe) — separater Issue, blockiert ADR-0008-Merge nicht.
2. **Inter-Tier-Korrelation**: Wenn ein Plattform-Operator `fast` für Bulk und `thorough_strict` für Final-Review parallel nutzt, korrelieren Fehler? Separate Studie nötig.
3. **DS Pro v5 Re-Validation**: Wenn DeepSeek Modell-Update kommt, prüft sich der Domain-Bias möglicherweise. Pflicht-Re-Benchmark vor Tier-Update.
4. **`fast` Varianzstudie**: Falls `fast` produktiv als autonomer Gatekeeper statt Triage eingesetzt werden soll, braucht es mindestens Run-B/Run-C auf 120v3 und Drift-Analyse.

---

## Implementation Sketch (für Schema-Workstream)

```typescript
interface PLVTier {
  id: 'fast' | 'standard' | 'thorough_balanced' | 'thorough_strict' | 'thorough_ensemble' | 'thorough_max';
  architecture: 'solo' | 'cascade' | 'parallel_ensemble';
  primary_model: string;
  secondary_model?: string;
  ensemble_models?: string[];
  veto_logic?: 'block_veto' | 'hold_veto' | null;
  bias: 'balanced' | 'strict' | 'strict-balanced' | 'strict-light' | 'strict-via-veto' | 'mid';
  domain_recommendations: {
    preferred: string[];     // domains where this tier excels
    contraindicated: string[]; // domains where this tier has known weakness (e.g. DS Pro: us_securities)
  };
  safety_guarantee: {
    block_to_allow_violations: 0;
    guarantee_type: 'empirical' | 'structural';
    benchmark: '120v3';
    last_validated: string;
  };
  recall_profile: {
    allow: number;
    hold: number;
    block: number;
  };
  cost_per_eval_usd_estimate: number;
  use_case: string[];
}

interface PlatformKeyConfig {
  max_tier: PLVTier['id'];
  fallback_on_demand?: PLVTier['id'];
}
```

`/v2/verify/tiers` returns this structure for embedded platforms.

---

## References

- **Hermes Validierungs-Report (final): `hermes-validation-report-for-computer-2026-04-29.md`**
- Fast Tier Single Run: `runs/fast-single-report-2026-05-03.md` (`runs/120v3-deepseek-flash-single-2026-05-03.json`)
- M5 Ensemble Report: `runs/m5-ensemble-report-2026-04-29.md`
- DS-Primary Cascade Report: `runs/cascade-dsprimary-report-2026-04-29.md`
- Multi-Model-Briefing: `briefing-2026-04-29-cascade-multimodel-summary.md`
- Borthwick Procurement-Read: Telegram 2026-04-29 14:38
- Paul Strategic-Review (6 IMG): `paul_briefing_2026-04-29_cascade_ds_pro_decision.md`
- ADR-0007 (Cross-Model-Verification, parent ADR)
- ADR-0001 (Verdict-Model)
- ADR-0005 (failScore-Gate-Decoupling)

---

## Next Actions

- [ ] Paul Strategic Review (max_tier-Semantik, Default=Cascade Bestätigung, Tier-Naming)
- [ ] Schema-Workstream (`/v2/verify/tiers` Endpoint, Embedded-First Multi-Tenancy) — **separater PR, post-ADR-Merge**
- [ ] PR für `GOLD_VERDICTS`-Update in `src/commands/plan-graded-eval.ts` — die 38 neuen Annotations committen — **separater PR, post-ADR-Merge**
- [ ] Issue für `case_type` Metadaten-Feld (real | hypothetical | temporal_probe) — separat
- [ ] Douglas-Update mit "31% HOLD-Rate, risiko-proportionale Automation"-Pitch (nach Paul-Review)
- [x] PR #31 (Cascade Wire-Up Infrastructure) — Beschreibung anpassen: Cascade ist validierter Default-Tier, nicht nur Infrastructure
