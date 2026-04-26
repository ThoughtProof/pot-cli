/**
 * Provenance Diagnostics — non-behavioral instrumentation for verifyProvenance.
 *
 * Goal: when a quote fails to match the trace, capture enough information to
 * distinguish the four failure modes without changing scoring behavior:
 *   Mode 1 — Tokenization (smart quotes, NBSP, em-dash, smart apostrophes)
 *   Mode 2 — Paraphrase (semantically close, lexically different)
 *   Mode 3 — Structural / quote-around-quote (LLM wraps a meta-quote)
 *   Mode 4 — Wrong-source (correct content, unauthorized provenance) — handled by R6
 *
 * This module is intentionally side-effect-free. It returns a structured
 * report; callers decide whether to log / persist / display.
 *
 * See: pot-cli issue 'fix/provenance-matcher-diagnostic'
 */

export interface ProvenanceMatchPath {
  exact: boolean;
  whitespaceNormalized: boolean;
  fuzzyTruncated: boolean;
  finalResult: 'exact' | 'whitespace-normalized' | 'fuzzy-truncated' | 'no-match';
}

export interface ProvenanceCharDiff {
  /** Position in the trace where the longest common prefix ends, or -1 if no shared prefix */
  partialFindPosition: number;
  /** Length of the longest common prefix between the quote and any trace substring */
  partialFindLength: number;
  /** Hex dump of the first 60 bytes of the quote (UTF-8) */
  quoteHexDump: string;
  /** Hex dump of the trace fragment at partialFindPosition (60 bytes) */
  traceHexDump: string;
  /** First differing character position within the partial match */
  firstDifferenceAt: number;
  /** Codepoint of the quote char at the difference */
  quoteCodepoint: number | null;
  /** Codepoint of the trace char at the difference */
  traceCodepoint: number | null;
}

