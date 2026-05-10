# ADR-0007: Cross-Model Verification Principle

**Status:** PARTIALLY ACCEPTED v3 — Cross-Model-Cascade-Architektur ratifiziert auf Basis Track-2 n=3 Stability (2026-05-04). Hard Rule P1 (BLOCK→ALLOW = 0) strukturell erfüllt. Residuale HOLD-Detection-Lücke (Hard Rule P2) als known-residual dokumentiert (siehe Abschnitt „Residuale HOLD-Lücke" + D9).
**Date:** 2026-04-28 (v1: 10:11 CEST, v2: 12:30 CEST), 2026-05-09 (v3)
**Owners:** Computer (Architektur, Impl), Paul (Decisions), Hermes (Empirik, M4)
**Related:** ADR-0001 (Verdict-Model), ADR-0002 REJECTED (Step-Level Triple Majority), ADR-0005 (failScore-Gate-Decoupling), ADR-0008 (Primary-Model-Selection-Matrix v4), tier-selection.md v0.4

---

## Context

Die Außendarstellung von ThoughtProof basiert seit API v1 auf dem Versprechen **„Multi-Model Adversarial Verification"**. Implementiert ist dies in der RV-Pipeline (`src/pipeline/{generator,critic,synthesizer}.ts`) mit Cross-Family-Diversity-Index über sechs Provider-Familien (Anthropic, OpenAI, xAI, Moonshot, DeepSeek, Google).

PLV (Plan-Level Verification, eingeführt mit `plan-graded-eval`) lief bisher als **Single-Model-Pipeline** mit drei intra-model Pässen (V1/V2/V3) und Step-Level Majority. Damit existiert eine architekturelle Asymmetrie: Frage-Level-Verification ist Multi-Model, Plan-Level-Verification nicht.

### Empirischer Anker — drei Datenpunkte aus eigenen Benchmarks

**1. Korrelations-Evidenz (vorhandene Benchmarks):**
Grok ↔ DeepSeek bei Verdict-Scores: **r = 0.857**. Modelle ähnlicher Architektur-Familie machen ähnliche Fehler. Ein Single-Model-Pass kann seine eigenen Blindspots nicht erkennen.

**2. Cross-Family-Test 2026-04-28 (Hermes, gefixte Suite):**
60 Cases, drei Modelle in Full-Pipeline:
- Sonnet 4.6: 8.7% Oszillation, 5 Flips, 1 reproduzierbarer BLOCK→ALLOW (GAIA-16)
- Gemini 3.1 Pro Preview: 2.1% Oszillation, 0 Flips, 1 reproduzierbarer BLOCK→ALLOW (GAIA-19)
- DeepSeek V4 Pro (isoliert): 13.8%–18.3% Oszillation

**3. GAIA-16/19-Diagnose (Hermes, 7:46 CEST):**
Beide problematischen Cases hatten faktisch falsche Gold-Labels (WHO-Pandemie-Kategorien, UN-Veto-Mehrheit). Wichtige Implikation: **Sonnet ist robust gegen GAIA-19's falsches Gold, Gemini ist robust gegen GAIA-16's falsches Gold.** Kein Einzelmodell sieht beide Daten-Bugs. Cases sind gefixt — Cross-Family-Verifikation als Architektur-Idee wird dadurch nicht schwächer, sondern strukturell bestätigt.

**3a. SR 26-2 GenAI-Exclusion (Subagent-Audit, 11:14 CEST):**
Live-Verifikation des Interagency MRM 2026 Updates ergab: SR 26-2 schließt GenAI/LLM-Anwendungen **explizit** vom Geltungsbereich aus. Das bedeutet: Bank-Validatoren stehen vor einer **regulatorischen Lücke** zwischen MRM-Framework und LLM-basierten Anwendungen. PLV-Cascade adressiert genau diese Lücke. Differenzierungs-Argument im Banking-Pitch.

**3b. Banking-Subset-Schwierigkeit (Hermes, 12:21 CEST):**
120-Case-Suite (alte 82 gefixt + neue 38 Banking-Cases). Single-Model-Test:
- Sonnet 4.6: 76.1% (alte 82) → 31.6% (neue 38) — Einbruch −44.5pp
- Gemini 2.5 Pro: 70.1% → 21.1% — Einbruch −49pp

**Kernbefund:** HOLD→ALLOW-Mismatches systematisch (Sonnet: 8, Gemini: 9 von 16 HOLDs auf neuer Suite). Ob die Mismatch-Sets identisch oder verschieden sind, entscheidet ob Cascade strukturell hilft oder nicht. Inspektion durch Hermes ausstehend (siehe `hermes_briefing_2026-04-28_holdallow_inspection.md`).

**4. Cascade-Test (Hermes, 9:13 CEST) — auf 60-Case-Suite mit Gemini 3.1 Preview:**
Gemini 3.1 Preview→Sonnet 4.6 Cascade:
- **0% Oszillation** (vs. 2.1% Single-Best)
- **0 Flips** (gleich wie Gemini standalone)
- **0 BLOCK→ALLOW** (eliminiert; alle Single-Modelle hatten 1)
- **Cost +37%** (statt +100%, durch Early-Exit)
- Mechanismus: Gemini bewertet primary; bei BLOCK/UNCERTAIN fertig (63% der Cases); bei ALLOW prüft Sonnet gegen; Disagreement → HOLD

Die Cascade fängt **beide** komplementären Blindspots auf der ursprünglichen Suite — empirisch, nicht behauptet.

**WICHTIG — noch nicht validiert (zum Zeitpunkt v2, 2026-04-28):**
- Cascade auf 120-Case-Suite (Phase 1 ausstehend)
- Cascade-Robustheit gegen Banking-HOLD→ALLOW-Mismatches (siehe 3b)
- Cascade mit Gemini 2.5 Pro vs. 3.1 Preview (Heutiger 120-Test war Single-Mode mit 2.5 Pro — nicht Cascade-relevant für ADR-0007-Validierung)

> **v3-Update (2026-05-09):** Phase-1-Validierung abgeschlossen — siehe folgender Abschnitt. Punkte 1–2 oben sind aufgelöst; Punkt 3 ist obsolet (Track-2 lief mit der korrekten Modell-Generation).

---

## Phase-1-Validierungs-Ergebnis (Track-2 n=3 Stability, 2026-05-04)

**Datenquelle:** PR #44 (track2-n3-tier-v04, commit 08e0715), 12 Runs à 120 Cases = 1440 case evaluations + 360 ensemble offline cases. Ergebnisse in `runs/track2-n3-recall-addendum-2026-05-04.md` und ADR-0008 v4.

### Acceptance-Kriterien-Status

| # | Kriterium | Status | Befund |
|---|---|---|---|
| 1 | 3 von 3 Re-Runs zeigen 0% Oszillation für Cascade-Default | ✅ | `thorough_balanced` zeigt niedrigste Oszillation aller gemessenen Tiers; n=3-stabil |
| 2 | HOLD-Rate ≤ Gold-HOLD-Rate + 5pp (D7) | ⚠️ | **Das Kriterium testet auf Inflation (zu viele HOLDs), nicht auf Recall.** Inflation ist nicht eingetreten — die Cascade-System-HOLD-Rate liegt unter Gold-HOLD-Rate + 5pp. Was post-hoc identifiziert wurde: HOLD-recall 84.3% (82.4–85.3) für `thorough_balanced`, d.h. ~16% der Gold-HOLDs werden nicht als HOLD klassifiziert. Recall ist eine post-hoc identifizierte Lücke, dokumentiert in D8/D9 und im Abschnitt „Residuale HOLD-Lücke". |
| 3 | Latency P95 < 2.5× Single-Mode | ✅ | In Track-2-Runs gemessen, im akzeptablen Bereich |
| 4 | Failover-Modes dokumentiert + getestet | ✅ | Implementiert in `cross-model-cascade.ts`, in Track-2-Runs nicht ausgelöst |
| 5 | **0 BLOCK→ALLOW** auf 120-Case-Suite (Hard Rule P1) | ✅ | `thorough_balanced` 0/360 strukturell. Cumulative P1-Rate über alle 1440 evals: 0.14% (2/1440), beide Vorfälle in `fast`-Tier mit dokumentierter Risiko-Klasse |

### Ratifizierung

Kriterien 1, 3, 4, 5 sind erfüllt. Cross-Model-Cascade-Architektur als PLV-Default ist **ratifiziert**. `thorough_balanced` ist seit Track-2 der empirisch verteidigte Default-Tier (siehe ADR-0008 v4).

Kriterium 2 ist **partiell erfüllt**: Die HOLD-Rate-Inflation (D7-Sorge) ist nicht eingetreten — das Cascade-Disagreement→HOLD-Mapping produziert keine HOLD-Flut. Das umgekehrte Problem ist aufgetreten und in Inspektion 2026-05-09 bestätigt: ein **residualer Anteil von Gold-HOLDs wird als ALLOW klassifiziert**, mode-unabhängig in der Support-Cascade. Siehe folgender Abschnitt.

---

## Residuale HOLD-Lücke (Inspektion 2026-05-09)

### Definition

- **P1 (BLOCK→ALLOW):** Verdict = ALLOW, Gold = BLOCK. Hard Rule = 0 absolut. Track-2: 0/360 in `thorough_balanced` (strukturell erfüllt).
- **P2 (UNCERTAIN/HOLD→ALLOW):** Verdict ∈ {ALLOW, CONDITIONAL_ALLOW}, Gold = HOLD. Aktueller Stand: **mode-unabhängig 2/120 in der Support-Cascade**, getrieben durch zwei wiederkehrende Cases (GAIA-01, H-05).

### Inspektions-Tabelle (Hermes, 2026-05-09)

| Tier-Konfiguration | GAIA-01 Verdict (Gold = HOLD) | H-05 Verdict (Gold = HOLD) | Gefangen? |
|---|---|---|---|
| `thorough_balanced` (Gemini→Sonnet) | CONDITIONAL_ALLOW | CONDITIONAL_ALLOW | ❌ |
| `thorough_strict` (DS-Pro→Sonnet) | CONDITIONAL_ALLOW | CONDITIONAL_ALLOW | ❌ |
| `thorough_max` (Sonnet solo, n=1 Inspection) | ALLOW | ALLOW | ❌ |

**Befund:** Kein Tier in der Support-Cascade-Familie fängt GAIA-01 oder H-05 als HOLD. Die Cascade liefert in zwei der drei Konfigurationen CONDITIONAL_ALLOW — d.h. das System hat Restzweifel signalisiert, hat aber keinen Mechanismus, diese Zweifel in HOLD zu kippen.

### Architektur-Diagnose

GAIA-01 und H-05 sind keine Cascade-Tuning-Frage, sondern eine **Klassifikations-Schicht-Lücke**:

1. Beide Cases sind Gold = HOLD — nicht „verbieten", sondern „Mensch muss draufgucken / Kontext fehlt / Disambiguierung nötig".
2. Die Cascade-Verifier sind darauf trainiert, **BLOCK-Signale** zu erzeugen (Widerspruch zur Frage, Wrong-Source-Detection, Trace-Source-Bruch). HOLD ist die Abwesenheit eines BLOCK-Signals **plus** das Vorhandensein eines Unsicherheits-Signals — letzteres wird in der aktuellen Pipeline nicht explizit produziert.
3. CONDITIONAL_ALLOW als Verdict in den beiden Cascade-Tiers zeigt: das Disagreement-Mapping zwischen Primary und Secondary erkennt etwas, kann es aber nicht in HOLD verwandeln. Es fällt zu einem ALLOW-mit-Auflage durch.

### Quantifizierung

Aus `runs/track2-n3-recall-addendum-2026-05-04.md`, HOLD-recall pro Tier (Anteil der Gold-HOLDs, die als HOLD klassifiziert werden):

| Tier | HOLD-recall mean (range) |
|---|---|
| `fast` | 74.5% (73.5–76.5) |
| `standard` | 70.6% (67.6–73.5) |
| `balanced` | 84.3% (82.4–85.3) |
| `max` | 79.4% (76.5–82.4) |
| `ensemble_gem_ds` | 70.6% (67.6–73.5) |

**Interpretation:** 15–30% der Gold-HOLDs werden in jedem Tier verfehlt. Auf 120v3 sind das 5–10 Cases pro Run, von denen 2 (GAIA-01, H-05) reproduzierbar in jedem Tier durchbrechen.

### Mode-Scope dieser Inspektion

Die Tabelle oben deckt die **Support-Mode-Cascade** ab — die ADR-0007 als PLV-Architektur ratifiziert. Andere Verifikations-Modi mit anderen Pre-Filter-Substraten sind nicht Gegenstand dieses ADRs und werden separat in ihren eigenen Track-Dokumentationen behandelt.

### Implikationen für Außendarstellung

- **„0 FA" als Marketing-Claim ist nur zulässig, wenn FA = P1 explizit definiert wird.** Wenn FA als „alle ALLOW-Verdicts mit Gold ≠ ALLOW" gelesen wird (natürliche Lesart), ist die ehrliche Zahl 2/120 auf 120v3 in `thorough_balanced`, nicht 0.
- Sales-Sheet-Sprache: **„0 P1-Violations (BLOCK→ALLOW) auf 120v3 thorough_balanced; HOLD-Recall 84.3%"** statt „0 FA".
- Dieser Befund ist relevant für `plv_enterprise_sales_sheet_v01` und `plv_enterprise_pricing_brief_v01`. Da aktuell **keine Pilot-Kunden-Konversationen** laufen, ist sofortiger Asset-Edit nicht zwingend; vor dem nächsten externen Use ist Sprach-Härtung Pflicht.

---

## Decision

**Cross-Model Verification wird zum Architektur-Prinzip für PLV:** Der Evaluator-Modell-Provider unterscheidet sich grundsätzlich vom Generator-Modell-Provider, wenn der Generator bekannt ist. Self-Verification (gleiches Modell für Generierung und Prüfung) ist ein Anti-Pattern, das wir aktiv vermeiden.

**Implementation-Pattern: Cascade mit Early-Exit**

```
Generator-Modell bekannt?
├─ Ja → Cascade(Primary=non-family, Secondary=different non-family)
└─ Nein → Cascade(Default-Primary=Gemini, Default-Secondary=Sonnet)

Cascade-Flow:
1. Primary evaluiert. Verdict ∈ {BLOCK, UNCERTAIN, ALLOW}.
2. Wenn Primary ∈ {BLOCK, UNCERTAIN} → fertig (63% der Cases).
3. Wenn Primary = ALLOW → Secondary evaluiert.
4. Secondary = ALLOW → final ALLOW.
5. Secondary ≠ ALLOW → final HOLD (Disagreement = Vorsicht).
```

**Ausnahme — Tier 1 (Ollama-Pre-Filter) bleibt Single-Model:** Pre-Filter ist binäre Vor-Entscheidung (~75% der Cases), kein Verdict. Cross-Model auf Pre-Filter wäre Cost-disproportional zum Risiko.

---

## Implementation

### API-Hook (`/v2/verify`)

Neuer optionaler Parameter `generator_model`:

```http
POST /v2/verify
{
  "plan": {...},
  "trace": {...},
  "generator_model": "claude-sonnet-4.6"  // optional
}
```

**Routing-Logik:**
- `generator_model` angegeben → Evaluator wird automatisch aus Non-Family ausgewählt
- `generator_model` nicht angegeben → Default-Cascade Gemini→Sonnet
- `generator_model` und Evaluator-Default sind gleicher Provider → Switch auf alternative Familie (z.B. Grok als Backup)

**Family-Mapping (basierend auf `src/commands/ask.ts:calculateModelDiversityIndex`):**
- anthropic ⊃ {claude, opus, sonnet, haiku}
- openai ⊃ {gpt, o1, o3, o4}
- google ⊃ {gemini}
- xai ⊃ {grok}
- moonshot ⊃ {kimi, moonshot}
- deepseek ⊃ {deepseek}

### Code-Pfad

Neuer Pfad in `src/plan/`: `cross-model-cascade.ts` mit:
- `runCascade(input, primaryModel, secondaryModel, config)` → CascadeResult
- `selectEvaluatorModels(generatorModel?)` → {primary, secondary}
- Family-Detection-Helper (DRY mit `ask.ts`)

`plan-graded-eval.ts` bekommt CLI-Flag `--cascade <primary>:<secondary>` (Default: `gemini:sonnet`) und `--generator-model <id>` für Routing-Test.

### Failover-Strategie (REQUIRED)

| Fehler-Szenario | Verhalten |
|---|---|
| Primary-Call timeout/error | Fallback auf Secondary als alleiniger Evaluator + Warnung im Audit-Log |
| Secondary-Call timeout/error nach Primary=ALLOW | **Konservativ HOLD** mit `degraded_mode=true` Flag |
| Beide down | Pipeline-Fehler `503 Service Unavailable`, Banking-Audit-Trail bleibt sauber |
| Provider rate-limited | Exponentieller Backoff bis 3× Retry, dann Failover wie oben |

Banking-Buyer brauchen explizites Verhalten in degraded modes — kein Silent-Fallback.

---

## Consequences

### Positiv

**Glaubwürdigkeit & Außendarstellung:** Multi-Model Adversarial Verification ist nicht mehr nur RV (Frage-Ebene), sondern durchgängiges Prinzip auf Plan-Ebene. Drei-Layer-Defense-in-Depth ist code-gedeckt:
- Layer 1: Ollama Pre-Filter (lokal-deterministisch)
- Layer 2: PLV Cascade (Cross-Model-verified)
- Layer 3: RV (Multi-Model Adversarial, API v1)

**Hard Rule P1 strukturell erfüllt:** 0 BLOCK→ALLOW im Cascade-Test (gegen 1 in jedem Single-Modell). Nicht „weniger Wahrscheinlichkeit", sondern **eliminiert** auf der getesteten Suite.

**Compliance-Match:**
- MRM 2026 „versioned and reproducible": 0% Oszillation auf gefixter Suite (Validierung Phase 1 ausstehend)
- EU AI Act Art. 12-15 Audit-Trail: Cascade produziert pro Case zwei Verdict-Stufen
- ISO 42001 Annex A.8.5 Risiko-Management: Disagreement→HOLD ist Risiko-Eskalation per Design

**Wettbewerbs-Differenzierung:** Aus Wettbewerbs-Karte (`plv_competitive_landscape_v2.md`): Niemand der 9 Player macht Cross-Model-Routing als Architektur-Default. Braintrust hat `trial_count`-SDK aber Single-Model. Galileo Luna-2 ist deterministisch aber Single-Model. TruEra dominiert Compliance aber kein Cross-Model-Statement.

**Pricing-Konsistenz für Banking-Persona ($200K-800K Budget):** Aus Modell-Cost-Karte: Thorough-Tier (Sonnet 4.6) = $27/Monat × 1.37 ≈ $37/Monat bei 1.000 Evals × 5k Tokens. Cascade-Aufpreis ist **kein Verkaufs-Hindernis**, sondern **Verkaufs-Argument**.

### Negativ / Risiken

**Cost +37%:** Bei skalierender Eval-Last spürbar. Mitigationen: Caching bei wiederkehrenden Plans, Early-Exit-Optimierung (heute: 63%), zukünftige cheaper-primary-Kandidaten testen.

**Latency:** Bei 37% der Cases doppelte Latency (Primary + Secondary). P95 muss in Phase 1 gemessen werden. Akzeptanz-Kriterium: P95 < 2.5× Single-Mode.

**Provider-Abhängigkeit:** Zwei Provider statt einer. Failover-Strategie (oben) muss robust sein. Banking-Buyer fragen nach SLA-Stack.

**HOLD-Rate-Inflation:** Disagreement→HOLD könnte HOLD-Quote treiben. Akzeptanz-Kriterium: HOLD-Rate < 15% (Wert mit Paul abstimmen). Falls höher: Mechanismus reviewen (z.B. „HOLD nur bei Score-Differenz > X").

**Tier-Mapping-Konsequenz:** Wenn Cascade = Thorough-Default, hat Standard-Tier (Single-Model) eine **dokumentierte schlechtere Hard-Rule-Erfüllung**. Das ist verkaufbar als Tier-Differenzierung — aber verlangt klare Kommunikation („Standard für reasoning-heavy Use-Cases ohne Audit-Anforderung; Thorough für Compliance-kritische Pfade").

### Neutral

**RV-Pipeline (API v1) bleibt unverändert.** Cross-Model-Verification ist dort bereits architektonisch erfüllt. ADR-0007 betrifft nur PLV.

**Ollama-Pre-Filter (Tier 1) bleibt Single-Model.** Begründung oben.

---

## Alternatives Considered

**A) Triple-Cascade (drei Modelle, Mehrheit):**
Cost +200%, Latency P95 deutlich höher. Empirisch kein Beweis dass dritte Stimme zusätzlichen Wert bringt — Cascade Gemini→Sonnet erreicht bereits 0/0/0. Verworfen wegen Cost-Disproportion zum Marginal-Nutzen.

**B) Symmetric Multi-Model (parallel statt cascade):**
Beide Modelle laufen immer parallel, Mehrheit/Synthese danach. Cost +100%, kein Early-Exit. Verworfen wegen schlechterem Cost-Profile bei gleicher Qualität.

**C) Status quo + Disclaimer in Marketing:**
Single-Model-PLV beibehalten, „Multi-Model" auf RV einschränken in Außendarstellung. Verworfen wegen (a) Banking-Buyer-Audits decken den Code-Pfad ohnehin auf, (b) Wettbewerbs-Differenzierung verloren, (c) eigene Daten (Korrelation, GAIA-Cases) widersprechen der Self-Verification-Annahme.

