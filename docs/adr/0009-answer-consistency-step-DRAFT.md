# ADR-0009: Answer-Consistency-Step (Trace↔Answer-Faithfulness)

**Status:** PROPOSED → ACCEPTED nach v3-Suite-Run zeigt ≥12/16 HOLD-Erkennung
**Date:** 2026-04-28
**Authors:** Computer, Hermes (M4)
**Related:** ADR-0001 (Verdict-Model), ADR-0007 (Cross-Model Verification — DRAFT v2), ADR-0008 (RAG-Layer — entfällt)

---

## Context

### Empirischer Befund H4 (bestätigt 2026-04-28)

Auf der `plv_cases_expansion_38` Test-Suite zeigte sich nach mehreren Iterationen
(v1, v1.1, v2) ein konstantes Muster bei 16 der HOLD-Cases:

- **HOLD-Erkennung: 0/16** über drei Modelle hinweg (Sonnet 4.5, Gemini 2.5 Pro, DeepSeek V3.2).
- v2-Run (nach Case-Fixes): Verteilung verschob sich von ALLOW→UNCERTAIN
  (Sonnet 8→4 ALLOW, Gemini 9→3 ALLOW), aber **kein** Case erreichte HOLD.
- Konflikt-Analyse zwischen Trace und Answer:
  - **AML-01:** Trace `"$5k for transactions involving identified suspects, $25k otherwise"`
    → Answer `"$5k regardless of amount"` (Threshold-Conflation).
  - **CYBER-02:** Trace `"13 immediately mandatory + 51 future-dated requirements"`
    → Answer `"all 64 became mandatory March 31 2024"` (Phase-Collapse).

### Mechanismus

Der Agent **recherchiert korrekt** (Trace zeigt differenzierte Information),
**synthetisiert aber falsch** (Answer kollabiert die Differenzierung).
Der Evaluator schaut heute **ausschließlich auf `trace_steps`** — die Trace ist
faithful, also befindet er korrekt: alle Steps unterstützt → ALLOW.

Der Evaluator hat keine Möglichkeit, den **Trace↔Answer-Gap** zu sehen,
weil das Schema keinen Step-Typ kennt, der explizit gegen `answer` evaluiert.

### Architektur-Optionen (verworfen)

- **Option A (Threshold-Tuning):** verworfen, weil das Symptom (Verdict-Verteilung)
  nicht die Ursache (Evaluator schaut am falschen Ort) adressiert.
- **Option B (Pipeline-Pass nach Tier-2):** ein zusätzlicher LLM-Call, der Trace+Answer
  separat auf Konsistenz prüft. Verworfen wegen Verdoppelung der Pipeline-Komplexität
  und unklarem Aggregations-Verhalten gegenüber `gold_plan_steps`.
- **ADR-0008 (RAG-Layer):** für H4 nicht erforderlich — der Trace enthält die korrekte
  Information bereits, RAG würde am Mechanismus nichts ändern. ADR-0008 entfällt
  endgültig.

---

## Decision

**Option C: Erweiterung des `GoldStep`-Schemas um ein Feld `step_type`** mit zwei
Werten:

- `'trace_evidence'` (Default, Backward-Kompat): Step wird gegen `item.trace_steps` evaluiert (heutiges Verhalten).
- `'answer_consistency'`: Step wird gegen `item.answer` evaluiert.

### Implementation: Variante 2 (1 LLM-Call, per-Step EVIDENCE_SOURCE)

Statt zwei separate LLM-Calls (Variante 1) wird **ein** Call genutzt, der
beide Quellen im Prompt zeigt (`TRACE EXCERPT` und `AGENT ANSWER` waren ohnehin
schon im Tier-2-Prompt) und pro Step einen `EVIDENCE_SOURCE: trace|answer`-Marker
führt. Der System-Prompt wurde um eine explizite Routing-Anweisung ergänzt:

> "Each gold step has an `EVIDENCE_SOURCE`: evaluate `trace`-sourced steps
> against the TRACE EXCERPT, and `answer`-sourced steps against the AGENT ANSWER.
> Quotes MUST come from the section the step's EVIDENCE_SOURCE points to."

OQ2 (Hermes 2026-04-28): Variante 2 bestätigt.

### Tier-1-Routing

`answer_consistency`-Steps werden **immer auf Tier-2 geroutet**. Tier-1 (Ollama,
binärer Klassifizierer auf `trace_steps`) ist semantisch ungeeignet für
Conflation/Distortion-Erkennung im Answer und würde die Quelle ohnehin nicht
sehen. Implementiert via Filter in `evaluateItem` vor `tier1PreScreen`.

### Provenance-Routing (kritisch)

`verifyProvenance` und `applyScoreFloors` bekommen die Evidence-Quelle **per Step**
über den Helper `resolveEvidenceSource(item, step)`:

- `step.step_type === 'answer_consistency'` → `item.answer`
- sonst → `item.trace_steps` (Default)

Ohne dieses Routing würde jede Quote eines `answer_consistency`-Steps
`PROV_FAIL_02` (substring not in evidence) auslösen, weil die Quote aus `answer`
kommt, aber der Provenance-Check gegen `trace_steps` läuft. Genau dieser Bug war
in Hermes' Scope-Schätzung (~20 Zeilen) übersehen.

---

## Consequences

### Positiv

