# Mode 2 Paraphrase-Toleranz — Design-Skizze

**Status:** Referenz-Dokument. Aktueller Stand: Mode 2 nicht im Scope.
Voraussetzungen für Re-Evaluation in §5 dokumentiert.
**Autoren:** Computer + Paul (ThoughtProof PLV-Team)
**Datum:** 2026-04-26
**Bezug:** Follow-up zu PR #5 (`a3ff0be`), Mode-2-Open-Question.
Gemerged via separater docs-PR nach abgeschlossener Diskussion.

---

## 1. Kontext und Ausgangsfrage

PR #5 hat Mode 1 (Tokenization) und Mode 3 (Structural-Unwrap) gefixt.
Mode 2 (Paraphrase) wurde **bewusst nicht** angefasst. D-05 bleibt
deshalb HOLD — der Matcher rejected die paraphrasierte Quote korrekt
(`PROV_FAIL_02`).

**Frage**, die diese Skizze beantwortet, ohne sie zu bejahen:
"Was würde Paraphrase-Toleranz technisch und semantisch kosten,
und an welchem Lock würde sie zuerst brechen?"

**Hard-Vorgabe** (User, foundational): „Decompose, don't loosen."
Diese Skizze geht **bewusst** nicht den Weg „macht den Matcher
fuzzy genug, dass D-05 grün wird". Sie zerlegt stattdessen, was
unter „Paraphrase" eigentlich subsumiert wird, und zeigt pro
Sub-Kategorie das jeweilige Lock-Risiko.

---

## 2. Problem-Definition: Was ist „Paraphrase" überhaupt?

Aus den 40 Cases (Sample-SHA256 `92ec87e4…`) und CODE-05 step_3 + D-05
step_3 lassen sich mindestens **vier** Sub-Modi extrahieren, die heute
alle als „Mode 2" zusammengefasst werden:

### 2a) Lexikalische Substitution (synonym swap)

> Source: "no more than 2,300 mg of sodium per day"
> LLM-Quote: "less than 2,300 mg of sodium daily"

`no more than` → `less than`, `per day` → `daily`. Semantisch fast
identisch, lexikalisch fremd. **Risiko**: niedrig wenn Zahlen/Entitäten
verbatim, hoch sobald Modifikatoren mitwandern (`up to` ↔ `less than`).

### 2b) Wortreihenfolge / syntaktische Umstellung

> Source: "Lax allows top-level GET navigation"
> LLM-Quote: "GET navigation at top-level is allowed by Lax"

Selbe Wörter, andere Anordnung. **Risiko**: Polaritätsumkehr durch
geänderte Skopen ist möglich (`A allows B` ≠ `A is allowed by B` in
Kontext).

### 2c) Aggregation / Komprimierung (Ellipsis)

> Source: "Strict prevents sending cookies on cross-site requests
>          entirely (highest security against CSRF)"
> LLM-Quote: "Strict prevents cross-site cookies … highest CSRF security"

Mit oder ohne Ellipsis-Marker. **Risiko**: Unter „…" kann beliebiger
Inhalt verschwinden — auch Negationen, Bedingungen, Quellenangaben.

### 2d) Halluzinatorische Anreicherung (verbose paraphrase)

> Source: "AHA recommends no more than 2,300 mg sodium per day"
> LLM-Quote: "The AHA strongly recommends limiting sodium to 2,300 mg
>            per day to reduce cardiovascular risk"

Quelle hat „strongly" und „cardiovascular risk" **nicht**. **Risiko**:
sehr hoch — das ist genau das Halluzinations-Symptom, das PLV
detektieren soll.

**Insight**: 2a und 2b sind oft harmlos, 2c und 2d zerstören
Provenance-Garantien. Eine pauschale „Paraphrase-Toleranz" wäre
genau die falsche Granularität.

---

## 3. Lock-Inventar — was muss erhalten bleiben

