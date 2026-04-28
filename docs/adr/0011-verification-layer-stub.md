# ADR-0011: ThoughtProof PLV als Verification-Layer in InsumerAPI (Stub)

**Status:** PROPOSED (2026-04-28)
**Date:** 2026-04-28
**Authors:** Hermes (M4), Computer, Raul
**Related:** ADR-0007 (Cross-Model Verification), ADR-0009 (Answer-Consistency-Step), ADR-0010 (Domain-Onboarding-Playbook)

---

## Status-Hinweis

Dieses ADR ist ein **Stub** — bewusst kurz gehalten als Vorrats-Artefakt. Es wird ausgearbeitet, sobald die Preconditions unten erfüllt sind. Bis dahin ist es nicht handlungsleitend.

---

## These

ThoughtProof PLV wird **nicht** als eigenständige Skye-Dimension #7 verkauft (Peer-Level neben AsterPay/Revettr/etc.), sondern als **interner Verification-Layer innerhalb der InsumerAPI selbst**. Jede signierte Boolean-Attestation, die InsumerAPI nach außen ausspielt, durchläuft vorher PLV als Quality-Gate.

**Konsequenz für Customer-Modell:** Der Endkunde fragt PLV nicht aktiv an — er konsumiert InsumerAPI, und PLV ist Teil des Trust-Substrats. Verkauft wird **an InsumerAPI / Borthwick**, nicht an dessen Customer-Set.

**Begründung:** Das aktuelle Customer-Set (AsterPay, Revettr, SettlementWitness, DJD) zieht keine Reasoning-Integrity-Attestation aktiv (bestätigt durch Hermes 2026-04-28: "Kein Pull. Kein Kunde fragt Reasoning Integrity"). Standalone-Dimension hat damit keine Pull-Demand. Ein Substrat-Layer, der unsichtbar Quality liefert, hat dagegen den klassischen B2B2C-Hebel: ein Verkauf erreicht das gesamte Ökosystem.

---

## Architektur-Skizze

```
┌─────────────────────────────────────────────────────┐
│                    InsumerAPI                        │
│  ┌────────────────────────────────────────────────┐ │
│  │  POST /v1/attest, /v1/trust, /v1/verify, ...   │ │
│  │                                                 │ │
│  │  Wallet-Conditions, On-Chain-Daten              │ │
│  │              │                                  │ │
│  │              ▼                                  │ │
│  │  ┌─────────────────────────────────┐           │ │
│  │  │ ThoughtProof PLV (intern)       │           │ │
│  │  │                                 │           │ │
│  │  │ • Reasoning-Chain prüfen        │           │ │
│  │  │ • Trace→Answer Consistency      │           │ │
│  │  │ • Cross-Model Cascade           │           │ │
│  │  │ • Verdict: ALLOW / HOLD / BLOCK │           │ │
│  │  └─────────────────────────────────┘           │ │
│  │              │                                  │ │
│  │              ▼                                  │ │
│  │  Signed Boolean (ES256) + optional             │ │
│  │  PLV-Trust-Tag im Attestation-Payload          │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Tier-Stratifikation (Latenz-Kompatibilität):**

- **Tier-Lite (Hot-Path):** Cached PLV-Verdict aus letztem Deep-Eval. Sub-Sekunden. Default für InsumerAPI-Standard-Calls.
- **Tier-Deep (On-Demand):** Frischer Cascade-Eval. Mehrere Sekunden. Triggerbar via Header oder spezieller Endpoint, höherer Per-Call-Preis.

Konkrete Wire-Format-Anbindung an ERC-8183 / Skye-Spec wird ausgearbeitet, wenn Precondition 2 erfüllt ist.

---

## Preconditions (alle drei nötig, bevor dieses ADR von PROPOSED nach ACCEPTED geht)

1. **Customer-Pull bestätigt.** Mindestens ein realer Customer (im Insumer-Set oder x402-Ökosystem) signalisiert aktiv, dass eine PLV-validierte Attestation gegenüber einer unvalidierten bevorzugt würde. Bis dahin: hypothetisch.
2. **Latenz-Tier definiert.** Tier-Lite (Cache-Strategie, TTL, Invalidierung) und Tier-Deep (Trigger, Pricing-Aufschlag) sind im Detail spezifiziert und mit InsumerAPI-Maintainer (Borthwick) abgestimmt. ERC-8183-Wire-Format-Anbindung ist verifiziert oder als Spec-Erweiterung verhandelt.
3. **Douglas Buy-in.** Borthwick / Douglas haben den Verification-Layer-Frame aktiv unterstützt — nicht nur "interessant", sondern "wir wollen das im Stack haben". Ohne Co-Sponsorship aus Insumer ist die Architektur ein Side-Project.

---

## Out of Scope (explizit)

- **Skye-Dimension-#7 als Standalone-Produkt** ist abgelöst durch dieses ADR, sobald es ACCEPTED wird. Bis dahin: v1 API (api.thoughtproof.ai 1.3.7) bleibt als Dimension-#7-Endpoint frozen-as-shipped.
- **Banking-GTM** ist nicht im Scope dieses ADRs. Banking läuft als separate Sales-/Pipeline-Robustheits-Strategie weiter (siehe ADR-0010 für Onboarding-Protokoll bei Domain-Pivots).

---

## Aktueller Status (2026-04-28)

- **v1 API** (api.thoughtproof.ai, Fastify/Supabase/JWKS/x402, Version 1.3.7): live, aber null externer Traffic (Hermes-Audit). Frozen-as-shipped, bleibt als Dimension-#7-Stub bestehen.
- **Douglas** ist angefragt (kollegial, nicht als Pitch). Antwort in den nächsten Tagen erwartet.
- **Banking-First-Strategie** läuft parallel: Cascade-Phase-1 (sobald Gemini-Billing aktiv), Issue #29 (Case-Authoring), Issue #30 (BLOCK→ALLOW Tracking).

---

## Trigger zum Ausarbeiten

Dieses ADR wird von Stub auf vollwertig erweitert, wenn:
- (a) Douglas einen konkreten Test-Run oder Customer-Intro vorschlägt, **oder**
- (b) ein Customer aus dem Insumer-Set unabhängig PLV-validierte Attestations anfragt, **oder**
- (c) InsumerAPI selbst publiziertes Volumen erreicht, das den Verification-Layer ökonomisch rechtfertigt (Schwelle: zu definieren bei Ausarbeitung).

Solange keine dieser Bedingungen erfüllt ist, bleibt der Stub PROPOSED und wird nicht handlungsleitend für Sprint-Planung.
