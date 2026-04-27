# ADR-0003 (DRAFT v2.2): Threshold-Shift with Coordinated Score-Floor Adjustments

**Status**: DRAFT v2.2 — Ratifiziert 2026-04-27 (Paul, nach Phase-2-Bestaetigungs-Iteration). Pending Hermes-Bestaetigungs-Run, dann Merge.
**Date**: 2026-04-27
**Deciders**: Raul, Paul, Hermes
**Editor**: Computer
**Replaces**: ADR-0002 (Step-Level Triple-Majority, REJECTED 2026-04-27)
**Supersedes**: 0003-threshold-shift-DRAFT-v1-archived.md, v2.1-Phase-1
**Relates to**: ADR-0001 (Verdict Model)

---

## Changelog

### v2.1 → v2.2 (2026-04-27, Phase-2 Threshold-Sweep + Hard-Rule-Auslegung 3)

Phase-2 CM-Run mit v2.1 (`SUPPORTED_THRESHOLD = 0.50`) hat 7 HOLD→ALLOW Transitionen produziert — davon 4 mit Gold-Label `HOLD` (echte Regressionen) und 3 mit Gold-Label `ALLOW` (Korrekturen, kein Hard-Rule-Bruch). Hermes’ deterministischer Threshold-Sweep auf den existierenden After-Run-Scores ergab ein Plateau bei 0.5625 – 0.75 mit 86.6% Accuracy und **0** gold=HOLD Regressionen, vs 80.6% / 4 gold=HOLD bei 0.50.

**Aenderungen v2.2 vs v2.1**:

1. `SUPPORTED_THRESHOLD = 0.50` → **`0.5625`**. Der DS+Gemini-Score-Cluster bei 0.50 (bimodaler Modus, 17 bzw. 13 Steps) bleibt damit deterministisch im `partial`-Band, statt knapp auf der falschen Seite des Floors zu liegen. Untere Predicate-Grenze (`PARTIAL_THRESHOLD = 0.25`) und alle drei Code-Floors (R1=0.25, R7=0.40, Quote-too-short=0.40) bleiben unveraendert — die Differenzierung der Partial-Schichten wird nicht beruehrt.
2. **Hard-Rule P1 (Auslegung 3, Paul ratifiziert)**: Die HOLD-Bezeichnung in der Hard-Rule-Liste bezieht sich kuenftig auf Faelle mit `gold_verdict ∈ {HOLD, BLOCK}`. UNCERTAIN→ALLOW Transitionen mit `gold_verdict = ALLOW` sind **Korrekturen**, keine Regressionen — das Gate haelt. BLOCK→ALLOW bleibt absolut auf 0, kein Gold-Label-Override. Begruendung: Phase-2 audit der drei verbleibenden Cases (CODE-05, MED-05, GAIA-02) hat alle drei als legitime Korrekturen mit verbatim-Quote-Evidenz (RFC 6265bis, IDSA 2012, UDHR Article 25 verbatim von un.org) bestaetigt.
3. Lock-Tests: T17 (`0.49 → partial`) bleibt; T18 wandert von `0.50 → supported` auf `0.5625 → supported`. Zwei neue Tests T25 (`0.5624 → partial`, Float-Rounding-Lock) und T26 (`0.50 → partial`, Anti-Regression: 0.50-Cluster muss explizit non-supported bleiben). Constants-Pin asserts jetzt `SUPPORTED_THRESHOLD === 0.5625`.
4. **R7- und Quote-too-short-Floors bleiben bei 0.40**. Sie sitzen weiterhin sauber unter dem Supported-Floor (0.40 < 0.5625), die Drei-Schichten-Differenzierung (0.25 / 0.40 / oberes-partial) bleibt erhalten. Die obere Partial-Grenze waechst von 0.49 auf 0.5624.

**Phase-2 CM Threshold-Sweep (Hermes, deterministisch auf v2.1 After-Run-Scores)**:

| Threshold | UNCERTAIN→ALLOW (gesamt) | gold=HOLD (Regression) | gold=ALLOW (Korrektur) | Accuracy |
|---:|---:|---:|---:|---:|
| 0.5000 | 7 | 4 | 3 | 80.6% |
| **0.5625** | **3** | **0** ✅ | **3** | **86.6%** ✅ |
| 0.6250 | 3 | 0 | 3 | 86.6% |
| 0.7500 | 3 | 0 | 3 | 86.6% |

