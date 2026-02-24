/**
 * DPR — Dissent Preservation Rate
 *
 * Measures what fraction of critic objections are explicitly
 * addressed in the synthesis. A low DPR combined with a SAS
 * warning indicates "false consensus": the synthesizer silently
 * discarded objections rather than resolving them.
 *
 * DPR = preserved_objections / total_objections  (0.0 – 1.0)
 * false_consensus = DPR < 0.4 AND sasWarning AND total_objections >= 2
 */

// Stronger markers only — "but" removed (too many false positives)
const OBJECTION_MARKERS = [
  'however', 'incorrect', 'wrong', 'unverified',
  'fails', 'hallucination', 'no evidence', 'questionable',
  'not supported', 'inaccurate', 'misleading', 'contradicts',
  'unsupported', 'no proof', 'unfounded', 'disputed',
  'lacks evidence', 'cannot be verified', 'not accurate',
];

// Common words that appear in almost every text — exclude from key terms
const STOPWORDS = new Set([
  'would', 'could', 'should', 'their', 'there', 'about', 'other',
  'these', 'those', 'which', 'where', 'while', 'though', 'between',
  'because', 'after', 'before', 'under', 'since', 'every', 'being',
  'using', 'through', 'within', 'during', 'against', 'without',
  'always', 'often', 'model', 'models', 'agent', 'agents', 'output',
  'claim', 'claims', 'point', 'points', 'argument', 'arguments',
]);

const FALSE_CONSENSUS_THRESHOLD = 0.4;
const MIN_OBJECTIONS_FOR_DPR = 2;

export interface DPRResult {
  /** 0.0 – 1.0: fraction of critic objections preserved in synthesis */
  score: number;
  /** Number of objection sentences found in the critique */
  total_objections: number;
  /** Number of objections whose key terms appear in the synthesis */
  preserved: number;
  /** true when DPR < 0.4, SAS warned, and ≥2 objections detected */
  false_consensus: boolean;
  /** Key phrases extracted from objection sentences */
  objection_keywords: string[];
}

function sentenceTokenize(text: string): string[] {
  // Split on sentence boundaries AND markdown list items (-, *, 1.)
  const lines = text.split(/\n/);
  const segments: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Markdown bullet / numbered list item → treat as its own sentence
    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      segments.push(trimmed.replace(/^[-*•\d.]\s+/, ''));
    } else {
      // Split by sentence-ending punctuation within the line
      const subs = trimmed.split(/(?<=[.!?])\s+/);
      segments.push(...subs);
    }
  }

  return segments
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

function extractKeyTerms(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w))
    .slice(0, 6); // top 6 distinctive non-stop words
}

export function computeDPR(
  critique: string,
  synthesis: string,
  sasWarning: boolean,
): DPRResult {
  const synthesisLower = synthesis.toLowerCase();
  const sentences = sentenceTokenize(critique);

  const objectionSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return OBJECTION_MARKERS.some(marker => lower.includes(marker));
  });

  const total_objections = objectionSentences.length;

  if (total_objections === 0) {
    return {
      score: 1.0,
      total_objections: 0,
      preserved: 0,
      false_consensus: false,
      objection_keywords: [],
    };
  }

  const allKeywords: string[] = [];
  let preserved = 0;

  for (const sentence of objectionSentences) {
    const terms = extractKeyTerms(sentence);
    allKeywords.push(...terms);
    // "Preserved" if at least 2 key terms (or >25% if fewer terms) appear in synthesis
    const hits = terms.filter(t => synthesisLower.includes(t)).length;
    const threshold = terms.length >= 6 ? 2 : Math.max(1, Math.ceil(terms.length * 0.25));
    if (hits >= threshold) preserved++;
  }

  const score = parseFloat((preserved / total_objections).toFixed(4));
  const false_consensus =
    score < FALSE_CONSENSUS_THRESHOLD &&
    sasWarning &&
    total_objections >= MIN_OBJECTIONS_FOR_DPR;

  return {
    score,
    total_objections,
    preserved,
    false_consensus,
    objection_keywords: [...new Set(allKeywords)].slice(0, 20),
  };
}
