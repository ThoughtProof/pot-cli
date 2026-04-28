# ADR-0010: Domain-Onboarding-Playbook (Cross-Domain Generalization)

**Status:** DRAFT (2026-04-28, v2 nach Paul + Hermes Review)
**Date:** 2026-04-28
**Authors:** Computer, Raul, Hermes (M4)
**Related:** ADR-0007 (Cross-Model Verification — DRAFT v2, PR #27 gemergt), ADR-0009 (Answer-Consistency-Step — ACCEPTED)

---

## Context

### Beobachtetes Drop-Phänomen (2026-04-28)

Bei Erweiterung der Test-Suite um 38 Banking-Cases (AML, MRM, CYBER, RISK, INS, FIN, LEG, CODE) trat ein systematisches Accuracy-Tal auf:

| Suite | Sonnet 4.6 | Grok 4.1R |
|-------|------------|-----------|
| Old 82 (GAIA + bestehend) | 89.6% | 85.1% |
| New 38 (Banking) | 65.8% | 63.2% |
| **Drop** | **−23.8 pp** | **−21.9 pp** |

Nach ~10 Stunden Onboarding (Hard-Fail-Guard, Answer-Consistency-Step, v3-Calibration, Branch-Fixes, Cross-Model-Validation) wurde die Full-120-Accuracy auf Sonnet 81.0% / Grok 77.1% gehoben.

### Root-Cause-Klassifikation des Drops

Die Analyse des Banking-Drops zeigte **zwei strukturell unterschiedliche Ursachen**:

**A. Architektur-Lücken (domänenagnostisch):**
- Evaluator war strukturell blind für Trace→Answer-Gap (HOLD 0/16). → ADR-0009 Answer-Consistency-Step.
- Single-Model-Evaluation hatte unkompensierte Modell-Varianz (BLOCK→ALLOW Hard-Rule-Verstöße bei jedem Modell). → ADR-0007 Cross-Model-Verification.
- Kalibrierung (TE/AC bucket-split + 0.5× AC-weights + AC-Floor). → v3-Calibration in ADR-0009.

**B. Domain-Onboarding-Lücken (pro Domain unvermeidbar):**
- Gold-Plans wurden ohne Evaluator-Feedback geschrieben → Subtilitäts-Mismatch (z.B. MRM-01: Faktenfehler zu subtil eingebettet, beide Modelle blind).
- Failure-Modi domain-spezifisch (Banking: Regulatorik-Zitate-Verwechslung; Medical wird andere haben — Off-Label, Dosierung, Guideline-Versionen).
- Borderline-Gold-Labels (BLOCK vs HOLD) ohne Audit-Pass, was Hard-Rule-Statistiken verfälscht.

**Befund:** A ist abgeschlossen oder in PRs gehärtet. B ist **wiederkehrend bei jedem Domain-Pivot** und muss systematisiert werden, statt ad-hoc unter Zeitdruck.

### Konsequenz für zukünftige Domain-Pivots

Erwartung beim nächsten Pivot (Medical, Legal, Scientific, etc.):
- Initialer Drop von **15–25 pp** ist die Baseline-Annahme, nicht eine Anomalie.
- Onboarding-Phase von **1–3 Tagen** mit definiertem Protokoll bringt Domain-Suite auf ~80%.
- Ohne Protokoll wiederholt sich der heutige Stress-Mode (Architektur-Fixes parallel zu Case-Authoring parallel zu Calibration).

Dieses ADR definiert das **Onboarding-Protokoll**, damit zukünftige Pivots planbar sind.

---

## Preconditions

Dieses Playbook ist nur anwendbar, wenn folgende Pipeline-Invarianten aktiv sind. Sie sind **domänenagnostisch** und nicht Teil des Domain-Onboardings selbst.

- **Hard-Fail-Guard aktiv** — kritischer Step-Score ≤0.25 escaliert maximal zu HOLD (verhindert ALLOW bei kritisch fehlerhafter Trace). Implementiert per ADR-0009 §Calibration.
- **Answer-Consistency-Step verfügbar** — `step_type: 'answer_consistency'` auf Gold-Plan-Ebene, plus v3-Calibration (TE/AC bucket-split, 0.5× AC-Weights, AC-Floor). Per ADR-0009.
- **Cross-Model-Cascade konfiguriert** — Default Gemini→Sonnet per ADR-0007.

Fehlt eine dieser Invarianten, ist das Onboarding-Ergebnis nicht aussagekräftig — es würde architektonische Lücken als Domain-Probleme fehl-diagnostizieren (genau die Situation vom 2026-04-28 vor Mittag).

---

## Decision

### Domain-Onboarding-Protokoll (6 Phasen)

**Sequenz:** 0 → 1 → 2 → 3 → **5 → 4** → 6

Gold-Label-Audit (Phase 5) läuft **vor** dem teuren Cross-Model-Cascade-Run (Phase 4). Begründung: Cascade auf vergifteten Labels ist verschwendete Compute-Zeit und verzerrt die Diagnostik (Lehre aus dem Morgen-Verlauf 2026-04-28, GAIA-16/17/19/20).

**Phase 0 — Failure-Mode-Vorrecherche (½–1 Tag, vor Case-Authoring):**
- Domain-Experten-Quellen sichten (Guidelines, Regulatorik, Standard-Lehrbücher).
- Katalog typischer Halluzinations-Muster anlegen, mindestens:
  - Faktenverwechslung (welche Versionsnummern / Standardnamen / Schwellwerte sind in der Domain leicht zu verwechseln?)
  - Strukturelle Auslassungen (welche Differenzierungen kollabieren Modelle gerne?)
  - Numerische Halluzinationen (welche Zahlen werden in der Domain häufig fabriziert?)
  - Off-Topic-Drift (welche Nachbar-Themen "klingen richtig", sind aber falsch?)
- **Quellen-Pflicht:** Jeder Failure-Mode-Katalog-Eintrag **muss** gegen eine Primärquelle verifiziert sein (Regulierungstext, offizielle Guideline, Standard-Dokument, Peer-Review-Publikation). **Kein Modell-generiertes Gold-Material.** Quellen-URL und Zugriffsdatum sind im Failure-Mode-Dokument verpflichtend.
- **Output:** `docs/onboarding/<domain>-failure-modes.md` als Authoring-Referenz, **committet ins Repo als permanentes Asset** (siehe Q1-Resolution unten). Wird beim nächsten Pivot in dieselbe Domain wiederverwendet, nicht neu erzeugt.

**Phase 1 — Case-Authoring nach Protokoll (1 Tag):**
- Pro Failure-Mode mindestens 2–3 Cases (BLOCK + HOLD + Kontroll-ALLOW).
- **Authoring-Regel "Subtilität-vs-Sichtbarkeit":** Faktenfehler muss in mindestens einem Gold-Step **explizit prüfbar** sein, nicht nur im Answer-Text vergraben (Lehre aus MRM-01).
- **Step-Type-Mix:** mindestens 30% AC-Steps (`step_type: 'answer_consistency'`) bei HOLD-Cases, sonst ist die Trace→Answer-Lücke nicht prüfbar.
- Live-Verifikation gegen Primärquellen (kein Modell-generated Gold-Material).
- **Output:** Cases-JSON + `<domain>-cases-audit.md`.

**Phase 2 — Single-Model-Baseline-Run (½ Tag):**
- Sonnet 4.6 (oder aktueller Default-Verifier) auf Domain-Suite.
- **Erwartung:** 60–75% Accuracy (Drop ist normal).
- **Diagnose-Output:** Confusion-Matrix, BLOCK→ALLOW-Liste, HOLD-Recognition-Rate, Per-Step-Score-Distribution.
- **Stop-Bedingung (Overfitting-Schutz, relativ):** Wenn Domain-Accuracy **innerhalb 5 pp** der Old-Suite-Accuracy desselben Modells liegt (z.B. Sonnet auf Old 82 = 89.6%, dann Domain ≥84.6% = Stop) → Cases sind zu einfach, Phase 1 wiederholen mit härteren Failure-Modi. Relativ statt absolut, weil Modell-Baseline über die Zeit driftet.

**Phase 3 — Diagnostik & Kalibrierungs-Entscheidung (½ Tag):**
- Klassifiziere Misses in: (a) Architektur-Bug, (b) Calibration-Issue, (c) Case-Authoring-Issue.
- **Default-Annahme:** keine Architektur-Änderung, keine Calibration-Anpassung. Nur (c) wird in dieser Phase adressiert (Cases nachschärfen).
- **Eskalations-Schwelle für Architektur-Änderung:** ≥3 strukturell ähnliche Misses, die mit existierenden Mechanismen nicht greifbar sind → neuer ADR.
- **Eskalations-Schwelle für Calibration:** Verteilung der Verdict-Klassen mehr als 1.5σ vom 82er-Suite-Profil entfernt.

**Phase 5 — Gold-Label-Audit (¼ Tag, läuft vor Phase 4):**
- Borderline BLOCK-Cases auf "ist HOLD ehrlicher?" prüfen.
- Spez.: alle Cases wo das Single-Model (Phase 2) ALLOW oder UNCERTAIN votet und Gold = BLOCK.
- Sekundär: Gold-Answers gegen Primärquelle re-verifizieren (Schutz gegen vergiftete Gold-Answers wie GAIA-16/17/19/20 am Morgen 2026-04-28).
- **Output:** Gold-Label-Diff + bereinigte Cases-Suite. **Phase 4 läuft auf der bereinigten Suite, nicht auf der ursprünglichen.**

**Phase 4 — Cross-Model-Validation (Cascade-Run, ½ Tag, läuft auf bereinigter Suite):**
- Cascade Gemini→Sonnet (Verifier-Cascade per ADR-0007 Interface — konkrete Modell-Wahl ist Implementation-Detail von ADR-0007).
- **Akzeptanz-Kriterien (per ADR-0007):**
  - 0% BLOCK→ALLOW
  - ≤5% Oszillation
  - ≥80% Full-Suite-Accuracy auf kombinierter (Old + New) Suite
- Falls Akzeptanz nicht erreicht → Phase 3 nochmal mit Fokus auf Cross-Model-Disagreements.

**Phase 6 — Baseline-Setting & Documentation:**
- Finale Accuracy-Zahl als neue Domain-Baseline ins Tagesbriefing.
- Domain-spezifische Failure-Mode-Insights zurück in `docs/onboarding/<domain>-failure-modes.md` (was war neu, was wurde nicht antizipiert).
- **Wenn Architektur-Änderung erfolgt ist:** ADR + Cross-Domain-Re-Test auf allen bestehenden Suiten, um Regression auszuschließen.

---

## Consequences

### Positiv

- **Planbarkeit:** Pivot-Aufwand ist klar dimensioniert (~3 Tage Hands-On + 1–2 Tage Wartezeit auf Cascade-Runs).
- **Klare Eskalations-Schwellen:** Architektur-Änderungen werden nur ausgelöst bei strukturell wiederkehrenden Mustern, nicht bei Einzelfall-Schmerz.
- **Kumulativer Wert:** Failure-Mode-Bibliotheken pro Domain bleiben Asset, auch wenn die Cases sich ändern.
- **Schutz gegen Overfitting:** Phase-2 Stop-Bedingung verhindert, dass eine Suite zu nah am Evaluator entworfen wird.

### Negativ / Trade-offs

- **Kein "einmal kalibrieren, läuft überall":** Das Playbook akzeptiert explizit, dass Cross-Domain-Generalisierung **arbeitsintensiv bleibt**. Alternative wäre eine Meta-Eval-Schicht (ein Modell, das andere Modelle bewertet), die wir bewusst nicht einführen — siehe ADR-0008 RAG-Layer (entfällt) als Präzedenz für "nicht jede vermeintliche Abkürzung lohnt".
- **Domain-Wahl wird teurer:** Jede neue Domain ist eine 3–5 Tage Investition. Das diszipliniert die Auswahl — kein "wir testen mal eben".

### Risiken

- **Failure-Mode-Recherche kann unvollständig sein** und unbekannte Modi tauchen erst im Run auf → Phase 3 fängt das, aber Phase 6 muss sauber feedbacken.
- **Cascade-Akzeptanz-Schwelle (≥80%) ist heuristisch** — wenn eine Domain inhärent härter ist (z.B. medizinische Differential-Diagnose), könnte eine 75%-Baseline ehrlicher sein. → in dem Fall Domain-spezifische Schwelle in Phase 6 begründen, nicht Protokoll lockern.

---

## Anti-Pattern (explizit nicht-Decision)

Folgendes ist **nicht** Teil des Playbooks und wird abgelehnt:

1. **"Universal-Calibration":** Ein einziges Schwellwert-Set für alle Domänen. Heute zeigt sich: AC-Floor ist domainsensitiv (Banking braucht es, andere Domänen vielleicht weniger). Globale Schwellen sind zu rigid.
2. **"Domain-spezifischer Evaluator-Branch":** Eigene Evaluator-Logik pro Domain. Das wäre Code-Fragmentation, schwer wartbar, gegen ADR-0009-Geist.
3. **"Modell-Auswahl pro Domain":** Cascade-Primary (Gemini) bleibt fix per ADR-0007 D4. Domain-spezifischer Modell-Switch ist ohne harten Beleg ein Anti-Pattern.

---

## Resolved Open Questions (Review 2026-04-28, Paul + Hermes)

- **Q1 — Failure-Mode-Docs als permanente Assets?** **Ja.** `docs/onboarding/<domain>-failure-modes.md` wird ins Repo committet und beim nächsten Pivot in dieselbe Domain wiederverwendet, nicht neu erzeugt. Phase 0 wurde entsprechend ergänzt.
- **Q2 — Phase-2 Stop-Bedingung absolut oder relativ?** **Relativ:** Domain-Accuracy innerhalb 5 pp der Old-Suite-Accuracy desselben Modells = Cases zu einfach. Schützt gegen Modell-Baseline-Drift über die Zeit.
- **Q3 — Versionierung wenn Cascade-Architektur sich ändert?** Phase 4 referenziert das **ADR-0007 Interface** ("Cross-Model-Verification mit definierten Akzeptanz-Kriterien"), **nicht die Implementierung** ("Gemini→Sonnet 2-Modell-Cascade"). Wenn ADR-0007 auf z.B. 3-Modell-Voting wechselt, bleibt ADR-0010 unverändert.

---

## Trigger-Bedingungen für ACCEPTED

Dieses ADR geht von DRAFT auf ACCEPTED, wenn:
- **(a)** Erster echter Domain-Pivot nach diesem Protokoll durchgeführt wurde (z.B. Medical) und die Phasen-Aufteilung sich bewährt hat.

Die ursprüngliche Bedingung (b) — Paul + Hermes-Review + Banking-Trockenlauf — ist mit dem Review vom 2026-04-28 erfüllt (siehe Resolved Open Questions oben). Das Playbook bleibt dennoch DRAFT bis (a), weil ein Trockenlauf gegen einen abgeschlossenen Verlauf nur Bestätigung liefert; ein echter Pivot ist die einzige Probe, die das Protokoll **prospektiv** validiert.
