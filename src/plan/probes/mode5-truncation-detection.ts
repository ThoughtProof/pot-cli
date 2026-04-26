/**
 * Mode 5 — LLM-Truncation Cross-Line Detection (SKIZZE — NICHT MERGEN)
 *
 * Status: Branch feat/plv-mode5-probes-sketch — Diskussionsgrundlage für Paul.
 * Bezug:  Investigation-Briefing plv_mode5_truncation_briefing.md (2026-04-26)
 *         Follow-up zu PR #5 (a3ff0be) und PR #6 (d390167).
 *
 * Diese Probes sind reine READ-PATH-Detektoren. Sie ändern nichts am
 * Verdict, am Matcher, oder am Audit-Trail-Output, bis sie explizit
 * verdrahtet werden. Aktuell unbenutzt.
 *
 * Architektur-Punkt: Mode 5 ist ein Provider-Output-Phänomen, kein
 * Matcher-Bug. Der Matcher rejected die korrumpierte Quote zu Recht.
 * Wir machen das Phänomen sichtbar (Audit), nicht tolerabel.
 *
 * Akzeptanzkriterien siehe Briefing §4 (A1-A5). A4 ist die wichtige:
 * Net-0 Verdict-Change beim Wiring.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type Mode5Signal =
  | 'cross_line_fragment_tail'   // Probe 5a
  | 'mid_word_termination'       // Probe 5b
  | 'bridge_span_concat';        // Probe 5c

export interface Mode5Detection {
  signals: Mode5Signal[];
  fragmentTail?: string;
  matchedSpan?: [number, number];
  bridgeHalves?: { left: string; right: string };
}

// ─── Probe 5a: Linebreak-in-Quote-Detector ─────────────────────────────────

/**
 * Pattern aus CODE-02 step_1: Quote endet auf "...\nStep 4 [se".
 * Tail ist kurz, fragmentartig, beginnt typischerweise mit Großbuchstabe
 * oder Bracket — und matcht im Trace als Anfang einer ANDEREN Zeile.
 *
 * Heuristik bewusst eng. False-Positives sind teurer als False-Negatives,
 * weil Mode 5 Audit-Label zu falschem Misstrauen führen würde.
 */
export function detectCrossLineFragmentTail(
  quote: string,
  trace: string,
): {
  isCrossLine: boolean;
  fragmentTail: string | null;
  matchedSpan: [number, number] | null;
} {
  const lastNewline = quote.lastIndexOf('\n');
  if (lastNewline === -1) {
    return { isCrossLine: false, fragmentTail: null, matchedSpan: null };
  }

  const tail = quote.slice(lastNewline + 1).trim();

  // Tail muss kurz und fragmentartig wirken:
  //  - max 16 Zeichen (CODE-02: "Step 4 [se" = 10)
  //  - beginnt mit Letter oder öffnender Klammer
  const looksFragmentary =
    tail.length > 0 &&
    tail.length <= 16 &&
    /^[A-Za-z\[\(]/.test(tail);

  if (!looksFragmentary) {
    return { isCrossLine: false, fragmentTail: tail, matchedSpan: null };
  }

  // Trace muss den Tail als Beginn einer NEUEN Zeile enthalten,
  // nicht innerhalb einer Zeile. Das unterscheidet echte Cross-Line-
  // Truncation von zufälligem Substring-Match.
  const linePrefixed = '\n' + tail;
  const idx = trace.indexOf(linePrefixed);

  return {
    isCrossLine: idx !== -1,
    fragmentTail: tail,
    matchedSpan: idx !== -1 ? [idx + 1, idx + 1 + tail.length] : null,
  };
}

// ─── Probe 5b: Mid-Word-Termination-Detector ───────────────────────────────

/**
 * Quotes, die mitten im Wort, in einer öffnenden Klammer, oder in einem
 * URL-Schema-Präfix abbrechen. Pattern aus CODE-02: "...[se", aus
 * Streaming-Cutoffs typisch: "...(http", "...The".
 *
 * Wichtig: einzeln nicht aussagekräftig — eine Quote kann legitim auf
 * einem Buchstaben enden, wenn der Source-Text dort ebenfalls endet.
 * Erst in Kombination mit 5a oder 5c wird daraus ein Mode-5-Signal.
 */
export function detectMidWordTermination(quote: string): {
  isMidWord: boolean;
  endingChar: string;
} {
  // Nur trailing whitespace strippen — Punkte/Ellipsen/?/! bleiben,
  // weil sie legitime Satzenden markieren. Wenn das Quote-Ende auf
  // Satzzeichen liegt, ist es CLEAN.
  const trimmed = quote.replace(/\s+$/, '');
  if (trimmed.length === 0) {
    return { isMidWord: false, endingChar: '' };
  }
  const last = trimmed.slice(-1);

  // Mid-word-Indikatoren:
  //  - Buchstabe (Wort abgeschnitten)
  //  - Öffnende Klammer "[" oder "("
  // NICHT mid-word: . , ; : ! ? " ' ) ] …
  const isMidWord = /[A-Za-z\[\(]/.test(last);

  return { isMidWord, endingChar: last };
}

// ─── Probe 5c: Bridge-Span-Detector ────────────────────────────────────────

/**
 * Quote ist Konkatenation von zwei Source-Spans, die im Trace nicht
 * benachbart sind. Erkennen via: Split an "\n", beide Hälften
 * matchen einzeln im Trace, aber NICHT als zusammenhängender Span.
 */
export function detectBridgeSpan(
  quote: string,
  trace: string,
): {
  isBridge: boolean;
  halves: { left: string; right: string } | null;
} {
  const newlineIdx = quote.indexOf('\n');
  if (newlineIdx === -1) {
    return { isBridge: false, halves: null };
  }

  const left = quote.slice(0, newlineIdx).trim();
  const right = quote.slice(newlineIdx + 1).trim();

  if (left.length < 8 || right.length < 4) {
    // Zu kurz, um aussagekräftig zu sein
    return { isBridge: false, halves: { left, right } };
  }

  const leftIdx = trace.indexOf(left);
  const rightIdx = trace.indexOf(right);

  if (leftIdx === -1 || rightIdx === -1) {
    return { isBridge: false, halves: { left, right } };
  }

  // Beide Hälften gefunden. Bridge wenn sie NICHT als zusammenhängender
  // Span im Trace stehen.
  const concatenated = `${left}\n${right}`;
  const concatIdx = trace.indexOf(concatenated);
  const isBridge = concatIdx === -1;

  return { isBridge, halves: { left, right } };
}

// ─── Aggregator ────────────────────────────────────────────────────────────

/**
 * Lauf alle drei Probes und sammle Signale. Konsumenten:
 *   - Audit-Trail (PROV_TRACE: mode=5_*)
 *   - Statistik-Sweep über das Benchmark-Set
 *
 * NICHT: Verdict-Logik. Probes sind Read-Path-only.
 */
export function detectMode5(
  quote: string,
  trace: string,
): Mode5Detection {
  const signals: Mode5Signal[] = [];

  const a = detectCrossLineFragmentTail(quote, trace);
  if (a.isCrossLine) signals.push('cross_line_fragment_tail');

  const b = detectMidWordTermination(quote);
  if (b.isMidWord) signals.push('mid_word_termination');

  const c = detectBridgeSpan(quote, trace);
  if (c.isBridge) signals.push('bridge_span_concat');

  return {
    signals,
    fragmentTail: a.fragmentTail ?? undefined,
    matchedSpan: a.matchedSpan ?? undefined,
    bridgeHalves: c.halves ?? undefined,
  };
}
