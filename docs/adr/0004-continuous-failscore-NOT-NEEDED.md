# ADR-0004 (NOT-NEEDED): Continuous failScore as Predicate Replacement

**Status**: NOT-NEEDED — geschlossen 2026-04-27 ohne Implementierung. Begründung siehe unten.
**Date**: 2026-04-27
**Deciders**: Raul, Paul, Computer
**Editor**: Computer
**Relates to**: ADR-0003 v2.2 (Threshold-Shift, ACCEPTED)

---

## Kontext

Während der v2.1→v2.2-Iteration wurde als Alternative zum Threshold-Shift ein **Continuous failScore**-Modell diskutiert: statt eines harten Floors (`SUPPORTED_THRESHOLD = 0.5625`) ein kontinuierlicher Score, der die Kosten eines Fehlurteils proportional gewichtet (z. B. weighted L1 zwischen Verdict-Score und Gold-Confidence).

Die Idee: Threshold-Sprünge an Score-Plateaus (wie der bimodale DS+Gemini-Cluster bei 0.50) wären weniger fragil, weil das Gate nicht mehr binär an einem Cut-off hängt.

## Entscheidung

**Nicht implementiert.** ADR-0004 wird formal als **NOT-NEEDED** geschlossen, ohne dass eine Continuous-failScore-Variante in Code, Tests oder Doku angelegt wird.

## Begründung

ADR-0003 v2.2 (`SUPPORTED_THRESHOLD = 0.5625`) löst das Plateau-Problem deterministisch und auditierbar:

1. **86.6% Accuracy bei 0 gold=HOLD Regressionen** — Hermes-Threshold-Sweep zeigt ein stabiles Plateau 0.5625–0.75 mit identischer Performance. Es gibt keine Plateau-Fragilität, die ein Continuous-Modell entschärfen müsste.
2. **Hard-Rule-Treue** — Die binären Hard Rules (D-06 wrong-source, P1 BLOCK→ALLOW=0) sind binär und nicht continuous-kompatibel. Ein continuous failScore würde die Hard Rules entweder umgehen oder auf einen quasi-binären Modus zurückfallen — kein Mehrwert.
3. **Auditierbarkeit** — Die drei v2.2-Cases (CODE-05/MED-05/GAIA-02) ließen sich nur deshalb sauber als „legitime Korrekturen" auditieren, weil der Floor klar und der Verdict-Übergang scharf war. Ein continuous Score hätte „54%-Korrektur" produziert — schwer kommunizierbar gegenüber Reviewern und Buyern.
4. **Tier-Pricing**: Die Fast/Standard/Thorough-Differenzierung (siehe ADR-0003 §Tier-Gating) baut auf binären Verdicts auf — Continuous-Outputs wären Produkt-seitig nicht sauber pricbar.
5. **YAGNI**: Kein offener Failure-Case in der v2.2-Test-Suite (272/272 grün) verlangt continuous Scoring. „Decompose, don't loosen" — wir haben dekomponiert (Floors + Threshold + Hard Rules), nicht gelockert.

## Konsequenzen

- Keine Code-Änderung. Keine Tests. Keine Doku-Pflege außer dieser ADR.
- Sollte eine zukünftige Iteration (v3.x?) eine Plateau-Fragilität zeigen, die ein Threshold-Shift nicht löst, kann diese ADR re-opened werden — Status dann **DRAFT**, mit Verweis auf den konkreten Failure-Case.
- **Verwandte offene Frage**: Score-Determinismus (siehe Issue #21, Oszillator-Rate 25/334). Continuous failScore wäre gegen Drift weniger robust, nicht robuster. Argument zugunsten der Schließung.

## Referenzen

- ADR-0003 v2.2 (ACCEPTED 2026-04-27, gemerged via PR #19 commit `8af04ae`)
- Issue #21 — Score-Drift trotz Seed-Pin
- Hermes Threshold-Sweep (deterministisch, im ADR-0003 dokumentiert)
