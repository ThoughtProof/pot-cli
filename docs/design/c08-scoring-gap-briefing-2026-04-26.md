# C-08 LLM-Scoring-Gap step_1 — Investigation-Briefing

**Adressat:** Paul
**Autor:** Computer (für Raul · ThoughtProof)
**Datum:** 2026-04-26
**Bezug:** Follow-up zu PR #5 (`a3ff0be`). C-08 als Open Question
dokumentiert: Matcher-Fix (Mode 1 fuzzy-truncated) wirkt auf step_4,
step_1 bleibt aber `score=0` und treibt HOLD.

---

## 1. Was wir wissen

Aus deinem Audit (IMG_4760):

> C-08: step_1 score=0 (LLM sagt „none", Retrieval-Aktion wird nicht
> erkannt). step_4 ist 0,75 dank fuzzy-truncated, aber step_1 = critical
> + unsupported → HOLD. **Kein Matcher-Problem — LLM-Scoring von step_1.**

Der Case selbst (aus `plv-new-40-cases-2026-04-26.json`):

- **Question**: „What is the proper order of operations for CPR per AHA guidelines?"
- **Expected**: ALLOW
- **Gold step 1**: `Retrieve AHA 2020 Guidelines Part 3: C-A-B sequence` (criticality: critical)
- **Trace step 1**: `Step 1 [reason]: To answer the proper CPR order per AHA guidelines, I need the official 2020 AHA guidelines, specifically checking for C-A-B sequence in Part 3, compression details like 100-120/min and 5-6cm depth, and cite the section.`
- **Trace step 2/4/5**: `[search]` und `[observe]` mit dem tatsächlichen Retrieval und den Quotes

## 2. Diagnose

Das ist **kein LLM-Bug, sondern ein Step-Alignment-Mismatch**:

- Gold-step 1 = „Retrieval-Aktion"
- Trace-step 1 = `[reason]`-Block, der die Retrieval-Aktion **plant**, aber nicht ausführt
- Die tatsächliche Retrieval-Aktion ist Trace-step 2 (`[search]`) und Trace-step 4 (`[search]`/`[fetch]`)

Die Rubrik in `graded-support-evaluator.ts` (Zeile 392-394) sagt:

> 0.25 — WEAK: Step mentioned or tool call issued, but NO output in trace,
> OR output is unrelated to acceptance criterion.
> CAPPED at 0.25 for fetch-without-extraction.

Aber das LLM gibt `0.0` (NONE), nicht `0.25` (WEAK). Warum?

Weil Trace-step 1 die Retrieval-Aktion gar nicht **erwähnt** als
ausgeführt — er sagt nur „I need the official AHA guidelines". Das LLM
liest das wörtlich: kein Tool-Call, keine Quote, keine Output-Daten →
`tier: 'none'`. Strikt nach Rubrik **korrekt**. Aber semantisch
falsch, weil der Retrieval in Step 2/4/5 dann ja stattfindet.

## 3. Drei mögliche Schnitte

### Schnitt A: Step-Alignment-Erweiterung (Recommended)

**Idee**: Bei der Bewertung eines Gold-Steps darf das LLM Evidenz aus
**allen** Trace-Steps ziehen, nicht nur dem index-gleichen Trace-Step.
Heute ist die Zuordnung implizit positional — das ist die Wurzel des
Problems.

**Konkret**: Prompt-Erweiterung in `GRADED_SUPPORT_SYSTEM_PROMPT`:

> When evaluating a gold step, scan the ENTIRE trace for evidence —
> not only the trace step at the same index. A planning step in the
> trace (e.g., `[reason]: I need to fetch X`) plus a later
> `[search]` / `[observe]` step that actually fetches X **together**
> satisfy the gold step.

**Risiko**: Das LLM könnte Evidenz aus falschen Steps ziehen (z.B.
step_4-Output wird als Beweis für step_1-Retrieval gewertet, obwohl
step_4 inhaltlich was anderes ist). Lock-Test: D-06 wrong-source
muss weiter HOLD/BLOCK bleiben — wenn Cross-Step-Aliasing aktiv ist,
darf es nicht durch wrong-source-Quotes aus Nachbar-Steps ausgehebelt
werden.

**Aufwand**: Prompt-Erweiterung + 5-10 Lock-Tests, kein Code-Refactor.
Mittel.

### Schnitt B: Step-Type-Aware-Scoring

**Idee**: Wenn Gold-step von Typ „Retrieve X" und Trace-step von Typ
`[reason]: I need X` ist, dann ist Score ≥ 0.25 (mention) automatisch,
auch ohne Quote — die Bewertung wird auf den nächsten `[search]`/`[fetch]`-
Step verlagert.

**Risiko**: Hoch. Step-Type-Inferenz ist fehleranfällig, Edge-Cases
werden hart. Außerdem: was wenn das LLM zwar plant, aber nie ausführt?
Dann false-positive ALLOW.

