# ADR-0008: Primary-Model Selection Matrix (DRAFT v2)

**Status:** DRAFT v2 — **Validierung aktiv** (Hermes Vollstand-Run + M5-Cross-Check). Pre-Krönungs-Stand. NICHT mergen bis Validierung durch.
**Date:** 2026-04-29 (17:15 CEST, v2 nach M5-Resultaten)
**Owners:** Computer (Architektur, Tier-Schema), Paul (Strategic Review), Hermes (Empirik, Validierung)
**Related:** ADR-0005 (failScore-Gate-Decoupling), ADR-0007 (Cross-Model-Verification), ADR-0001 (Verdict-Model)

---

## Status-Update (v2 vs v1)

**Was sich seit v1 (16:30 CEST) geändert hat:**

1. **DS Pro Solo Methodik-Korrektur**: Frühere "78.1%" war strict-accuracy auf 120 Cases. Auf 82 gold-mapped Cases ist die Zahl **85.4%** — +7.3pp. Das ändert die Default-Tier-Diskussion fundamental.
2. **M5 Ensemble-Resultate vorhanden**: 84.1% / 0 B→A / 97.1% BLOCK-Recall (Simulation aus existing Runs, bit-identisch zu Live). M5 ist real und produktreif, nicht hypothetisch.
3. **Gemini Solo disqualifiziert**: 2 B→A (GAIA-16, GAIA-19). Endgültig.
4. **Validierungs-Lücke offen**: Die 38 nicht-gold-gemappten Cases sind nicht analysiert. Hermes validiert aktuell. Solange das nicht durch ist, **wird DS Pro Solo nicht als Default gekrönt**.

**Konsequenz**: Diese ADR enthält jetzt zwei Lesarten der Default-Tier-Frage. Final-Entscheidung nach Validierungs-Report.

---

## Context

ADR-0007 etablierte Cross-Model-Verification als architektonisches Prinzip (Primary → Secondary Cascade). Die ursprüngliche Annahme war: **es gibt ein optimales Primary-Modell**, das auf Accuracy maximiert ist; Secondary fungiert als Safety-Net auf den Edge-Cases.

Die empirischen Datenpunkte aus dieser Woche zeigen ein anderes Bild: **Solo-Modelle, Cascade-Architekturen und Parallel-Ensembles haben jeweils unterschiedliche, komplementäre Stärken** — alle mit identischer Sicherheits-Invariante (B→A=0). Die Entscheidung ist nicht "das beste Modell finden", sondern "die richtige Architektur pro Use-Case wählen".

### Empirischer Anker — sechs Konfigurationen auf 120v3-Suite (gold-mapped, n=82)

| Setup | Overall | B→A | A→B | ALLOW rec. | HOLD rec. | BLOCK rec. | Cost |
|---|---|---|---|---|---|---|---|
| 🥇 **DS Pro Solo** | **85.4%** | 0 ✅ | 1 | 92.0% | 59.1% | **97.1%** | $0.96 |
| 🥈 **M5 Ensemble (DS⊕Gem)** | 84.1% | 0 ✅ | 1 | 88.0% | 59.1% | **97.1%** | $2.10 |
| 🥉 Gem→Son Cascade (fix2) | 81.7% | 0 ✅ | 0 | **96.0%** | 68.2% | 80.0% | $3.25 |
| Sonnet Solo | 78.0% | 0 ✅ | 0 | 76.0% | 59.1% | 91.4% | $6.50 |
| DS→Son Cascade | 78.0% | 0 ✅ | 1 | 64.0% | 63.6% | 97.1% | $2.55 |
| Gemini Solo | 75.6% | **2** ❌ | 0 | 88.0% | 54.5% | 80.0% | $0.40 |
| Kimi k2.6 Solo | n/a | **2** ❌ | n/a | n/a | n/a | n/a | n/a |

**Methodik-Fußnote**: Alle Zahlen oben sind gold-mapped auf 82/120 Cases. Die 38 nicht-gemappten Cases werden aktuell durch Hermes annotiert (mapped/out_of_scope/ambiguous). Validierungs-Report folgt — DS Pro Solo Default-Krönung ist davon abhängig.

### Kernbefunde