| Lock | Quelle | Bricht bei welcher Paraphrase-Toleranz zuerst? |
|---|---|---|
| **D-06 wrong-source (R6 floor)** | `graded-support-evaluator.ts:285-290` | 2c + 2d: wenn LLM aus Blog A paraphrasiert statt Primary B, schwächt jedes Fuzzy-Matching die Wrong-Source-Detection. |
| **CODE-05 step_3 paraphrase rejection** | TDD-Bed aus #4 | 2a/2b sofort, sobald Token-Edit-Distance > 0 toleriert wird. |
| **Kill-Shot-Block** (`hardFails.length > 0` → 0,25) | Zeile 704 | Indirekt: weniger PROV_FAIL_02 → weniger Hard-Fails → weniger Kill-Shots. |
| **PROV_FAIL_02** „quote not found as substring" | Zeile 225 | Direkt: das ist der Mechanismus, den Toleranz weglässt. |
| **R6 wrong-source-Regex** | `wrong source\|different source\|blog.*instead\|...` | 2d (verbose paraphrase) füllt LLM-Quote mit Phrasen, die R6-Regex nicht trifft, obwohl semantisch falsche Quelle. |

**Befund**: D-06 bricht **nicht** durch den Matcher selbst, sondern
durch den **Side-Effect** auf die Hard-Fail-Pipeline. Jeder Test, der
Mode-2-Toleranz untersucht, muss D-06 mit erweiterten Probe-Varianten
neu bestätigen — das alte D-06-Lock-Test reicht nicht.

---

## 4. Drei mögliche Schnitte (Increasing Risk)

### Schnitt A: „Numeric anchor + entity preservation"

**Regel**: Paraphrase erlaubt, aber nur wenn alle Zahlen, Eigennamen,
und Negationen **verbatim** in beiden Strings vorkommen (modulo Mode-1
Unicode-Fold).

- **Adressiert**: 2a teilweise, 2b teilweise.
- **Bricht nicht**: D-06 (Wrong-Source typischerweise Entity-Mismatch),
  CODE-05 step_3 (synonym swap ohne Numerics).
- **Bricht ggf.**: 2d wenn LLM zufällig dieselben Zahlen paraphrasiert
  → false-positive ALLOW.
- **Test-Aufwand**: Mittel. Braucht Numeric-Tokenizer + NER-Lite.
- **Kandidat für separaten PR**: Ja, falls überhaupt.

### Schnitt B: „Bag-of-content-words mit Schwelle"

**Regel**: Match wenn ≥ 90 % der Inhaltswörter (ohne Stopwords) der
Source-Quote in der LLM-Quote vorkommen.

- **Adressiert**: 2a, 2b, 2c (teilweise).
- **Bricht**: 2d massiv (verbose paraphrase enthält **alle** Source-Wörter
  plus Halluzinationen — würde grün matchen).
- **Bricht D-06**: ja indirekt — Wrong-Source-Quotes haben oft 80-90 %
  Wort-Überlappung mit dem Original (es ist ja dasselbe Thema, nur
  falsche Quelle).
- **Empfehlung**: **Nicht ohne starken Side-Channel-Source-Check**.

### Schnitt C: „LLM-as-Judge Paraphrase-Verifier"

**Regel**: Wenn `PROV_FAIL_02` ausgelöst, eskaliere zu zweitem LLM-Call
mit Prompt: „Ist Quote B eine semantisch äquivalente Paraphrase von
Quote A, ohne neue Behauptungen einzuführen?"

- **Adressiert**: alle vier Sub-Modi, mit unterschiedlicher Treffsicherheit.
- **Bricht**: deterministisches Verhalten. Reintroduziert Provider-
  Nondeterminismus exakt da, wo wir ihn aus dem Idempotenz-Check
  herausgehalten haben.
- **Kosten**: ein extra LLM-Call pro PROV_FAIL_02 — deutlich teurer.
- **D-06-Risiko**: hängt komplett an der Judge-Prompt-Qualität, kein
  Code-Lock mehr garantierbar.
- **Empfehlung**: nicht ohne Canary-Suite gegen alle 4 Sub-Modi
  + harte Akzeptanz-Schwelle (z.B. ≥ 95 % Trefferquote auf 50+ Probes).

---

## 5. Voraussetzungen, bevor irgendein Schnitt PR-fähig wird

1. **Sub-Modus-Klassifikation pro Case**. Aktuell ist „Mode 2" ein
   Bucket. Ohne Trennung von 2a/2b/2c/2d ist kein Schnitt evaluierbar.
   → Erweiterung der Benchmark-Cases um `paraphrase_subtype` Field.