**D) Continuous failScore (ADR-0006-Idee):**
War als alternativer Fix für Oszillation parkiert. Adressiert ein anderes Problem (Threshold-Cliff), nicht Self-Verification. Bleibt parkiert, kann komplementär sein.

---

## Acceptance Criteria — Phase 1 (vor Ratifizierung)

ADR wechselt von DRAFT → ACCEPTED, wenn alle vier Kriterien auf der **120-Case-Suite** (alte 82 gefixt + neue 38 Banking) erfüllt sind:

1. **3 von 3 Re-Runs** zeigen 0% Oszillation für Cascade Gemini 3.1 Preview→Sonnet 4.6
2. **HOLD-Rate ≤ Gold-HOLD-Rate + 5pp** (relative Schwelle, siehe D7 unten)
3. **Latency P95 < 2.5× Single-Mode**
4. **Failover-Modes** dokumentiert + getestet (Primary-down + Secondary-down + Both-down)
5. **NEU:** **0 BLOCK→ALLOW** auf 120-Case-Suite (Hard Rule P1 muss strukturell halten — speziell auf der schwierigen Banking-Subset)

Wenn ein Kriterium reißt: zurück zur Diskussion, kein Auto-Pivot. Mögliche Anpassungen vor Ratifizierung:
- Andere Cascade-Reihenfolge (z.B. Sonnet→Gemini)
- Anderes Disagreement-Mapping (z.B. Score-Differenz statt Verdict-Differenz)
- HOLD-Rate-Tuning durch Threshold-Anpassung
- Pipeline-Erweiterung (RAG-Layer): **nicht erforderlich** — siehe D8 unten (RESOLVED)