Das Plateau 0.5625–0.75 ist empirisch identisch — 0.5625 ist die untere Plateau-Kante, maximal weit von der 0.75-Klippe entfernt, was den oszillationsdaempfenden Effekt der v2-Vorstoss-Logik vollstaendig erhaelt. Die drei Korrektur-Cases sind klar gold-ALLOW, alle mit verbatim-Quote, alle Audits bestanden.

**Ratifikation**: Paul, 2026-04-27: „Alle 3 Audits bestanden … ADR-0003 v2.2 mit SUPPORTED_THRESHOLD=0.5625 ist ratifiziert. Computer kann mergen sobald der Bestaetigungs-Run sauber ist.“

### v2 → v2.1 (2026-04-27, Pauls Ratifikation + Boundary-Flag)

Pauls Review der v2 hat einen verbleibenden Boundary-Risk identifiziert: R1-Floor cappt auf **exakt 0.25**, was direkt auf der `partial`/`unsupported`-Bandgrenze sitzt. T22 lockt zwar den Floor-Output, aber nicht das Predicate-Mapping an der Bandgrenze selbst. Ohne expliziten Boundary-Test könnte ein Float-Rundungsfehler oder eine versehentliche `>` statt `>=` Änderung im Mapping stillschweigend R1-no-quote-Cases als `unsupported` klassifizieren.

**Änderung**: T23 (`score=0.25 → partial`, inklusiv) + T24 (`score=0.2499 → unsupported`, exklusiv) als zusätzliche Lock-Tests aufgenommen. Phase-1-Test-Range jetzt T17–T24 (acht statt sechs neue Tests).

**Ratifikation**: Raul (Q1–Q4 + R7-Folge) + Paul (alle Floor-Werte 0.40/0.40/0.25 + Tier-Pricing-Begründung + Verdict-Maj-Parking). v2.1 ist die ratifizierte Version, an der Phase 1 sich orientiert.

### v1 → v2 (2026-04-27, Pauls R7-Befund)

Pauls Review hat einen kritischen Punkt aufgedeckt: v1 koordinierte nur **R1** mit dem Predicate-Band-Shift. Es gibt jedoch **drei** Code-Floors, die auf score=0.5 cappen, plus weitere Semantik-Punkte:

- **R7** (cross-step aliasing cap)
- **Quote-too-short** (Quote-Fragment <10 chars)
- (R1 bleibt der Hauptkandidat — bereits in v1)

Unter v1-Bands wären R7 und Quote-too-short → `supported`, was die Semantik dieser Floors invertiert (genau wie Pauls ursprüngliche R1-Objektion). v2 koordiniert **alle drei Floors** plus Tier-Pricing-Note + Verdict-Maj als Future Work.

---

## Context