- **Direkter Fix für H4:** der Evaluator sieht jetzt den Trace↔Answer-Gap explizit
  pro Step, anstatt ihn implizit zu ignorieren.
- **Kein Breaking Change:** `step_type` ist optional mit Default `'trace_evidence'`.
  Alle 1.247 bestehenden Cases bleiben unberührt.
- **Cascade-orthogonal:** ADR-0007 (Cross-Model Verification, PR #27) wird nicht
  beeinflusst — beide Mechanismen können parallel laufen, addieren sich aber
  nicht (Cascade prüft Modell-Übereinstimmung, Answer-Consistency prüft
  Trace↔Answer-Gap).
- **Kein neuer Pipeline-Pass, kein RAG, keine Schema-Migration auf PlanRecord-Ebene.**
- **ADR-0008 (RAG-Layer) entfällt endgültig.**

### Negativ / Trade-offs

- **Tier-1-Skip erhöht Cost** für Cases mit `answer_consistency`-Steps, weil
  diese Steps direkt auf Tier-2 gehen. Da kritische Steps in der Default-Policy
  ohnehin immer auf Tier-2 laufen, ist die Mehrbelastung gering (Faktor <1.1
  bei aktuellen Banking-Cases).
- **System-Prompt-Komplexität +1 Routing-Regel.** Risiko: Modell verwechselt
  Quellen. Mitigation: v3-Suite-Run mit Sonnet als ersten Test; bei
  Verwechslungsrate >5% Fallback auf Variante 1 (zwei separate Calls).
- **16 case-spezifische `acceptance_criterion`-Texte** sind redaktionelle Arbeit
  (Hermes erledigt 2026-04-28).

### Neutral

- **Plan-Schema (`src/plan/types.ts`) bleibt unberührt.** Eingriff nur im Evaluator.
- **Backward-Kompat:** alle 22 nicht-HOLD-Cases der `plv_cases_expansion_38`-Suite
  behalten ihre `gold_plan_steps` unverändert.

---

## Implementation Notes

| Datei | Änderung | Zeilen |
|---|---|---|
| `src/plan/graded-support-evaluator.ts` | `GoldStepType` + `GoldStep.step_type` | +5 |
| `src/plan/graded-support-evaluator.ts` | `resolveEvidenceSource()` Helper | +3 |
| `src/plan/graded-support-evaluator.ts` | System-Prompt + per-Step EVIDENCE_SOURCE | +8 |
| `src/plan/graded-support-evaluator.ts` | Tier-1-Skip Filter | +5 |
| `src/plan/graded-support-evaluator.ts` | Provenance-Routing (verify + scoreFloors) | +15 |
| `src/plan/__tests__/graded-support-evaluator.test.ts` | 5 neue Tests | +60 |
| `plv_cases_expansion_38_v3.json` (neu) | 16 Cases mit appendiertem Step | +~250 (16 × ~15 Zeilen) |

**Production-Code: ~36 Zeilen** (untere Grenze des Scope-Estimates).

### Test-Erwartung v3-Suite

| Resultat | HOLD-Erkennung | Aktion |
|---|---|---|
| Grün | ≥12/16 | ADR-0009 PROPOSED → ACCEPTED, PR mergen |
| Gelb | 8–11/16 | Re-Review der `acceptance_criterion`-Texte mit Hermes; ggf. zweite Iteration |
| Rot | <8/16 | Re-Eröffnung Architektur-Debatte; Variante 1 (zwei Calls) als Fallback; im Worst Case Option B (Pipeline-Pass) |

### Cases-Migration v2 → v3

Hermes lieferte 16 `acceptance_criterion`-Texte (2026-04-28). Generator-Skript
`build_v3_cases.py` appendet je einen Step ans Ende von `gold_plan_steps`. Audit
zeigt: alle 16 Cases haben step_type=answer_consistency und criticality=critical,
mit case-spezifischem Faithfulness-Test plus Negativ-Marker
(z.B. "stating '$5k regardless of amount' = unfaithful synthesis").

---

## Open Questions (zum PR-Review)

| # | Frage | Status |
|---|---|---|
| **OQ1** | ADR-0009 auf PROPOSED stehen lassen bis v3-Resultate da sind? | **Ja** — gleiche Disziplin wie ADR-0007 |
| **OQ2** | Variante 1 (zwei Calls) oder Variante 2 (ein Call mit Routing)? | **Variante 2** (Hermes-bestätigt 2026-04-28) |
| **OQ3** | Pflicht für alle neuen Cases, oder nur Banking-Tier? | Optional, aber für Banking-Tier dringend empfohlen. Im Case-Authoring-Guide festzuhalten (Follow-up-Issue). |

---

## References

- Hermes' H4-Diagnose (2026-04-28): `answer-consistency-analysis-2026-04-28.txt`
- Computer Scope-Estimate (2026-04-28): `answer_consistency_step_scope_2026-04-28.md`
- Hermes' 16 acceptance_criterion-Texte (2026-04-28): `answer-consistency-criteria-16.txt`
- v3-Cases: `plv_cases_expansion_38_v3.json` (38 Cases, davon 16 mit answer_consistency-Step)

---

**Status-Promotion erfolgt nach erfolgreicher v3-Suite-Run-Beobachtung in einem Follow-up-Commit auf diesen PR.**