export interface ProvenanceDiagnosticReport {
  step_id: string;
  quote_present: boolean;
  quote_length: number;
  match_path: ProvenanceMatchPath;
  char_diff: ProvenanceCharDiff | null;
  /** Heuristic guess at the failure mode, for triage. Not authoritative. */
  suspected_mode:
    | 'mode_1_tokenization'
    | 'mode_2_paraphrase'
    | 'mode_3_structural'
    | 'mode_4_wrong_source'
    | 'matched'
    | 'no_quote'
    | 'inconclusive';
  suspected_mode_signals: string[];
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Find the longest substring of `quote` that appears in `trace`,
 * starting from quote[0]. Returns the length of the prefix that did match.
 *
 * O(n*m) but only invoked on already-failed matches in diagnostic mode,
 * so cost is fine for traces under ~50KB.
 */
export function longestPrefixFound(quote: string, trace: string): { position: number; length: number } {
  if (quote.length === 0) return { position: -1, length: 0 };
  // Try shrinking the prefix until we find one that occurs in the trace.
  for (let len = quote.length; len >= 8; len--) {
    const prefix = quote.substring(0, len);
    const idx = trace.indexOf(prefix);
    if (idx !== -1) return { position: idx, length: len };
  }
  return { position: -1, length: 0 };
}

export function hexDump(s: string, maxBytes: number = 60): string {
  const buf = Buffer.from(s, 'utf-8').subarray(0, maxBytes);
  // Format as: "61 62 63 e2 80 99" — easy to spot non-ASCII bytes
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

/**
 * Detect tokenization signals in the quote OR the trace fragment:
 * smart quotes, NBSP, em-dash, ellipsis char, ZWSP. Returns list of names found.
 */
export function detectTokenizationSignals(s: string): string[] {
  const signals: string[] = [];
  if (/[\u2018\u2019]/.test(s)) signals.push('smart_apostrophe');
  if (/[\u201C\u201D]/.test(s)) signals.push('smart_quote');
  if (/\u00A0/.test(s)) signals.push('nbsp');
  if (/[\u2013\u2014]/.test(s)) signals.push('en_or_em_dash');
  if (/\u2026/.test(s)) signals.push('ellipsis_char');
  if (/[\u200B-\u200D\uFEFF]/.test(s)) signals.push('zero_width_space');
  if (/\r\n|\r/.test(s)) signals.push('crlf_newline');
  return signals;
}

/**
 * Heuristic structural-quote detection: nested quotation marks within first 30 chars.
 * (LLM behavior we've seen: wrapping a quote inside another quote.)
 */
export function looksStructural(quote: string): boolean {
  const head = quote.substring(0, 80);
  // Multiple quote chars (any kind) within the head suggest meta-quoting.
  const quoteCount = (head.match(/["'\u2018\u2019\u201C\u201D]/g) ?? []).length;
  return quoteCount >= 3;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function diagnoseProvenance(opts: {
  step_id: string;
  quote: string | null;
  trace: string;
  cleanQuote: string;
  isSubstring: boolean;
  isNormalizedMatch: boolean;
  isFuzzyMatch: boolean;
  /** Optional reasoning text from the upstream evaluator — used for Mode-4 hints */
  evaluatorReasoning?: string;
}): ProvenanceDiagnosticReport {
  const {
    step_id,
    quote,
    trace,
    cleanQuote,
    isSubstring,
    isNormalizedMatch,
    isFuzzyMatch,
    evaluatorReasoning,
  } = opts;

  const match_path: ProvenanceMatchPath = {
    exact: isSubstring,
    whitespaceNormalized: isNormalizedMatch,
    fuzzyTruncated: isFuzzyMatch,
    finalResult: isSubstring
      ? 'exact'
      : isNormalizedMatch
      ? 'whitespace-normalized'
      : isFuzzyMatch
      ? 'fuzzy-truncated'
      : 'no-match',
  };

  if (quote === null) {
    return {
      step_id,
      quote_present: false,
      quote_length: 0,
      match_path,
      char_diff: null,
      suspected_mode: 'no_quote',
      suspected_mode_signals: [],
    };
  }

  if (isSubstring || isNormalizedMatch || isFuzzyMatch) {
    return {
      step_id,
      quote_present: true,
      quote_length: quote.length,
      match_path,
      char_diff: null,
      suspected_mode: 'matched',
      suspected_mode_signals: [],
    };
  }

  // Match failed. Build char diff.
  const { position, length } = longestPrefixFound(cleanQuote, trace);
  let char_diff: ProvenanceCharDiff | null = null;

  if (position >= 0) {
    const traceFragment = trace.substring(position, position + cleanQuote.length + 4);
    // First difference position
    let firstDiff = length;
    const quoteCp = firstDiff < cleanQuote.length ? cleanQuote.codePointAt(firstDiff) ?? null : null;
    const traceCp = firstDiff < traceFragment.length ? traceFragment.codePointAt(firstDiff) ?? null : null;

    char_diff = {
      partialFindPosition: position,
      partialFindLength: length,
      quoteHexDump: hexDump(cleanQuote),
      traceHexDump: hexDump(traceFragment),
      firstDifferenceAt: firstDiff,
      quoteCodepoint: quoteCp,
      traceCodepoint: traceCp,
    };
  } else {
    char_diff = {
      partialFindPosition: -1,
      partialFindLength: 0,
      quoteHexDump: hexDump(cleanQuote),
      traceHexDump: '',
      firstDifferenceAt: 0,
      quoteCodepoint: cleanQuote.codePointAt(0) ?? null,
      traceCodepoint: null,
    };
  }

  // Suspect-mode classification (heuristic, for triage only).
  const signals: string[] = [];
  const tokSig = detectTokenizationSignals(cleanQuote);
  const traceWindow = position >= 0 ? trace.substring(Math.max(0, position - 5), position + cleanQuote.length + 5) : '';
  const tokSigTrace = detectTokenizationSignals(traceWindow);
  if (tokSig.length > 0) signals.push(`quote:${tokSig.join(',')}`);
  if (tokSigTrace.length > 0) signals.push(`trace:${tokSigTrace.join(',')}`);

  if (looksStructural(cleanQuote)) signals.push('structural_meta_quote');

  // Mode-4 (wrong source) hints from upstream reasoning, if provided.
  if (evaluatorReasoning && /wikipedia|blog|secondary|different source|wrong source/i.test(evaluatorReasoning)) {
    signals.push('reasoning_hints_wrong_source');
  }

  // Pick the most likely mode. Order matters: tokenization first because it has
  // a high-confidence test (specific codepoints), structural second, paraphrase last.
  let suspected_mode: ProvenanceDiagnosticReport['suspected_mode'] = 'inconclusive';

  if (signals.some(s => s.startsWith('quote:') || s.startsWith('trace:'))) {
    // Confirm: at the firstDifferenceAt position, is the quote codepoint > 127?
    if (char_diff && (char_diff.quoteCodepoint ?? 0) > 127) {
      suspected_mode = 'mode_1_tokenization';
    } else if (char_diff && (char_diff.traceCodepoint ?? 0) > 127) {
      suspected_mode = 'mode_1_tokenization';
    } else {
      suspected_mode = 'mode_1_tokenization';
    }
  } else if (signals.includes('structural_meta_quote')) {
    suspected_mode = 'mode_3_structural';
  } else if (signals.includes('reasoning_hints_wrong_source')) {
    suspected_mode = 'mode_4_wrong_source';
  } else if (length >= 8 && length < cleanQuote.length * 0.6) {
    // Partial prefix matched but diverged early — likely paraphrase
    suspected_mode = 'mode_2_paraphrase';
  }

  return {
    step_id,
    quote_present: true,
    quote_length: quote.length,
    match_path,
    char_diff,
    suspected_mode,
    suspected_mode_signals: signals,
  };
}
