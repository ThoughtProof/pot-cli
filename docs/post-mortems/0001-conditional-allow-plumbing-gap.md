# Post-Mortem 0001: CONDITIONAL_ALLOW Plumbing-Gap

**Datum**: 2026-04-27
**Schweregrad**: Mittel (Feature-Lücke, kein Sicherheits-Defekt)
**Entdeckt von**: Paul (Confusion-Matrix-Run, 82-Case-Benchmark)
**Behoben in**: PR #14 (`fix/plan-graded-eval-conditions-plumbing`), gemerged in PR #12 (`feat/plv-5tier-conditional-allow`)
**Hard-Rules-Status**: Unverletzt — keine BLOCK→ALLOW oder HOLD→ALLOW Regressionen verursacht

---

## Zusammenfassung

Nach Auslieferung des 5-Tier-Verdict-Systems mit `CONDITIONAL_ALLOW` (PR #12, PR-E)
emittierte der 82-Case-Benchmark **0× CONDITIONAL_ALLOW** im Public Output, obwohl
intern 7 Cases korrekt als `CONDITIONAL_ALLOW` derived wurden. Ursache war ein
**Plumbing-Gap im CLI-Output-Pfad**, nicht ein Defekt der Verdict-Logik.

## Symptome

- 82-Case Confusion-Matrix-Run (PR #12, Pauls Setup) zeigte:
  - Accuracy 81.7% (67/82), -5pp gegenüber 4-Tier-Baseline
  - 0 BLOCK→ALLOW ✅, 0 HOLD→ALLOW ✅, 0 ALLOW→BLOCK ✅
  - **0 CONDITIONAL_ALLOW im Output**
- Erwartet wären 7 CA-Emissions auf Basis der `deriveVerdict()`-Pfadabdeckung
  (T1–T13 lockten den Pfad explizit, alle grün)

## Root Cause

`src/commands/plan-graded-eval.ts` Zeile 263:

```ts
// vorher (defekt)
const mapped = toPublicVerdict(item.verdict as InternalVerdict);
//                                                              ^ conditions fehlen

// nachher (Fix)
const mapped = toPublicVerdict(item.verdict as InternalVerdict, item.conditions);
```

`evaluateItem()` populierte `item.conditions` korrekt für `CONDITIONAL_ALLOW`-Cases.
Der Mapper `toPublicVerdict()` nahm einen optionalen `conditions`-Parameter und
defaultete auf `[]` wenn nicht übergeben. Im CLI-Output-Pfad wurde der zweite
Parameter ausgelassen, sodass **alle CA-Verdicts mit `metadata.conditions: []`**
ausgegeben wurden — ununterscheidbar von einem unbedingten ALLOW im Public Output.

## Wie es durchrutschte

1. **Unit-Tests T1–T13 testeten den Mapper isoliert** mit explizit übergebenen
   `conditions`. Sie konnten den Plumbing-Gap nicht fangen, weil sie nicht den
   Aufruf-Site testen.
2. **Kein Integration-Test im CLI-Output-Pfad**. T14–T16 (durch diesen Post-Mortem
   nachgereicht) schließen die Lücke.
3. **Hermes' Erstdiagnose** (von mir, Computer-Agent, übermittelt) postulierte
   "binäres Scoring der Case-Library" als Erklärung — eine voreilige Kapitulation
   vor den Daten. Tatsächlich liegen 28.6% der supporting Steps im CA-Range
   `(0, 0.75)`, was den Plumbing-Gap als Erklärung sofort widerlegt hätte, wenn
   die Step-Score-Verteilung vor der Diagnose ausgewertet worden wäre.

## Die CA-Cases (post-Fix gemessen, zwei Runs)

Der Plumbing-Fix wurde durch zwei unabhängige Confusion-Matrix-Runs validiert.
Das Resultat zeigt **substantielle Run-zu-Run-Varianz**, die in der ursprünglichen
Diagnose nicht antizipiert war.

| Case | Supporting Step | Run 1 (28.6% CA-Range) | Run 2 (~5% CA-Range) |
|---|---|---|---|
| GAIA-04 | step_4 | 0.5 ✅ | 0.5 ✅ |
| D-05 | step_4 | 0.5 ✅ | 0.5 ✅ |
| V2-C03 | step_1 | 0.5 | 0.0 oder ≥0.75 |
| H-08 | step_4 | 0.5 | 0.0 oder ≥0.75 |
| GAIA-03 | step_4 | 0.5 | 0.0 oder ≥0.75 |
| FIN-02 | step_3 | 0.5 | 0.0 oder ≥0.75 |
| GAIA-21 | step_5 | 0.5 | 0.0 oder ≥0.75 |

**Stabile CA-Emitter über zwei Runs**: GAIA-04, D-05.
**Run-1-only**: V2-C03, H-08, GAIA-03, FIN-02, GAIA-21.

Alle aus dem ALLOW-Pool. Aggregiertes Public-Verdict bleibt ALLOW in beiden Runs
(mit `metadata.conditions[]` populated für die emittierten Cases). Hard-Rules grün
in beiden Runs (0 BLOCK→ALLOW, 0 HOLD→ALLOW). Accuracy 81.7% (Run 1) und 80.5%
(Run 2) liegen innerhalb erwarteter LLM-Varianz.

## LLM-Scoring-Varianz als eigener Befund

Der Re-Run quantifiziert eine Eigenschaft, die wir vorher nicht gemessen hatten:
Groks Step-Scoring ist **nicht deterministisch** und der Anteil von Steps im
CA-Range `(0, 0.75)` schwankt erheblich zwischen Runs derselben Case-Library:

- Run 1: ~28% supporting Steps im CA-Range → 7 CA-Emissions
- Run 2: ~5% supporting Steps im CA-Range → 2 CA-Emissions

Die wahre Eigenschaft der Case-Library liegt also nicht bei einem festen Wert,
sondern in einer Verteilung um einen Mittelwert herum (vermutlich 10–20%, aber
zwei Datenpunkte reichen nicht). Das hat zwei Konsequenzen:

1. **CA-Emission ist Production-Properties, nicht Bug**: Variabilität zwischen
   2 und 7 CA-Cases pro Run ist normal und erwartet. Hard-Rules halten in beiden
   Runs, das ist der einzig kritische Indikator.
2. **Step-Score-Statistiken brauchen ≥3 Runs**: Jede zukünftige Behauptung über
   die Scoring-Verteilung der Case-Library muss auf mindestens drei unabhängigen
   Runs basieren, bevor sie als Eigenschaft des Systems behandelt wird.

## Lock-Tests (T14–T16)

Eingeführt in `src/plan/test-conditions-plumbing.ts`:

- **T14**: `toPublicVerdict(CA, conditions)` propagiert `conditions` in `metadata`
- **T15**: `toPublicVerdict(CA)` ohne `conditions` defaultet auf `[]`
- **T16**: `ALLOW`/`HOLD`/`BLOCK` haben kein `conditions` in `metadata`
  (Nit-Erweiterung: `DISSENT` mit aufnehmen, da DISSENT→UNCERTAIN nach ADR-0001
  ein eigener Verdict-Pfad ist)

## Verfahrenslehren

1. **Diagnose-Disziplin**: Bevor "Eigenschaft der Daten" als Erklärung akzeptiert
   wird, mindestens eine empirische Prüfung der Datenverteilung durchführen. Im
   konkreten Fall: Step-Score-Histogramm aus dem 82-Case-Run hätte die binäre
   Scoring-These innerhalb von 30 Sekunden falsifiziert.
2. **Integration-Tests im Output-Pfad**: Pure Mapper-Tests genügen nicht für
   Public-API-Garantien. Plumbing-Tests (T14–T16) sollten Pflicht sein für jede
   Funktion, die zwischen Internal- und Public-Repräsentation übersetzt.
3. **Multi-Modell-Diagnose**: Pauls direkte Code-Inspektion fand den Bug in
   wenigen Minuten, nachdem mein Agent eine Daten-These produziert hatte. Die
   Reihenfolge sollte sein: **Code-Pfad-Audit zuerst, Daten-Hypothesen zweit**.
4. **Run-Replikation als Standard**: Der Re-Run zeigte 2 statt 7 CA-Emissions —
   ein Single-Run-Ergebnis hätte die Falsche Stabilität der Step-Scores
   suggeriert. Jede Property-Behauptung über die Case-Library braucht ≥2
   unabhängige Runs, idealerweise ≥3 für statistische Aussagen.

## Folge-Backlog

- ~~T16 um `DISSENT` erweitern~~ — bereits in PR #14 durch Paul ergänzt (Commit `3e0f816`)
- Step-Score-Histogramm als Standard-Output des Benchmark-Runs (Hermes-Track,
  jetzt mit höherer Priorität wegen LLM-Varianz-Befund)
- Multi-Run-Statistik (≥3 Runs) für stabile CA-Emission-Rate-Schätzung
- Q2-Erweiterung der Case-Library: graduierte Cases priorisieren wo Step-Scoring
  deterministisch genug ist (GAIA-04, D-05 als stabile Anker)
- DeepSeek -5pp Caveat (Track B, Hermes Triple-Majority-Run 2026-04-27 dokumentiert,
  separater Post-Mortem nach Calibration-Sweep). DS-Varianz möglicherweise höher
  als Grok-Varianz — eigener Recherche-Punkt im DS-Briefing.

---

**Editor**: Computer
**Reviewers**: Raul, Paul