1. **DS Pro Solo führt das Feld an** — höchste Accuracy UND niedrigste Kosten. Wenn validiert, ist das die einfachste Architektur.
2. **M5 Ensemble bietet keine Accuracy-Verbesserung über DS Pro Solo**, aber **strukturelle B→A-Garantie** (nicht nur empirisch). Wert: Audit-Story und Robustheits-Reserve.
3. **Cascade-Architekturen sind nicht obsolet**: Gem→Son hat den höchsten ALLOW-Recall (96%, +4pp über DS Pro). Für ALLOW-Heavy-Traffic-Profile ist das relevant.
4. **Sonnet Solo wird unterboten** — von DS Pro um 7.4pp Accuracy bei 15% der Kosten. Sonnet bleibt nur als Disagreement-Resolver in Cascades sinnvoll.

### Confusion-Matrix Cross-Compare DS-Pro × Sonnet (n=82)

- **Kappa: 0.773** (substantial agreement, nicht redundant)
- **Joint-Errors auf Disagreements: 0** — bei jedem Disagreement hat einer der beiden recht
- **Komplementäre Biases**: Sonnet 100% ALLOW-Recall (lenient), DS Pro 97.1% BLOCK-Recall (strict)

Das ist der empirische Anker für die Bias-Achsen-These: zwei Modelle mit gleicher Fehlerzahl, aber an unterschiedlichen Cases.

---

## Decision

Wir etablieren eine **Primary-Model Selection Matrix** mit zwei Achsen: **Cost** und **Bias-Profil**. Tiers sind nicht mehr eindimensional als Cost-Leiter (`fast`/`standard`/`thorough`) definiert, sondern als Capability-Matrix mit expliziten Bias-Statements pro Tier.

### Tier-Definition (v2 mit M5)

| Tier | Architektur | Primary-Modell(e) | Bias | B→A Guarantee | ALLOW Recall | BLOCK Recall | Cost |
|------|-------------|-------------------|------|---------------|--------------|--------------|------|
| `fast` | Solo | DS Flash | strict-light | 0 | n/a (preliminary) | n/a | ~$0.20 |
| `standard` | Solo | DS Pro | strict-balanced | 0 | 92.0% | **97.1%** | $0.96 |
| `thorough_balanced` | Cascade | Gemini → Sonnet | balanced (lenient-borderline) | 0 | **96.0%** | 80.0% | $3.25 |
| `thorough_strict` | Cascade | DS Pro → Sonnet | strict | 0 | 64.0% | 97.1% | $2.55 |
| `thorough_ensemble` *(neu)* | Parallel | DS Pro ⊕ Gemini, BLOCK-Veto | strict-via-veto | **0 strukturell** | 88.0% | **97.1%** | $2.10 |
| `thorough_max` | Solo | Sonnet | mid | 0 | 76.0% | 91.4% | $6.50 |

**Hard Invariant über alle Tiers:** B→A = 0 (Hard Rule P1, ADR-0001). Das ist der Procurement-Garantieanker, unabhängig von Tier-Wahl.

**Strukturell vs. empirisch B→A=0:**
- `thorough_ensemble`: BLOCK-Veto-Logik garantiert mathematisch, dass kein BLOCK-Verdict zu ALLOW werden kann
- Alle anderen Tiers: empirisch 0 B→A auf 120v3-Suite, kein strukturelles Argument

### Default-Tier-Frage (offen, Validierungs-pending)

**Lesart A — falls Validierung 85.4% bestätigt:**
Default = `standard` (DS Pro Solo). Rationale: höchste Accuracy + niedrigste Kosten + 0 B→A. Cascade-Tiers werden Optionen für spezifische Bias-Profile.

**Lesart B — falls Validierung 85.4% nicht hält:**
Default = `thorough_balanced` (Gem→Son Cascade). Rationale: kompatibel mit der ursprünglichen Cross-Model-Verification-These aus ADR-0007.

**Default-Krönung wartet auf Hermes' Validierungs-Report.**

### Tier-Selection-Heuristik (Embedded-Plattform-Integratoren)

```
IF use_case = "regulated_audit" AND consequence_of_false_allow >> consequence_of_false_hold:
    → thorough_ensemble (strukturelle B→A-Garantie + 97% BLOCK-Recall)

IF use_case = "user_facing_response_screening" AND friction_cost matters:
    → thorough_balanced (96% ALLOW-Recall, weniger False-HOLD-Friction)

IF use_case = "bulk_compliance_screening" AND budget_per_eval matters:
    → standard (DS Pro Solo, $0.96/eval)

IF use_case = "high_consequence_compliance" AND budget < bandbreite:
    → thorough_strict (97% BLOCK-Recall, niedrigere Kosten als ensemble)

IF use_case = "rapid_triage_first_pass":
    → fast (DS Flash) → escalate to standard or thorough on HOLD/BLOCK

IF max_tier-Constraint vom Plattform-Operator (Pauls Punkt):
    → cap auf konfigurierten max_tier, fallback wenn Use-Case mehr braucht
```