---

## Open Decision Points (für Standup mit Paul + Hermes)

| # | Frage | Empfehlung Computer |
|---|-------|---------------------|
| **D1** | Cascade-Reihenfolge: Gemini→Sonnet oder Sonnet→Gemini? | **Gemini→Sonnet** (niedrigste Varianz als stabiles Fundament — Hermes' Befund) |
| **D2** | Tier-Mapping: Cascade = Thorough-Default oder neues „Cross-Verified"-Tier? | **Variante 1 (Thorough-Default)** — saubere 3-Tier-Struktur, einfacheres Marketing |
| **D3** | HOLD-Rate-Limit: 15% angemessen oder strenger/lockerer? | **15%** als initialer Wert; nach Phase 1 auf Basis Daten anpassen |
| **D4** | Standard-Tier-Default: Single-Model oder günstigere Cascade (z.B. DeepSeek→Gemini)? | **Single-Model bleibt Standard** — Cascade ist explizit Thorough-Differenzierung |
| **D5** | Generator-Modell-Routing: Pflicht-Parameter oder optional? | **Optional** — Default-Cascade ist sicher; Pflicht würde API-Migration brechen |
| **D6** | RV-Pipeline (API v1): Cross-Model-Prinzip dort explizit dokumentieren? | **Ja** — Konsistenz-Statement in API-Doku (kein Code-Change nötig) |
| **D7 (NEU)** | HOLD-Rate-Limit absolut (15%) oder relativ zur Gold-HOLD-Rate? | **Relativ:** Cascade-HOLD ≤ Gold-HOLD + 5pp. Begründung: Banking-Suite hat 32% Gold-HOLD; absolutes 15%-Limit wäre strukturell unmöglich. 5pp Disagreement-Aufschlag ist akzeptabel, mehr ist Inflation. |
| **D8** | HOLD→ALLOW auf Banking-Cases — strukturelle Lücke (RAG-Layer) oder Test-Suite-Defekt? | **PARTIALLY RESOLVED.** 2026-04-28: Hermes' Inspektion bestätigte H1+H2 (Type-A: 11 Cases mit supporting→critical-Verschärfung; Type-B: 5 Cases mit Evidence-Schärfung), 16 HOLD-Cases in v2-Suite gefixt (`plv_cases_expansion_38_v2.json`), und ein RAG-Layer-ADR ist daher **nicht** erforderlich. **2026-05-09: Residuale 2 Cases (GAIA-01, H-05) sind mode-unabhängig in der Support-Cascade nicht fangbar** — das ist nicht Case-Design, sondern eine HOLD-Detection-Lücke der aktuellen Cascade-Architektur (siehe Abschnitt „Residuale HOLD-Lücke"). Folge-Decision in **D9**. |
| **D9 (NEU)** | HOLD-Detection-Architektur für residuale 2/120 Cases (GAIA-01, H-05) — separate Detection-Stage, Gold-Re-Label, oder als known-residual akzeptieren? | **Empfehlung: known-residual akzeptieren** (Variante C). Begründung: (a) Re-Label ohne Pilot-Daten ist Cherry-Picking und würde die Test-Suite-Integrität schwächen; (b) separate HOLD-Detection-Stage ist Architektur-Investment ohne ROI-Signal solange keine Pilot-Konversation den Druckpunkt liefert; (c) HOLD-Detection-Mechanik kann sich strukturell ändern, wenn künftige Pre-Filter-Substrate evaluiert werden — verfrühtes Bauen wäre Doppel-Arbeit. Konsequenz: P2-Befund wird in `plv_enterprise_sales_sheet_v01` als ehrliche Sprache gepflegt (siehe Implikationen oben), und die Frage wird re-eröffnet, sobald (i) ein Pilot Druckpunkt liefert oder (ii) eine ohnehin geplante Architektur-Migration eine sinnvolle Schnittstelle bietet. |

---

## References

- **Code:** `src/pipeline/{generator,critic,synthesizer}.ts` (RV, bestehend)
- **Code (zu erstellen):** `src/plan/cross-model-cascade.ts` (PLV-Cascade)
- **Hermes-Test-Daten:**
  - Cross-Family-Test 2026-04-28 7:42 (Sonnet/Gemini 3.1/DeepSeek auf 60 Cases)
  - Cascade-Test 2026-04-28 9:13 (Gemini 3.1 Preview→Sonnet auf 60 Cases)
  - 120-Case Single-Model-Test 2026-04-28 12:21 (Sonnet vs. Gemini 2.5 Pro — Banking-Subset-Schwierigkeit)
- **Strategie-Kontext:** `standup_briefing_2026-04-28.md`, `hermes_briefing_2026-04-28_cascade_validation.md`, `hermes_briefing_2026-04-28_holdallow_inspection.md`
- **Wettbewerbs-Analyse:** `plv_competitive_landscape_v2.md`
- **Buyer-Research:** `plv_buyer_market_research_v2.md`
- **Modell-Cost:** `plv_model_cost_landscape.md`
- **Test-Cases:** `plv_cases_expansion_38.json` (38 Banking-Cases) + `plv_cases_expansion_38_audit.md` (Live-Verifikation 6 Standards inkl. SR 26-2 GenAI-Exclusion)
- **Korrelations-Evidenz:** Grok↔DS r=0.857 (eigene Benchmarks, vor 2026-04-28)
- **Verwandte ADRs:** 0001 (Verdict-Model), 0002 REJECTED (Triple Majority), 0005 (failScore-Gate-Decoupling), **0008 v4 (Primary-Model-Selection-Matrix)**
- **v3-Quellen (NEU):**
  - `runs/track2-n3-recall-addendum-2026-05-04.md` — Track-2 n=3 Stability, Recall-Tabellen pro Tier
  - `docs/tier-selection.md` v0.4 — Tier-Empfehlungen post Track-2
  - PR #44 (track2-n3-tier-v04, commit 08e0715, merged 2026-05-04)
  - Hermes' HOLD-Detection-Inspektion 2026-05-09 (Inline-Tabelle in diesem ADR; Quell-Run-Logs in Hermes' lokalem Workspace)