2. **Erweitertes D-06-Lock-Test-Set**. Heute genau eine D-06-Variante.
   Brauchen: 5-10 wrong-source-Cases, jeder einmal als verbatim und
   einmal als Paraphrase formuliert. Beide müssen rejected bleiben.

3. **Idempotenz-Schwellwert**. Paul hat 2/6 Drift bei T=0 gemessen.
   Jede Paraphrase-Schwelle muss diese Drift-Bandbreite **klar**
   überschreiten (vgl. Effect-Size > Noise-Floor).

4. **Wrong-Source-Regex-Erweiterung**. Wenn 2d verbose paraphrase
   einbricht, muss R6 mehr Pattern erkennen — sonst false-positive
   ALLOW bei wrong-source verbose paraphrase.

5. **Kill-Shot-Side-Effect-Check**. Quantifizieren, wie viele BLOCK-
   Verdicts heute durch `PROV_FAIL_02` als Hard-Fail entstehen, und
   was mit ihnen passiert, wenn die Hard-Fail-Quote sinkt.

---

## 6. Mein Standpunkt

**Wenn überhaupt, dann Schnitt A.** Schnitt B ist gefährlich (verbose
paraphrase falsch-grün), Schnitt C ist Determinismus-Verlust für
unklaren Gewinn.

Aber ehrlicher noch: D-05 ist **ein** Case. Der Verdict-Run zeigt
71/82 (86,6 %) korrekt. Es lohnt sich nicht, die Paraphrase-Pipeline
aufzureißen für einen Case, dessen Lock („paraphrase rejected") wir
in CODE-05 step_3 explizit testen und dort als Feature behandeln.

**Vorschlag** stattdessen: D-05 als „aktuell nicht im Scope, mit
dokumentierten Voraussetzungen für Re-Evaluation" in einer
Limitations-Sektion der README dokumentieren. Die Tür bleibt damit
bewusst offen — falls in Zukunft Sub-Modus-Labels (§5.1) und ein
erweitertes D-06-Lock-Set (§5.2) existieren, kann sich der ROI-Kalkül
verschieben. Bis dahin: Mode 2 geschlossen. Ressourcen lieber in Mode 5
(LLM-Truncation) stecken, das ist neu und mit Detection-Probes
günstig zu adressieren.

---

## 7. Wenn doch — minimaler Pfad

1. PR a: Benchmark-Erweiterung mit `paraphrase_subtype` (Test-only,
   keine Verhaltensänderung).
2. PR b: D-06-Lock-Erweiterung (5-10 wrong-source Paraphrasen als
   Lock-Tests). Muss alle als BLOCK/HOLD verifizieren — vor jedem
   weiteren PR.
3. PR c: Schnitt A (Numeric-Anchor) hinter Env-Toggle
   `PLV_PARAPHRASE_NUMERIC_ANCHOR=1`. Zwei-Run-A/B wie in #5.
   **Akzeptanz**: 0 D-06-Lock-Brüche, 0 BLOCK→ALLOW, gemessener
   Effect-Size > Idempotenz-Drift.

Kein einziger Schritt ohne Vorgänger.

---

## 8. Was ich nicht weiß

- Realweltliche Häufigkeit von 2a vs. 2d — ohne Sub-Modus-Labels
  Spekulation.
- Ob Grok bei T=0 systematisch eher 2a (harmlos) oder 2d (gefährlich)
  produziert. Idempotenz-Check müsste auf Mode-2-spezifisch erweitert
  werden.
- Ob es Cases gibt, die heute fälschlich BLOCK sind, weil D-06 zu
  weit greift — d.h. ob es einen Wahrheitsgewinn jenseits von D-05
  überhaupt gibt.

Diese drei Lücken müssten vor PR a geschlossen sein.

---

**TL;DR**: Mode 2 ist nicht ein Modus, sondern vier verschiedene
Probleme. Schnitt A der Skizze ist der konservativste, Schnitt B/C
sind Lock-Risiken (besonders D-06 indirekt über den Kill-Shot-Side-
Effect). Empfehlung: D-05 als Limitation dokumentieren — nicht weil
es „kein Bug" wäre, sondern weil der ROI für einen einzelnen Case
nicht stimmt. Re-Evaluation wird dann sinnvoll, wenn Sub-Modus-Labels
und ein erweitertes D-06-Lock-Set existieren. Nicht jetzt.