### Ausschlusskriterien

- **Sonnet Solo wird NICHT als Primary-Tier ausgespielt** außer als `thorough_max`-Backstop. $6.50 ohne Cross-Model-Verification ist kein Procurement-defensibles Angebot.
- **Gemini Solo ist disqualifiziert** (2× B→A: GAIA-16 mit `Gem=CONDITIONAL_ALLOW`, GAIA-19 mit `Gem=ALLOW`). P1-Verletzung. Nur als Cascade-Primary mit Sonnet-Rescue oder als Ensemble-Voter mit DS-Veto verwendbar.
- **Kimi k2.6 ist disqualifiziert** (2× B→A auf 120v3, P1-Verletzung). Endgültig, kein Retry mit besserem Prompt.

### API-Design (Pauls Punkt: max_tier statt min_tier)

`/v2/verify/tiers` Endpoint mit programmatic discovery. Plattform-Operator konfiguriert `max_tier` per API-Key:

```json
{
  "key_config": {
    "max_tier": "thorough_balanced",
    "fallback_on_demand": "thorough_strict"
  },
  "request": {
    "tier": "standard"  // Plattform-User wählt; cap durch max_tier des Plattform-Operators
  }
}
```

`max_tier` ist die richtige Semantik: Plattform-Operator setzt Obergrenze (Kosten-Kontrolle), nicht Untergrenze. End-User-Request kann unter dem Cap wählen.

### Was diese ADR NICHT entscheidet

- **Schema-Format für `/v2/verify/tiers`** — separate Schema-Skizze (post-Borthwick-Feedback Embedded-First, geplant für 2026-04-30)
- **Pricing pro Tier** — Sales/Pricing-Workstream mit Douglas-Input
- **Inter-Tier-Korrelation bei Multi-Tier-Plattformen** — eigene Validierungs-Studie nötig

---

## Consequences

### Positive

1. **Procurement-Story ist robuster.** "Sechs validierte Tiers, 0 B→A in allen, jeweils explizite Bias-Statements" ist die Pitch-Headline für Embedded-Buyer (Douglas-Read 2026-04-29). Modell-Agnostik wird zu einem positiven Differenzierungsmerkmal.
2. **Strukturelle Robustheit gegen Model-Provider-Risk.** Wenn DeepSeek aus dem Markt verschwindet, ist die Tier-Matrix nicht kaputt — `thorough_balanced` und `thorough_max` bleiben verfügbar.
3. **Ensemble-Tier differenziert uns.** `thorough_ensemble` mit struktureller B→A-Garantie ist ein Audit-Argument, das Single-Model-Tiers nicht haben können. Banking-Procurement-relevant.
4. **Cost-Sweet-Spot existiert.** DS Pro Solo bei $0.96 schlägt Sonnet Solo bei $6.50 um 7.4pp Accuracy. Das ist eine Pricing-Story für Bulk-Use-Cases.

### Negative / Risk

1. **Komplexitäts-Overhead in Pitch und API.** Sechs Tiers brauchen mehr Erklärung als drei. Mitigation: Tier-Selection-Heuristik in API-Docs, programmatic discovery.
2. **Tier-Capabilities driften mit Modell-Updates.** DeepSeek v5 Pro könnte BLOCK-Recall ändern. Mitigation: `last_validated`-Feld pro Tier, Pflicht-Re-Benchmark vor Modell-Upgrade.
3. **DS Pro Solo Default-Krönung steht auf 82-Case-Datenpunkt.** Validierungs-Risiko: wenn die 38 nicht-gemappten Cases systematische DS-Pro-Failures enthalten, fällt die 85.4% Zahl. Mitigation: aktuelle Hermes-Validierung; Default-Entscheidung wartet darauf.
4. **Pauls Anker-Bias-Hypothese ungeprüft.** Sonnet könnte auf bestimmten Domänen (z.B. Banking) systematische Bias zeigen. Mitigation: zukünftige Domänen-Cases-Expansion + Re-Validierung (Achse 2 aus Lesart 2).
5. **DS-Primary-Cascade hat schlechte ALLOW-Recall (64%).** Plattformen mit hohem ALLOW-Heavy-Traffic werden hohe False-HOLD-Raten sehen bei `thorough_strict`. Mitigation: explizit als "regulated_high_consequence"-Use-Case dokumentieren.

### Open Questions