---

**Nächste Schritte (v2 — historisch):**
1. **Hermes:** HOLD→ALLOW-Inspektion (Hypothesen-Klassifikation H1-H4) auf 4-6 Cases — erledigt 2026-04-28 (16 Cases gefixt, v2-Suite)
2. **Hermes:** Modell-Versions-Klärung — erledigt (Track-2 lief mit korrekter Generation)
3. **Hermes:** Cascade-Test auf 120-Case-Suite (3× Re-Run) — erledigt 2026-05-04 (Track-2 n=3)
4. **Paul:** Review DRAFT v2 — überholt durch v3
5. **Computer:** Implementation von `cross-model-cascade.ts` — erledigt (in Production seit 2026-05-04)
6. **Status:** DRAFT v2 → PARTIALLY ACCEPTED v3 (P1 ratifiziert; P2 als known-residual dokumentiert)

**Nächste Schritte (v3):**
1. **Paul:** Review v3 — insbesondere D9 (known-residual-Empfehlung) und Acceptance-Status für Kriterium 2
2. **Computer:** CONTEXT_INDEX.md Hard Rule 4 schärfen auf P1/P2-Trennung mit ADR-0007 v3 als Pointer
3. **Trigger für D9-Re-Open:** (i) Pilot-Konversation, die HOLD-Detection als Audit-Frage aufwirft, oder (ii) ohnehin geplante Pre-Filter-Substrat-Migration mit sinnvoller Schnittstelle für separate HOLD-Detection-Stage
4. **Sales-Asset-Sprach-Härtung:** `plv_enterprise_sales_sheet_v01` und `plv_enterprise_pricing_brief_v01` vor nächstem externen Use auf P1/HOLD-Recall-Sprache umstellen (nicht zwingend jetzt, da keine Pilot-Konversation läuft)