**Aufwand**: Hoch. NER-Lite oder Step-Tagger nötig.

### Schnitt C: Gold-Step-Index-Floor

**Idee**: Wenn ein Gold-Step `criticality: critical` und der index-
gleiche Trace-Step `[reason]`-Type ist (kein Search/Fetch/Tool-Call),
dann verschiebe die Bewertung um +1: bewerte Gold-step `i` gegen
Trace-step `i+1` und `i+2`, nicht `i`.

**Risiko**: Sehr fragile Heuristik. Wenn Trace 8 Steps hat und Gold 4,
ist der Offset nicht klar.

**Aufwand**: Niedrig. Aber technisches Schulden-Risiko hoch.

## 4. Mein Vorschlag

**Schnitt A** ist der einzige saubere Pfad. Es ist eine Prompt-Änderung
in der Scoring-Rubrik mit klarer Lock-Test-Anforderung. B und C sind
Heuristik-Pyramiden mit hohem Wartungsrisiko.

Die Prompt-Erweiterung muss **explizit** mit einem Beispiel sagen:
> Example: Gold step "Retrieve X". Trace step 1 says "I need X",
> trace step 3 says `[fetch] X` and shows X in observation. Score
> the GOLD step against the COMBINATION — typically tier `partial`
> (0.5) if the fetch happened but the connection between planning
> and execution is implicit.

**Wichtig**: Schnitt A sollte **nicht** automatisch `0.75 strong`
oder `1.0 verbatim` für Cross-Step-Evidenz vergeben — das verlangt
weiter eine Verbatim-Quote. Aber 0.5 partial wäre fair.

## 5. Wahrscheinliche Verdict-Wirkung

Wenn step_1 von 0 → 0.5 geht:

- step_1 wird `partial` statt `unsupported`
- Critical-partial gewichtet 0.5, nicht 1.0 (siehe Zeile 359 in
  `graded-support-evaluator.ts`)
- C-08 sollte von HOLD → ALLOW bewegen (vorausgesetzt step_4 bleibt
  bei seinen 0.75)

**Aber**: Ähnliches Pattern könnte in anderen Cases existieren. Wir
müssen vor einem Prompt-PR über alle 40 Cases laufen und prüfen:

| Akzeptanzkriterium | Erwartung |
|---|---|
| C-08 → ALLOW | gewünscht |
| D-06 bleibt HOLD/BLOCK (wrong-source Lock) | **muss** halten |
| BLOCK-Cases (19 in Sample 92ec87e4) bleiben BLOCK | hard rule |
| Idempotenz: 0/6 oder weniger als 2/6 Drift | **darf nicht** schlechter werden |
| HOLD-Cases die zu ALLOW driften | nur erlaubt wenn Audit-Trail
  zeigt: Cross-Step-Evidenz war wirklich vorhanden |

## 6. Vorgeschlagener Workflow

1. **Du**: Erweiterung in `GRADED_SUPPORT_SYSTEM_PROMPT` skizzieren —
   eine neue Section nach R6: „R7. Cross-step evidence aliasing"
   mit 1-2 Beispielen.
2. **Du**: Lokal über die 8 persistent-HOLD/BLOCK Cases laufen
   (C-08, D-03, D-05, D-06, ENV-03, FIN-01, GAIA-19, V2-C04).
   Erwartung: nur C-08 wird ALLOW. D-06 muss halten.
3. **Du**: Wenn 2 erfolgreich: full 82-Case Verdict-Run mit
   `PLV_DISABLE_NEW_MATCH_PATHS` neu definiert als
   `PLV_DISABLE_CROSS_STEP_ALIASING` für A/B-Vergleich.
4. **Ich**: Review + Confusion-Matrix-Check.

## 7. Open Questions an dich

### Q1: Liegt das Problem wirklich am Trace, oder gibt es ein Gold-Refinement?

Alternative Hypothese: Der Gold-Step 1 ist falsch formuliert. Statt
„Retrieve AHA 2020 Guidelines Part 3" sollte es heißen „Plan retrieval
of AHA 2020 Guidelines" — dann wäre der Match index-positional korrekt.
Was ist die Konvention im Gold-Schema? Wenn das Gold absichtlich
ergebnisorientiert formuliert ist (was richtig wäre), dann ist
Schnitt A nötig.

### Q2: Gibt es weitere Cases mit „Plan-then-Execute"-Muster?

Wenn ja, ist C-08 nicht ein Sonderfall sondern ein Klassen-Problem.
Das stärkt den Case für Schnitt A erheblich.

---

## 8. Abgrenzung zu Mode 5

C-08 = LLM-**Bewertung** der Trace-Steps. Mode 5 = LLM-**Generation**
der Quotes. Komplett unabhängige Pipelines. Beide können parallel
laufen, kein Konflikt.

Sag, ob Schnitt A für dich Sinn ergibt und ob du bei Q1+Q2
mitziehen kannst.
