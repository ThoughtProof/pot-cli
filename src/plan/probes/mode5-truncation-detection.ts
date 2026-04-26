/**
 * Mode 5 — LLM-Truncation Cross-Line Detection (audit-only).
 *
 * Background: PR #5 (a3ff0be) closed Mode 1 + Mode 3 via Unicode-fold and
 * structural-unwrap match paths. Audit of CODE-02 in the post-PR sweep
 * surfaced a residual class: the LLM emits a quote that crosses a trace
 * line boundary and terminates mid-token, e.g.
 *
 *     "A01:2021 — Broken Access Control covers privilege escalation.\nStep 4 [se"
 *
 * This is a generation-side artefact in Grok one-shot output (not a streaming
 * cutoff — see Mode 5 design doc Q1). The matcher correctly rejects the
 * corrupted span. These probes label such failures so the audit-trail can
 * distinguish Mode 5 from Mode 2 paraphrase (mis-classification risk
 * documented in plv_mode5_truncation_briefing.md §3).
 *
 * Architecture: pure read-path detectors. They never mutate verdicts,
 * scores, or match paths. The graded-support evaluator emits a
 * PROV_TRACE: mode_5_signals=... audit line when probes fire on a
 * no-match quote. PR #8 (R1a/F1a prompt-hardening) reduces the
 * generation rate of Mode-5 quotes; these probes label the rest.
 *
 * Acceptance: Net-0 verdict change vs. main pre-wiring, since no probe
 * touches the violations list beyond audit-trail metadata. PR-B Net-0
 * gate is structural — no Verdict-Run required.
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
 * Pattern from CODE-02 step_1 in PR #5 audit: quote ends on "...\nStep 4 [se".
 * The post-newline tail is short, fragmentary, typically starts with an
 * uppercase letter or bracket — and matches in the trace as the START of
 * ANOTHER line.
 *
 * Heuristic intentionally narrow. False-positives are more expensive than
 * false-negatives because mis-labelling a clean quote as Mode 5 would
 * pollute the audit-trail.
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

  // Tail must look fragmentary:
  //  - max 16 chars (CODE-02 reference: "Step 4 [se" = 10 chars)
  //  - starts with letter or opening bracket
  const looksFragmentary =
    tail.length > 0 &&
    tail.length <= 16 &&
    /^[A-Za-z\[\(]/.test(tail);

  if (!looksFragmentary) {
    return { isCrossLine: false, fragmentTail: tail, matchedSpan: null };
  }

  // The trace must contain the tail as the START of a new line, not within
  // a line. This distinguishes real cross-line truncation from coincidental
  // substring matches.
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
 * Quotes that terminate mid-word, mid-bracket, or mid-URL-prefix.
 * CODE-02 reference: "...[se". Generic streaming-cutoff: "...(http", "...The".
 *
 * Standalone, this signal is weak — a quote can legitimately end on a letter
 * if the source text ends there too. Combine with 5a or 5c for confidence.
 */
export function detectMidWordTermination(quote: string): {
  isMidWord: boolean;
  endingChar: string;
} {
  // Strip only trailing whitespace — keep terminal punctuation. If the
  // quote ends on a sentence-terminator (.!?…), it's CLEAN by definition.
  const trimmed = quote.replace(/\s+$/, '');
  if (trimmed.length === 0) {
    return { isMidWord: false, endingChar: '' };
  }
  const last = trimmed.slice(-1);

  // Mid-word indicators:
  //  - Letter (word truncated)
  //  - Opening bracket "[" or "("
  // NOT mid-word: . , ; : ! ? " ' ) ] …
  const isMidWord = /[A-Za-z\[\(]/.test(last);

  return { isMidWord, endingChar: last };
}

// ─── Probe 5c: Bridge-Span-Detector ────────────────────────────────────────

/**
 * Quote concatenates two source spans that are not adjacent in the trace.
 * Detect by splitting on "\n" and checking whether both halves match
 * individually but not as a contiguous span.
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

  // Both halves must be substantive enough to carry signal. Conservative
  // thresholds to avoid false positives on header/footer fragments.
  if (left.length < 8 || right.length < 4) {
    return { isBridge: false, halves: { left, right } };
  }

  const leftIdx = trace.indexOf(left);
  const rightIdx = trace.indexOf(right);

  if (leftIdx === -1 || rightIdx === -1) {
    return { isBridge: false, halves: { left, right } };
  }

  // Both halves found. It's a bridge iff they are NOT contiguous in the trace.
  const concatenated = `${left}\n${right}`;
  const concatIdx = trace.indexOf(concatenated);
  const isBridge = concatIdx === -1;

  return { isBridge, halves: { left, right } };
}

// ─── Aggregator ────────────────────────────────────────────────────────────

/**
 * Run all three probes and collect signals. Consumers:
 *   - Audit-trail (PROV_TRACE: mode_5_signals=...)
 *   - Statistical sweep over the benchmark set
 *
 * NOT for: verdict logic. Probes are read-path only.
 *
 * Aggregation rule: 5b (mid_word_termination) is a weak standalone signal
 * (any quote ending on a letter would trigger it). It is only included in
 * the result when 5a OR 5c also fires — i.e. when there is independent
 * evidence of a cross-line or bridge pattern. This avoids polluting the
 * audit-trail with noise from legitimately word-truncated quotes.
 */
export function detectMode5(
  quote: string,
  trace: string,
): Mode5Detection {
  const a = detectCrossLineFragmentTail(quote, trace);
  const c = detectBridgeSpan(quote, trace);
  const b = detectMidWordTermination(quote);

  const signals: Mode5Signal[] = [];
  if (a.isCrossLine) signals.push('cross_line_fragment_tail');
  if (c.isBridge) signals.push('bridge_span_concat');
  // 5b only counts as confirming evidence when 5a or 5c is already firing
  if (b.isMidWord && (a.isCrossLine || c.isBridge)) {
    signals.push('mid_word_termination');
  }

  return {
    signals,
    fragmentTail: a.fragmentTail ?? undefined,
    matchedSpan: a.matchedSpan ?? undefined,
    bridgeHalves: c.halves ?? undefined,
  };
}
