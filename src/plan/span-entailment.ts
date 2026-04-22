/**
 * Span-entailment prototype — R6-style provenance / extraction failures.
 *
 * Scope: exact-string and near-exact-string tasks only.
 * Targeted at the two easiest R6 cases:
 *   - 4b6bb5f7 (Doctor Who S9E11 scene heading — over-specific extraction)
 *   - b816bfce (dragons article adjective — wrong word from correct source)
 *
 * Detection is purely lexical: no LLM calls, no embeddings.
 * Intended as a policy-side feature signal, not a standalone verdict.
 *
 * Limitations (documented in tests):
 *   - Negation handling is heuristic-only and local-window based
 *   - Composition support is limited to simple delimited answers (for example `a; b`)
 *   - Translation support is limited to a tiny title-oriented lexical bridge
 *   - No semantic paraphrase beyond lexical overlap (would require embeddings or LLM)
 *   - No cross-sentence entailment beyond the narrow title-translation path
 *   - `contradiction` label remains reserved for richer NLI-style extension
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SourceClaimSupport =
  | 'exact'         // claimedAnswer is a verbatim (normalized) substring of sourceText
  | 'paraphrase'    // high token overlap with a source sentence, but not verbatim
  | 'unsupported'   // no meaningful overlap found in sourceText
  | 'contradiction'; // reserved — richer NLI required; this prototype still never emits it

export type SourceClaimConfidence = 'high' | 'medium' | 'low';

export interface SpanEntailmentInput {
  /** The original question asked of the agent. */
  question: string;
  /** The answer the agent produced (possibly wrong). */
  claimedAnswer: string;
  /**
   * The source text the agent retrieved, or a relevant excerpt.
   * Supplied by the caller — this module does not fetch content.
   */
  sourceText: string;
}