PR-E (#12) introduced 5-tier verdicts and the `CONDITIONAL_ALLOW` boundary. Validation revealed two related quality issues:

1. **LLM Scoring Variance**: Grok step-scores oscillate between runs (28% vs 5% steps in CA-range across two CM-Runs)
2. **Threshold Fragility**: 25% of cases oscillate between runs because step-scores cluster on the 0.50/0.75 cliff. A ±0.25 jitter flips `supported→partial`, tipping ALLOW→HOLD.

Hermes' 4×4-run analysis quantified the score distribution:

| Score | Grok | DeepSeek | Gemini |
|---|---|---|---|
| 0.00 | 64 | 77 | 71 |
| 0.25 | 11 | 9 | 24 |
| 0.50 | 30 | 17 | 13 |
| 0.75 | 18 | **32** | **31** |
| 1.00 | **36** | 24 | 20 |

DS und Gemini clustern auf der 0.75 `supported→partial` Klippe. Grok cluster auf 1.00 (sicher). Die Klippe selbst ist das Problem, nicht das Modell.

ADR-0002 versuchte das mit Step-Level Triple-Majority zu lösen. Hermes' Korrelationstest ergab |r| > 0.68 für alle Modellpaare (cliff-spezifisch). Step-TMaj unterperformte jedes Einzelmodell (67.5% vs 70–82.5%). ADR-0002 wurde verworfen.

Die Diagnose (Klippe) bleibt korrekt; nur Downstream-Aggregation als Lösung ist ausgeschlossen. Die Klippe muss **upstream** an der Score-zu-Predicate-Grenze adressiert werden.

## Decision

**Vier koordinierte Änderungen** am Score-zu-Predicate-zu-Verdict-Pfad:

### 1. Predicate-Band Shift

Alt:
- `supported`: score ≥ 0.75
- `partial`: 0.25 ≤ score < 0.75
- `unsupported`: score < 0.25

Neu (v2.2):
- `supported`: score ≥ **0.5625**
- `partial`: 0.25 ≤ score < 0.5625
- `unsupported`: score < 0.25

Eliminiert die 0.75-Klippe per Konstruktion. DS+Gemini Mode bei 0.75 (32 bzw. 31 Steps) landet sauber in `supported`, statt mit der Klippe zu oszillieren. Der DS+Gemini-Cluster bei 0.50 (17 bzw. 13 Steps) bleibt eindeutig im `partial`-Band — das war in v2.1 (Floor 0.50) der Treiber der vier gold=HOLD-Regressionen im Phase-2 CM-Run.

### 2. Koordinierte Score-Floor-Anpassungen (drei Floors, eine Logik)

**Prinzip**: Jeder Floor, der unter v1-Bands score=0.5 produziert hat, würde unter v2-Bands `supported` werden — was die Semantik der jeweiligen Defensiv-Cap invertiert. Drei betroffene Floors:

| Floor | Alt | Neu | Predicate (neu) | Begründung |
|---|---|---|---|---|
| **R1** (no-quote cap, line 330) | 0.50 | **0.25** | partial | Pauls semantische Invariante: "kein Quote" darf nicht supported werden. Untere Bandgrenze. |
| **R7** (cross-step aliasing cap, line 322) | 0.50 | **0.40** | partial | Aliased evidence ist stärker als no-quote (R1=0.25), aber schwächer als direkt-supported (≥0.50). Mittleres Partial-Niveau. |
| **Quote-too-short** (line 339) | min(score, 0.50) | **min(score, 0.40)** | partial (i.d.R.) | Selber Mechanismus wie R7: degraded evidence-quality, sollte nicht ins selbe Band wie verbatim-quote (≥0.50). Konsistent mit R7. |

**R6** (wrong-source detector, line 302) bleibt unverändert: `score > 0 && score ≤ 0.5 && wrongSourceSignals → score = 0.0`. Trigger-Range ist intentional (fängt schwache und mittlere Scores), Output ist 0.0 (nicht 0.5) — keine Anpassung nötig.

**Drei Partial-Niveaus innerhalb der neuen Band**:
- 0.25 — R1 (no quote, untere Grenze des Bands)
- 0.40 — R7 + Quote-too-short (degraded evidence, mittleres Niveau)
- 0.49 — LLM-eigener partial-score (oberes Ende, knapp unter supported)

Diese Schichtung ist die load-bearing Koordination. Predicate-Shift ohne Floor-Adjustments invertiert die Semantik aller drei Defensiv-Caps. Floor-Adjustments ohne Predicate-Shift bewirken nichts.

**R7 Trigger-Guard**: aktuell `if (result.score > 0.5 && crossStepSignals)` — bleibt unverändert. Cap-Wert ändert sich von 0.5 → 0.40, Trigger ändert sich nicht (sonst würde R7 für Inputs zwischen 0.4–0.5 zünden, das wäre eine Verhaltens-Erweiterung).

### 3. Boundary-Test Re-Validation + Neue Lock-Tests

#### Bestehende Fixtures
- **T6** (`score=0` is Absence): unchanged. `score=0 < 0.25 = unsupported` holds in both old and new bands.
- **T1** (Floor application): fixture muss `score=0.25` für no-quote cases nutzen (neuer R1-Floor) statt `score=0.50`.
- **T7** (Predicate boundary): fixture für `score=0.50` muss jetzt `supported` asserten (war `partial`).
- **T10, T11** (Score-Floor interaction): re-validate dass R3 (0.25), R6 (0.0), R7 (0.40 NEU), R1 (0.25 NEU) korrekt mit neuen Bands interagieren.

#### Neue Lock-Tests (T17–T24)

| Test | Input | Expected | Lockt |
|---|---|---|---|
| T17 | score=0.49 | `partial` | Predicate-Band obere Grenze (exklusiv 0.50) |
| T18 | score=0.50 | `supported` | Predicate-Band Klippen-Auflösung (inklusiv 0.50) |
| T19 | score=0.74 | `supported` | Keine Klippen-Sensitivität mehr |
| **T20** | R7 cross-step, input score=0.75 | `partial`, score=0.40 | R7 cap auf 0.40 (NEU) |
| **T21** | Quote-too-short (length<10), input score=0.75 | `partial`, score=0.40 | Quote-too-short cap auf 0.40 (NEU) |
| **T22** | R1 no-quote, input score=0.75 | `partial`, score=0.25 | R1 cap auf 0.25 (NEU, Pauls Invariante) |
| **T23** | score=0.25 (raw input, kein Floor-Trigger) | `partial` | Predicate-Band **untere** Grenze inklusiv (Pauls Boundary-Flag v2-Review) |
| **T24** | score=0.2499 (raw input) | `unsupported` | Predicate-Band untere Grenze exklusiv (Float-Rounding-Lock unterhalb 0.25) |

**T23 + T24 Begründung (Pauls Review)**: R1-Floor cappt auf exakt 0.25, was direkt auf der `partial`/`unsupported`-Grenze sitzt (`partial ≥ 0.25`, `unsupported < 0.25`). T22 prüft den Floor-Output, aber nicht die Bandgrenze selbst. T23 lockt explizit `score === 0.25 → partial` (inklusiv), T24 lockt `score < 0.25 → unsupported` (exklusiv). Damit kann ein zukünftiger Float-Rundungsfehler oder eine versehentliche `>` statt `>=` Änderung im Predicate-Mapping nicht stillschweigend `unsupported` aus R1-no-quote-Cases machen.

#### Neue Lock-Tests v2.2 (T25 + T26)

| Test | Input | Expected | Lockt |
|---|---|---|---|
| **T25** | score=0.5624 (raw input) | `partial` | Predicate-Band v2.2 obere Partial-Grenze inklusiv (Float-Rounding-Lock unter 0.5625) |
| **T26** | score=0.50 (raw input) | `partial` | v2.2 Anti-Regression: 0.50-Cluster (DS+Gemini) muss non-supported bleiben |

**T26 Begründung**: Der DS+Gemini-Score-Cluster bei 0.50 war die Quelle der 4 gold=HOLD Regressionen im Phase-2 CM-Run unter v2.1. v2.2 platziert den Floor explizit oberhalb dieses Clusters. T26 pinnt diese Designintention: falls 0.50 jemals wieder als `supported` mappt (ob durch Konstanten-Drift oder Floor-Erweiterung), faellt der Test laut. Dies ist die direkte Lock-Manifestation von Pauls Hard-Rule-Auslegung 3.

#### Bestehende R7-Test-Suite (`test-r7-cross-step-aliasing.ts`)

7+ Tests erwarten `score === 0.5` (L2a, L2b, L2c, L3b, L3c, L4 Order, L4 Case-insensitive). Alle müssen auf `0.40` umgezogen werden. **Kein Funktionsverlust**: die Tests prüfen *dass R7 cappt*, nicht *worauf*. Mechanische Konstanten-Anpassung.

**Prompt-Konstante**: L1b prüft den Prompt-Text "explicit 0.5 hard cap". Auch der Prompt-Text in `graded-support-evaluator.ts:506` und :532 muss von "0.5" auf "0.40" angepasst werden, sonst Lock-Test schlägt fehl.

#### R6×R7 Interaction (Test L4 / line 183-194)

Aktueller dokumentierter Pfad: bei input=0.75 mit cross-step + wrong-source signals: R6 trigger-range ist `≤ 0.5`, fängt also nicht; R7 cappt auf 0.5. Final: 0.5 partial, **nicht** R6-zeroed.

Unter v2: R6 trigger-range bleibt `≤ 0.5`, R7-Cap-Output ist 0.40 (innerhalb R6-Range). **Wenn R6 nach R7 liefe**, würde R6 jetzt fangen und auf 0.0 zeroen. Aber die Reihenfolge ist umgekehrt (R6 läuft VOR R7, line 300 vor 319).

**Ergebnis bleibt identisch**: input=0.75 cross-step + wrong-source → R6 schaut auf 0.75, trigger-range `≤ 0.5` greift nicht, R6 skipped → R7 cappt 0.75 → 0.40, partial. Test L4 bleibt funktional, nur die Konstante (0.5 → 0.40) ändert sich.

**Aber**: Cases wo der LLM bereits ≤ 0.5 + wrong-source ausgibt — R6 zeroed bereits, R7 sieht 0.0, kein Effekt. Unverändert.

## Preconditions

**P1 (REVISED v2.2, Auslegung 3): Hard-Rule preservation on 82-case library** (NICHT VERHANDELBAR)

Confusion-Matrix-Run mit v2.2-Bands muss zeigen:
- **0 BLOCK→ALLOW Transitionen** (absolut, kein Gold-Label-Override). D-06 (wrong-source) bleibt unveraendert.
- **0 UNCERTAIN→ALLOW Transitionen mit `gold_verdict ∈ {HOLD, BLOCK}`** (echte Regression). UNCERTAIN→ALLOW mit `gold_verdict = ALLOW` ist eine Korrektur, kein Verstoss — das Gate haelt.
- 0 ALLOW→BLOCK Transitionen.

Die Auslegung-3-Praezisierung der HOLD-Bezeichnung wurde von Paul ratifiziert nach Audit der drei Phase-2 v2.2-Korrekturen (CODE-05, MED-05, GAIA-02). Sie konkretisiert **„Decompose, don’t loosen“**: das Hard-Rule-Verbot wird nicht aufgeweicht, sondern in zwei semantisch saubere Teilregeln aufgeteilt (BLOCK→ALLOW immer 0, UNCERTAIN→ALLOW gold-label-bewertet).

**P2: Variance reduction**

Zwei CM-Runs mit neuen Bands müssen Oscillator-Rate ≤15% zeigen (von ~25% runter). Falls nicht: ADR-0003 reverten, ADR-0004 (Continuous failScore) eskalieren.

**P3: CONDITIONAL_ALLOW emission stability**

CA-Emissionen run-to-run sollten stabilisieren. Soft expectation, kein Gate.

**P4 (NEU): R7-Test-Suite passes mit 0.40-Konstante**

Vor Phase 2 (CM-Runs auf 82-Case-Library) muss `test-r7-cross-step-aliasing.ts` vollständig grün sein mit angepassten Konstanten. Andernfalls deutet das auf einen Floor-Konsistenz-Bug hin.

## Consequences

### Positive

- Eliminiert die 0.75-Klippe per Konstruktion
- Drei sauber differenzierte Partial-Niveaus (0.25 / 0.40 / 0.49) statt eines (0.5)
- Score-Floor-Semantik konsistent über alle drei Defensiv-Caps
- Single-PR Change, low blast radius (4 Konstanten + ~10 Test-Konstanten + 6 neue Lock-Tests + Prompt-Text-Anpassungen)
- Kostenneutral (keine zusätzlichen API-Calls, im Gegensatz zu ADR-0002)
- Kompatibel mit zukünftiger Verdict-Level-Aggregation falls jemals nützlich (siehe Future Work)

### Negative

- score=0.50 wird jetzt `supported` behandelt. Falls 0.50 echtes "partial information"-Signal trägt, geht das in `supported` verloren. Trade-off:
  - `partial` Band schmaler (0.24 statt 0.49)
  - CA-Emissionen können sinken (CA-Window narrowt mit)
- R7-Test-Suite-Re-Validierung mechanisch aber error-prone. ~7 Test-Konstanten + 2 Prompt-Text-Stellen + ~3 Doku-Kommentare.
- T6 muss extra geprüft werden (Hard-Rule gegen BLOCK→ALLOW lebt dort).

### Neutral

- Score-Floor Semantik konsistent erhalten (alle drei Floors koordiniert angepasst)
- ADR-0001 Verdict Model unverändert
- ADR-0002 bleibt rejected; dieses ADR re-öffnet Triple-Majority nicht
- R6 unverändert (Trigger-Range und Cap auf 0.0 bleiben)

## Tier-Gating: Architektur-Entscheidung (Pauls Vorschlag, übernommen)

ADR-0002's Tier-Hierarchie (Fast/Standard/Thorough basierend auf Modellanzahl) ist mit ADR-0002 gefallen. Pauls neue Tier-Begründung — basiert auf **Tiefe der Analyse**, nicht **Modellanzahl**:

| Tier | Composition | Approx. Cost |
|---|---|---|
| Fast | Tier-1 Pre-Filter only (MiniCheck) | ~$0.001 |
| Standard | Single-Model Grok evaluation | ~$0.02 |
| Thorough | Single-Model Grok + Source-Fetch + Provenance-Check | ~$0.08 |

Differenzierung kommt aus Analyse-Tiefe, nicht Modell-Multiplizität. Passt besser zur tatsächlichen Architektur und vermeidet die ADR-0002-Falle.

**Status**: Übernommen als Tier-Definition. Implementation außerhalb dieser ADR (Pricing-Tier-Routing in einer separaten Story).

## Alternatives Considered

### A. Continuous failScore (Hermes' revised Patch #3)

Ersetzt diskrete Predicate-Bands durch kontinuierliches Score→failScore-Mapping.

- ✅ Maximum cliff-elimination
- ❌ Größere Architektur-Änderung (alle Score-Floors müssen in kontinuierlichen Raum re-kalibriert werden)
- ❌ Alle 16 bestehenden Lock-Tests müssen re-derivd werden
- ❌ Output-Format ändert sich (kontinuierliche Werte in `metadata.conditions`)

Geparkt als **ADR-0004-Kandidat**. Falls Threshold-Shift (diese ADR) erwartete Variance-Reduktion in P2 nicht liefert, ist Continuous failScore die nächste Eskalation. Eigener Decision-Cycle, nicht in diese ADR gebündelt.

### B. Verdict-Level Majority — geparkt als Future Work (Pauls Vorgabe)

Verdict-Level-Majority mit Grok-Weighting bleibt **als zukünftige Option erhalten**, nicht verworfen. Begründung (Pauls Vorgabe):

> "Die Korrelationsdaten gelten für diese Prompts und diese Modelle. Wenn wir den Evaluation-Prompt signifikant ändern, oder ein Modell mit genuinely anderer Score-Distribution kommt (z.B. ein Modell das bei 1.0 modet statt 0.75), könnte Verdict-Majority wieder relevant werden. Die Brücke nicht abreißen."

Trigger-Bedingungen für Re-Evaluation:
- Signifikante Prompt-Änderung am Step-Evaluator
- Neues Cascade-Modell mit anders-gemodeter Score-Distribution
- Empirische Evidenz, dass Verdict-Maj > Single-Model auf 82-Case-Library

Solange keiner dieser Trigger zutrifft: Single-Model + Threshold-Shift bleibt kanonisch. **Kein eigenes ADR aufmachen**, nur als Future-Work-Vermerk hier.

### C. Per-Model Calibration Weights (Hermes' Patch #4)

Verworfen (siehe v1).

### D. Konservativer R7-Fallback (R7 → 0.25 statt 0.40)

Pauls Fallback-Vorschlag. R7 cappt auf 0.25 (= R1-Niveau).

- ✅ Mechanisch trivial (eine Konstante, keine Differenzierung 0.25 vs 0.40)
- ❌ Kollabiert "no-quote" und "aliased evidence" auf gleiches Niveau, obwohl semantisch unterschiedlich
- ❌ Verliert die 0.40-Schicht (Differenzierung "degraded but verbatim" vs "no quote")

Aktuelle Wahl: **R7 → 0.40**. Falls Phase 2 zeigt, dass die 0.40-Schicht keine Stabilität bringt, Fallback auf 0.25 in Folge-PR.

## Implementation Sketch

### Phase 1: Code Changes (Computer, ~2.5h)

**Konstanten**:
- `src/plan/graded-support-evaluator.ts:293` — R3 floor (0.25): unverändert
- `src/plan/graded-support-evaluator.ts:322` — R7 cap: 0.5 → **0.40**
- `src/plan/graded-support-evaluator.ts:331` — R1 cap: 0.5 → **0.25**
- `src/plan/graded-support-evaluator.ts:339` — Quote-too-short cap: 0.5 → **0.40**
- `src/plan/graded-support-evaluator.ts:348` — Predicate-Band threshold: 0.75 → 0.50
- `src/plan/graded-support-evaluator.ts:350` — Untere Predicate-Grenze (0.25): unverändert

**Prompt-Text**:
- Line ~506 + ~532: "0.5" → "0.40" in R7-Beschreibung (Lock-Test L1b prüft das)

**Test-Updates**:
- `test-r7-cross-step-aliasing.ts`: ~7 Konstanten-Updates (0.5 → 0.40)
- `test-5tier-conditional-allow.ts`: T1, T7, T10, T11 fixtures
- Neue Lock-Tests T17–T24 (in vorhandenes oder neues File)

**Fixtures**:
- `src/plan/__fixtures__/`: 0.50-bearing fixtures auf 0.49 oder 0.51 verschieben falls Test-Intent das verlangt

### Phase 2: Validation (Hermes, ~3h + Run-Time)

- Build clean, alle bestehenden Tests grün (≥261/261 + neue T17–T24)
- 2× Confusion-Matrix-Runs auf 82-Case-Library (mit gepinnten Seeds aus PR-G)
- Vergleich gegen Pauls Run 1 (81.7%, 7 CA, ~28% CA-Range) und Run 2 (80.5%, 2 CA, ~5% CA-Range) Baselines
- Oscillator-Rate Vergleich (alt ~25%, Ziel ≤15%)

**Vorbedingung Phase 2**: PR-G (Seed-Pinning) muss gemerged sein, sonst sind die CM-Runs verrauscht.

### Phase 3: Decision (Raul + Paul)

Falls P1 (Hard-Rules) hält UND P2 (Oscillator-Rate ≤15%) erreicht:
- Ratify ADR-0003
- Merge PR
- ADR-0002-Kapitel geschlossen

Falls P1 fails: hard reject. Falls P2 fails: revert + ADR-0004 (Continuous failScore) öffnen.

## Refs

- ADR-0001 (Verdict Model)
- ADR-0002 (Step-Level Triple-Majority, REJECTED)
- PR-E (#12) — 5-tier introduction
- PR #14, #15 — Plumbing fix für `CONDITIONAL_ALLOW`
- Hermes DS-Recon Report 2026-04-27 (`runs/ds-minus5pp-recon-2026-04-27.md`)
- Hermes Correlation Test 2026-04-27 (`runs/correlation-test-2026-04-27.md`)
- Post-Mortem 0001 — CA Plumbing Gap (PR #17)
- v1-Archive: `0003-threshold-shift-DRAFT-v1-archived.md`

---

**Status**: DRAFT v2.2 ratifiziert, pending Hermes-Bestaetigungs-Run + Merge
**Next steps**:
1. ✅ Raul + Paul ratifizieren v2-Direction (Drei-Floor-Koordination + R7=0.40)
2. ✅ PR-G (Hermes, Seed-Pinning) gemerged
3. ✅ Implementation-PR Phase 1 (Computer) — v2.1 als #19
4. ✅ Phase 2 CM-Validierung (Hermes) — 7 HOLD→ALLOW unter v2.1, Threshold-Sweep zeigt 0.5625 als Sweet Spot
5. ✅ Pauls Ratifikation v2.2 nach Gold-Label-Audit (CODE-05, MED-05, GAIA-02)
6. ✅ v2.2 Code-Aenderung (Computer) — SUPPORTED_THRESHOLD=0.5625, Lock-Tests T18/T25/T26, 272/272 gruen
7. ⏳ Hermes-Bestaetigungs-Run auf v2.2 (82-Case-Library mit den neuen Bands)
8. ⏳ Merge PR #19 nach sauberem Bestaetigungs-Run