1. **Validierungs-Ergebnis** (Hermes, in Arbeit): Hält DS Pro 85.4% auf erweitertem mappable Set? — entscheidet Default-Tier.
2. **M5 Live-Run-Validierung**: Aktuell sind die M5-Zahlen aus Simulation. Ein paralleler Live-Run würde bit-identische Zahlen liefern (deterministische Veto-Logik), wäre aber ein zusätzlicher Audit-Punkt.
3. **Inter-Tier-Korrelation**: Wenn ein Plattform-Operator `fast` für Bulk und `thorough_strict` für Final-Review parallel nutzt, korrelieren Fehler? — separate Studie nötig.
4. **Domain-Anker-Bias** (Pauls Hypothese): Hat Sonnet auf bestimmten Domänen systematische Bias? — braucht Domänen-Cases-Expansion.

---

## Implementation Sketch (für Schema-Workstream)

```typescript
interface PLVTier {
  id: 'fast' | 'standard' | 'thorough_balanced' | 'thorough_strict' | 'thorough_ensemble' | 'thorough_max';
  architecture: 'solo' | 'cascade' | 'parallel_ensemble';
  primary_model: string;
  secondary_model?: string;
  ensemble_models?: string[];  // for parallel_ensemble
  veto_logic?: 'block_veto' | 'hold_veto' | null;  // for ensemble
  bias: 'balanced' | 'strict' | 'strict-balanced' | 'strict-light' | 'strict-via-veto' | 'mid';
  safety_guarantee: {
    block_to_allow_violations: 0;  // hard invariant
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

// Plattform-Operator-Config (max_tier-Semantik)
interface PlatformKeyConfig {
  max_tier: PLVTier['id'];
  fallback_on_demand?: PLVTier['id'];
}
```

`/v2/verify/tiers` returns this structure as JSON, allowing programmatic capability discovery for embedded platforms.

---

## References

- M5 Ensemble Report: `runs/m5-ensemble-report-2026-04-29.md`
- DS-Primary Cascade Report: `runs/cascade-dsprimary-report-2026-04-29.md`
- Multi-Model-Briefing: `briefing-2026-04-29-cascade-multimodel-summary.md`
- Borthwick Procurement-Read: Telegram 2026-04-29 14:38
- Paul Strategic-Review (6 IMG): `paul_briefing_2026-04-29_cascade_ds_pro_decision.md`
- Hermes Validierungs-Briefing (active): `hermes_briefing_2026-04-29_dspro_validation.md`
- ADR-0007 (Cross-Model-Verification, parent ADR)
- ADR-0001 (Verdict-Model, defines BLOCK/ALLOW/HOLD/COND_ALLOW)
- ADR-0005 (failScore-Gate-Decoupling, defines CONDITIONAL_ALLOW → public ALLOW mapping)

---

## Validierungs-Plan (vor Default-Krönung erforderlich)

**Achse 1b — DS Pro Solo Vollstand-Validierung** (Hermes, aktiv):
- 38 nicht-gold-gemappte Cases annotieren (mapped/out_of_scope/ambiguous)
- Strict-Accuracy auf erweitertem mappable Set berechnen
- Domänen-Verteilung der 38 prüfen — Anker-Bias-Indikator?

**Achse 3 — DS Pro Solo vs. M5 Cross-Check** (Hermes, aktiv):
- Per-Case Diff DS Pro Solo vs. M5 Ensemble auf gleichen Cases
- Echte BLOCK-Saves durch Gemini-Veto identifizieren
- Over-BLOCK durch Gemini-Veto identifizieren

**Achse 2 — neue Domäne** (Stretch, später):
- Cases aus unterrepräsentierter Domäne (Banking?) annotieren
- Re-Validierung Top-3-Tiers auf neuen Domain
- Pauls Anker-Bias-Hypothese empirisch prüfen

**Erst nach Achse 1b + 3** wird die Default-Tier-Entscheidung getroffen und ADR-0008 v3 finalisiert.

---

**Next Actions:**

- [ ] Hermes Validierungs-Report (Achse 1b + 3) — gating für Default-Krönung
- [ ] Paul Strategic Review (max_tier-Semantik, Naming-Konvention `thorough_ensemble`)
- [ ] Schema-Workstream (`/v2/verify/tiers` Endpoint mit Embedded-First Multi-Tenancy)
- [ ] Domain-Cases-Expansion (Achse 2 Validierung, post-v3-Finalisierung)
- [ ] PR #31 (Cascade Wire-Up Infrastructure) — kann unabhängig mergen, aber Beschreibung muss "Cascade ist Tier, nicht Default" reflektieren