export interface SpanEntailmentResult {
  support: SourceClaimSupport;
  confidence: SourceClaimConfidence;
  /**
   * Set when support === 'exact'. Contains the original-casing form of
   * the matched answer (normalized whitespace/case may differ from source).
   */
  matchedSpan?: string;
  /**
   * True when the question explicitly requests an exact-string answer
   * (e.g. "exactly as it appears", "verbatim", "word for word").
   * When true, support below 'exact' is a stronger R6 signal.
   */
  exactStringQuestion: boolean;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Lowercase + collapse internal whitespace + trim. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Split into word tokens, stripping punctuation and empty fragments. */
function tokenize(text: string): Set<string> {
  const tokens = normalize(text).split(/\W+/).filter((t) => t.length > 0);
  return new Set(tokens);
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check whether claimedAnswer appears as a verbatim substring of sourceText
 * after normalizing both (case-insensitive, whitespace-collapsed).
 *
 * Returns the claimedAnswer (trimmed) if found, null otherwise.
 * The returned value is the claimed form, not the source fragment —
 * for a prototype this is sufficient.
 */
function findExactSpan(claimedAnswer: string, sourceText: string): string | null {
  const normAnswer = normalize(claimedAnswer);
  if (normAnswer.length === 0) return null;
  const normSource = normalize(sourceText);
  return normSource.includes(normAnswer) ? claimedAnswer.trim() : null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitCompositeAnswer(claimedAnswer: string): string[] {
  if (!/[;,]/.test(claimedAnswer)) return [];
  return claimedAnswer
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const NEGATION_SIGNALS = ['not', 'no', 'never', 'without'];

function hasLocalNegationBeforeAnswer(sentence: string, claimedAnswer: string): boolean {
  const normSentence = normalize(sentence);
  const normAnswer = normalize(claimedAnswer);
  if (normSentence.length === 0 || normAnswer.length === 0) return false;

  const answerPattern = normAnswer.split(/\s+/).map(escapeRegex).join('\\W+');
  return NEGATION_SIGNALS.some((signal) => {
    const pattern = new RegExp(`(?:^|\\b)${escapeRegex(signal)}(?:\\W+\\w+){0,3}\\W+${answerPattern}(?:\\b|$)`, 'i');
    return pattern.test(normSentence);
  });
}

/** Phrases in the question that signal an exact-string answer is expected. */
const TITLE_TRANSLATION_QUESTION_SIGNALS = [
  'google translation',
  'translation of the source title',
  'translated title',
  'what is the translation',
];

const TITLE_TRANSLATION_LEXICON: Record<string, string> = {
  el: 'the',
  la: 'the',
  los: 'the',
  las: 'the',
  del: 'of the',
  de: 'of',
  mundo: 'world',
  siglo: 'century',
  veintiuno: 'twenty first',
};

const TITLE_TRANSLATION_PHRASES: Array<[string, string]> = [
  ['siglo veintiuno', 'twenty first century'],
];

const EXACT_STRING_SIGNALS = [
  'exactly as it appears',
  'exactly as they appear',
  'word for word',
  'verbatim',
  'exact wording',
  'exact phrase',
  'exact name',
  'exact title',
  'exact text',
];

function detectExactStringQuestion(question: string): boolean {
  const lower = question.toLowerCase();
  return EXACT_STRING_SIGNALS.some((sig) => lower.includes(sig));
}

function detectTitleTranslationQuestion(question: string): boolean {
  const lower = question.toLowerCase();
  return TITLE_TRANSLATION_QUESTION_SIGNALS.some((sig) => lower.includes(sig));
}

/** Split source into sentence-like fragments for per-sentence scoring. */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function hasUsableExactMatch(claimedAnswer: string, sourceText: string): boolean {
  const matchedSpan = findExactSpan(claimedAnswer, sourceText);
  if (matchedSpan === null) return false;

  const matchingSentences = splitSentences(sourceText).filter((sentence) =>
    normalize(sentence).includes(normalize(claimedAnswer))
  );

  if (matchingSentences.length === 0) return true;
  return matchingSentences.some((sentence) => !hasLocalNegationBeforeAnswer(sentence, claimedAnswer));
}

function translateTitleLikeSentence(sentence: string): string {
  let translated = sentence;
  for (const [sourcePhrase, targetPhrase] of TITLE_TRANSLATION_PHRASES) {
    translated = translated.replace(new RegExp(sourcePhrase, 'ig'), targetPhrase);
  }

  return translated
    .split(/\s+/)
    .map((token) => {
      const stripped = token.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const translated = TITLE_TRANSLATION_LEXICON[stripped];
      return translated ?? token;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function assessSpanEntailment(input: SpanEntailmentInput): SpanEntailmentResult {
  const { question, claimedAnswer, sourceText } = input;
  const exactStringQuestion = detectExactStringQuestion(question);
  const titleTranslationQuestion = detectTitleTranslationQuestion(question);

  // 1. Exact substring check (normalized, case-insensitive)
  const matchedSpan = findExactSpan(claimedAnswer, sourceText);
  if (matchedSpan !== null) {
    const matchingSentences = splitSentences(sourceText).filter((sentence) =>
      normalize(sentence).includes(normalize(claimedAnswer))
    );

    if (
      matchingSentences.length > 0 &&
      matchingSentences.every((sentence) => hasLocalNegationBeforeAnswer(sentence, claimedAnswer))
    ) {
      return {
        support: 'unsupported',
        confidence: 'high',
        exactStringQuestion,
        explanation: `"${claimedAnswer}" appears only in a locally negated source context.`,
      };
    }

    return {
      support: 'exact',
      confidence: 'high',
      matchedSpan,
      exactStringQuestion,
      explanation: `"${claimedAnswer}" found verbatim in source (normalized match).`,
    };
  }

  // 2. Simple composition support for delimited answers whose parts each appear exactly.
  const compositeParts = splitCompositeAnswer(claimedAnswer);
  if (compositeParts.length >= 2 && compositeParts.every((part) => hasUsableExactMatch(part, sourceText))) {
    return {
      support: 'paraphrase',
      confidence: 'medium',
      exactStringQuestion,
      explanation: `All ${compositeParts.length} answer parts are individually exact-supported in source text, but the composed output is not verbatim as a whole.`,
    };
  }

  // 3. Narrow title-translation bridge for questions explicitly asking for a translation.
  if (titleTranslationQuestion) {
    for (const sentence of splitSentences(sourceText)) {
      const translatedSentence = translateTitleLikeSentence(sentence);
      if (findExactSpan(claimedAnswer, translatedSentence) !== null) {
        return {
          support: 'paraphrase',
          confidence: 'medium',
          exactStringQuestion,
          explanation: `Claim matches a narrow translated title-like source span: "${translatedSentence.slice(0, 80)}"`,
        };
      }
    }
  }

  // 4. Per-sentence token overlap (paraphrase proxy via Jaccard)
  const answerTokens = tokenize(claimedAnswer);
  let bestScore = 0;
  let bestSentence = '';
  for (const sentence of splitSentences(sourceText)) {
    const score = jaccard(answerTokens, tokenize(sentence));
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  if (bestScore >= 0.5) {
    return {
      support: 'paraphrase',
      confidence: bestScore >= 0.7 ? 'high' : 'medium',
      exactStringQuestion,
      explanation: `Best sentence Jaccard=${bestScore.toFixed(2)}: "${bestSentence.slice(0, 80)}"`,
    };
  }

  // 5. Unsupported
  return {
    support: 'unsupported',
    // If the question demands exact wording, an unsupported result is high-confidence bad news.
    confidence: exactStringQuestion ? 'high' : 'medium',
    exactStringQuestion,
    explanation: `No verbatim or high-overlap match for "${claimedAnswer}" in source text.`,
  };
}
