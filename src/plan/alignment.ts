import type { PlanRecord, PlanStep, RiskFlag } from './types.js';

// ---------------------------------------------------------------------------
// Scoring weights — must sum to 1.0
// ---------------------------------------------------------------------------

type AlignmentWeights = {
  lexical: number;
  semantic: number;
  position: number;
  tool: number;
};

export const ALIGNMENT_WEIGHTS: AlignmentWeights = {
  lexical: 0.35,   // strict Jaccard on content tokens
  semantic: 0.25,  // alias + fuzzy token overlap
  position: 0.25,  // normalized position proximity within each sequence
  tool: 0.15,      // Jaccard on tool names
};

export const LEGACY_ALIGNMENT_WEIGHTS: AlignmentWeights = {
  lexical: 0.5,
  semantic: 0,
  position: 0.3,
  tool: 0.2,
};

export type AlignmentMode = 'lexical' | 'semantic';
export const DEFAULT_ALIGNMENT_MODE: AlignmentMode = 'semantic';
export const DEFAULT_ALIGNMENT_MINIMUM_SCORE = 0.25;
const MATCH_EPSILON = 1e-9;

export interface AlignmentOptions {
  minimumScore?: number;
  mode?: AlignmentMode;
}

const IMPORTANT_SHORT_TOKENS = new Set(['ai', 'api', 'cli', 'sql', 'db', 'ui', 'ux', 'qa', 'id']);

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface StepAlignment {
  agentStepId: string;
  annotatorStepId: string | null;
  /** Composite final score (weighted sum of lexical + semantic + position + tool). */
  score: number;
  lexicalScore: number;
  semanticScore: number;
  positionScore: number;
  toolScore: number;
  matched: boolean;
}

/**
 * Explanation for an annotator step that no agent plan step claimed as a match.
 */
export interface GapDescription {
  annotatorStepId: string;
  /** 1-based index of this annotator step within the annotator sequence. */
  annotatorStepIndex: number;
  /** Human-readable explanation: which agent step came closest and by how much. */
  reason: string;
  bestCandidateAgentStepId: string | null;
  bestCandidateScore: number;
}

export interface AlignmentConflictCandidate {
  agentStepId: string;
  agentStepIndex: number;
  agentText: string;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  positionScore: number;
  toolScore: number;
  assignedAnnotatorStepId: string | null;
  assignedAnnotatorStepIndex: number | null;
}

export interface AlignmentConflictDiagnostic {
  traceId: string;
  mode: AlignmentMode;
  minimumScore: number;
  annotatorStepId: string;
  annotatorStepIndex: number;
  annotatorText: string;
  candidates: AlignmentConflictCandidate[];
}

export interface ContentGateBlockDiagnostic {
  traceId: string;
  mode: AlignmentMode;
  minimumScore: number;
  annotatorStepId: string;
  annotatorStepIndex: number;
  annotatorText: string;
  bestCandidateAgentStepId: string;
  bestCandidateAgentStepIndex: number;
  bestCandidateAgentText: string;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  positionScore: number;
  toolScore: number;
}

export interface SegmentSupportDiagnostic {
  traceId: string;
  mode: AlignmentMode;
  minimumScore: number;
  agentStepId: string;
  agentStepIndex: number;
  agentText: string;
  singleStepBestAnnotatorStepId: string | null;
  singleStepBestScore: number;
  spanStartAnnotatorStepId: string;
  spanEndAnnotatorStepId: string;
  spanStartAnnotatorStepIndex: number;
  spanEndAnnotatorStepIndex: number;
  spanLength: number;
  spanText: string;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  positionScore: number;
  toolScore: number;
  improvementOverSingleStep: number;
}

export interface SegmentSupportAssignment {
  agentStepId: string;
  agentStepIndex: number;
  agentText: string;
  spanStartAnnotatorStepId: string;
  spanEndAnnotatorStepId: string;
  spanStartAnnotatorStepIndex: number;
  spanEndAnnotatorStepIndex: number;
  spanLength: number;
  spanText: string;
  coveredAnnotatorStepIds: string[];
  score: number;
  lexicalScore: number;
  semanticScore: number;
  positionScore: number;
  toolScore: number;
}

export interface PlanSegmentSupportResult {
  traceId: string;
  mode: AlignmentMode;
  minimumScore: number;
  coveredAnnotatorStepIds: string[];
  assignments: SegmentSupportAssignment[];
  coverage: number;
}

export interface PlanAlignmentResult {
  traceId: string;
  mode: AlignmentMode;
  alignments: StepAlignment[];
  uncoveredAnnotatorStepIds: string[];
  uncoveredAgentStepIds: string[];
  /** Uncovered annotator steps that still had threshold-passing candidates but lost the one-to-one assignment. */
  assignmentConflictAnnotatorStepIds: string[];
  /** Uncovered annotator steps whose best raw candidate cleared the threshold only via position/tool, not content. */
  contentGateBlockedAnnotatorStepIds: string[];
  /** One entry per uncovered annotator step explaining the coverage gap. */
  gapDescriptions: GapDescription[];
  coverage: number;
  minimumScore: number;
}

/**
 * Like PlanAlignmentResult but for agent execution steps.
 * `alignments[i].agentStepId` will be an `agent:exec:...` ID.
 */
export interface ExecAlignmentResult {
  traceId: string;
  mode: AlignmentMode;
  alignments: StepAlignment[];
  uncoveredAnnotatorStepIds: string[];
  uncoveredExecStepIds: string[];
  /** One entry per uncovered annotator step explaining the coverage gap. */
  gapDescriptions: GapDescription[];
  coverage: number;
  minimumScore: number;
}

// ---------------------------------------------------------------------------
// Tokenization helpers
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'by',
  'from', 'into', 'via', 'step', 'search', 'find', 'use', 'using', 'then',
]);

const PHRASE_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/\bzip\s*codes?\b/g, ' zipcode '],
  [/\bpostal\s*codes?\b/g, ' zipcode '],
  [/\bpost\s*codes?\b/g, ' zipcode '],
  [/\bnon[\s-]?indigenous\b/g, ' nonnative '],
  [/\bnon[\s-]?native\b/g, ' nonnative '],
  [/\bfinding\s+nemo\b/g, ' clownfish '],
  [/\bweb\s+browser\b/g, ' browser '],
  [/\bsearch\s+engine\b/g, ' searchengine '],
  [/\bcollection\s+info(?:rmation)?\b/g, ' collectioninfo '],
  [/\btravel\s+time\b/g, ' hours '],
  [/\blow[\s-]?end\b/g, ' minimum '],
  [/\breverse\s+order\b/g, ' reverse '],
];

const TOKEN_ALIASES: Record<string, string> = {
  search: 'lookup',
  searched: 'lookup',
  searching: 'lookup',
  searches: 'lookup',
  find: 'lookup',
  finds: 'lookup',
  found: 'lookup',
  finding: 'lookup',
  locate: 'lookup',
  located: 'lookup',
  locating: 'lookup',
  lookup: 'lookup',
  retrieve: 'lookup',
  retrieved: 'lookup',
  retrieving: 'lookup',
  query: 'lookup',
  queried: 'lookup',
  querying: 'lookup',
  browse: 'lookup',
  browsing: 'lookup',
  click: 'open',
  clicked: 'open',
  open: 'open',
  opened: 'open',
  opening: 'open',
  visit: 'open',
  visited: 'open',
  navigate: 'open',
  navigated: 'open',
  note: 'capture',
  noted: 'capture',
  record: 'capture',
  recorded: 'capture',
  capture: 'capture',
  captured: 'capture',
  extract: 'capture',
  extracted: 'capture',
  verify: 'verify',
  verified: 'verify',
  validation: 'verify',
  validate: 'verify',
  check: 'verify',
  checked: 'verify',
  confirm: 'verify',
  confirmed: 'verify',
  calculate: 'compute',
  calculated: 'compute',
  compute: 'compute',
  computed: 'compute',
  derive: 'compute',
  derived: 'compute',
  determine: 'compute',
  determined: 'compute',
  multiply: 'compute',
  multiplied: 'compute',
  project: 'compute',
  projected: 'compute',
  count: 'count',
  counted: 'count',
  counting: 'count',
  tally: 'count',
  tallied: 'count',
  total: 'count',
  report: 'answer',
  reported: 'answer',
  return: 'answer',
  returned: 'answer',
  output: 'answer',
  answered: 'answer',
  answer: 'answer',
  backward: 'reverse',
  prompt: 'instruction',
  internet: 'web',
  online: 'web',
  webpage: 'web',
  website: 'web',
  websites: 'web',
  site: 'web',
  sites: 'web',
  browser: 'web',
  zipcode: 'zipcode',
  postal: 'zipcode',
  postcode: 'zipcode',
  clown: 'clownfish',
  clownfish: 'clownfish',
  anemonefish: 'clownfish',
  anenomefish: 'clownfish',
  clownanemonefish: 'clownfish',
  clownanenomefish: 'clownfish',
  marinefishes: 'marinefish',
  fishes: 'fish',
  nonnative: 'nonnative',
  invasive: 'nonnative',
  nas: 'usgs_nas',
};

interface TokenProfile {
  lexical: Set<string>;
  semantic: Set<string>;
}

function normalizeText(text: string): string {
  let normalized = text.toLowerCase().replace(/-/g, ' ');
  for (const [pattern, replacement] of PHRASE_NORMALIZATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function stemToken(token: string): string {
  if (token.length <= 3) return token;
  if (token === 'species') return token;

  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('ing') && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith('ed') && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith('es') && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && token.length > 4 && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeSemanticToken(token: string): string {
  const aliased = TOKEN_ALIASES[token] ?? token;
  const stemmed = stemToken(aliased);
  return TOKEN_ALIASES[stemmed] ?? stemmed;
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .replace(/[^a-z0-9_\s]+/g, ' ')
      .split(/\s+/)
      .filter(
        (token) =>
          token.length > 0 &&
          (token.length > 2 || IMPORTANT_SHORT_TOKENS.has(token)) &&
          !STOPWORDS.has(token),
      ),
  );
}

function tokenizeSemantically(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .replace(/[^a-z0-9_\s]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(normalizeSemanticToken)
      .filter(
        (token) =>
          (token.length > 2 || IMPORTANT_SHORT_TOKENS.has(token)) &&
          !STOPWORDS.has(token),
      ),
  );
}

function buildTokenProfile(text: string): TokenProfile {
  return {
    lexical: tokenize(text),
    semantic: tokenizeSemantically(text),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) {
      previous[j] = current[j]!;
    }
  }

  return previous[b.length]!;
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;

  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a))) {
    return 0.92;
  }

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const similarity = 1 - distance / maxLen;
  return similarity >= 0.82 ? similarity : 0;
}

function softJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  const smaller = a.size <= b.size ? [...a] : [...b];
  const larger = a.size <= b.size ? [...b] : [...a];
  const used = new Set<number>();
  let intersection = 0;

  for (const token of smaller) {
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < larger.length; i++) {
      if (used.has(i)) continue;
      const score = tokenSimilarity(token, larger[i]!);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestScore > 0) {
      used.add(bestIndex);
      intersection += bestScore;
    }
  }

  const union = a.size + b.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Composite scoring sub-components
// ---------------------------------------------------------------------------

/**
 * Positional proximity between two steps using their normalized positions
 * within their respective sequences. Returns 1 when positions match exactly,
 * 0 when they are at opposite ends of the sequence.
 */
function computePositionScore(
  agentLocalPos: number,
  agentTotal: number,
  annotatorLocalPos: number,
  annotatorTotal: number,
): number {
  const agentNorm = agentTotal <= 1 ? 0.5 : (agentLocalPos - 1) / (agentTotal - 1);
  const annotatorNorm = annotatorTotal <= 1 ? 0.5 : (annotatorLocalPos - 1) / (annotatorTotal - 1);
  return 1 - Math.abs(agentNorm - annotatorNorm);
}

/**
 * Jaccard similarity on tool name arrays. Returns 0 when either side has no
 * tools (no information, not a penalty).
 */
function toolJaccard(agentTools: string[], annotatorTools: string[]): number {
  if (agentTools.length === 0 || annotatorTools.length === 0) return 0;
  const setA = new Set(agentTools);
  const setB = new Set(annotatorTools);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function hasContentSignal(lexicalScore: number, semanticScore: number, toolScore: number): boolean {
  return lexicalScore > 0 || semanticScore > 0 || toolScore > 0;
}

function resolveAlignmentOptions(
  minimumScoreOrOptions: number | AlignmentOptions | undefined,
): Required<AlignmentOptions> {
  if (typeof minimumScoreOrOptions === 'number') {
    return {
      minimumScore: minimumScoreOrOptions,
      mode: DEFAULT_ALIGNMENT_MODE,
    };
  }

  return {
    minimumScore: minimumScoreOrOptions?.minimumScore ?? DEFAULT_ALIGNMENT_MINIMUM_SCORE,
    mode: minimumScoreOrOptions?.mode ?? DEFAULT_ALIGNMENT_MODE,
  };
}

function getWeightsForMode(mode: AlignmentMode): AlignmentWeights {
  return mode === 'lexical' ? LEGACY_ALIGNMENT_WEIGHTS : ALIGNMENT_WEIGHTS;
}

function computeCompositeScore(
  lexicalScore: number,
  semanticScore: number,
  positionScore: number,
  toolScore: number,
  mode: AlignmentMode,
): number {
  const weights = getWeightsForMode(mode);
  const composite = (
    weights.lexical * lexicalScore +
    weights.semantic * semanticScore +
    weights.position * positionScore +
    weights.tool * toolScore
  );

  if (mode === 'lexical') {
    return composite;
  }

  const lexicalFloor = (
    LEGACY_ALIGNMENT_WEIGHTS.lexical * lexicalScore +
    LEGACY_ALIGNMENT_WEIGHTS.position * positionScore +
    LEGACY_ALIGNMENT_WEIGHTS.tool * toolScore
  );

  return Math.max(composite, lexicalFloor);
}

// ---------------------------------------------------------------------------
// Step filter
// ---------------------------------------------------------------------------

function isRealAgentPlanStep(step: PlanStep): boolean {
  return step.group === 'agent:plan' && !step.id.startsWith('agent:plan:facts:');
}

// ---------------------------------------------------------------------------
// Main alignment function
// ---------------------------------------------------------------------------

type AlignmentCandidate = StepAlignment & {
  agentIndex: number;
  annotatorIndex: number;
};

function compareCandidates(a: AlignmentCandidate, b: AlignmentCandidate): number {
  return (
    b.score - a.score ||
    b.positionScore - a.positionScore ||
    b.semanticScore - a.semanticScore ||
    b.lexicalScore - a.lexicalScore ||
    a.annotatorIndex - b.annotatorIndex ||
    a.agentIndex - b.agentIndex
  );
}

function computeUniqueAlignments(
  agentSteps: PlanStep[],
  annotatorSteps: PlanStep[],
  minimumScore: number,
  mode: AlignmentMode,
): {
  alignments: StepAlignment[];
  coveredAnnotator: Set<string>;
  annotatorBestCandidate: Map<string, { agentStepId: string; score: number }>;
  candidatesByAnnotator: AlignmentCandidate[][];
  candidatesByAgent: AlignmentCandidate[][];
  assignedByAgent: Map<number, AlignmentCandidate>;
} {
  const agentTotal = agentSteps.length;
  const annotatorTotal = annotatorSteps.length;
  const annotatorProfiles = annotatorSteps.map((step) => buildTokenProfile(step.description));
  const annotatorBestCandidate = new Map<string, { agentStepId: string; score: number }>();
  const candidatesByAnnotator = annotatorSteps.map(() => [] as AlignmentCandidate[]);
  const candidatesByAgent: AlignmentCandidate[][] = [];

  for (let ai = 0; ai < agentSteps.length; ai++) {
    const agentStep = agentSteps[ai]!;
    const agentLocalPos = ai + 1;
    const agentProfile = buildTokenProfile(agentStep.description);
    const row: AlignmentCandidate[] = [];

    for (let bi = 0; bi < annotatorSteps.length; bi++) {
      const annotatorStep = annotatorSteps[bi]!;
      const annotatorLocalPos = bi + 1;
      const annotatorProfile = annotatorProfiles[bi]!;

      const lexicalScore = jaccard(agentProfile.lexical, annotatorProfile.lexical);
      const semanticScore = softJaccard(agentProfile.semantic, annotatorProfile.semantic);
      const positionScore = computePositionScore(agentLocalPos, agentTotal, annotatorLocalPos, annotatorTotal);
      const toolScore = toolJaccard(agentStep.toolsUsed, annotatorStep.toolsUsed);
      const composite = computeCompositeScore(lexicalScore, semanticScore, positionScore, toolScore, mode);

      const candidate: AlignmentCandidate = {
        agentStepId: agentStep.id,
        annotatorStepId: annotatorStep.id,
        score: composite,
        lexicalScore,
        semanticScore,
        positionScore,
        toolScore,
        matched: composite + MATCH_EPSILON >= minimumScore && hasContentSignal(lexicalScore, semanticScore, toolScore),
        agentIndex: ai,
        annotatorIndex: bi,
      };

      row.push(candidate);

      const prev = annotatorBestCandidate.get(annotatorStep.id);
      if (!prev || composite > prev.score) {
        annotatorBestCandidate.set(annotatorStep.id, {
          agentStepId: agentStep.id,
          score: composite,
        });
      }

      if (candidate.matched) {
        candidatesByAnnotator[bi]!.push(candidate);
      }
    }

    row.sort(compareCandidates);
    candidatesByAgent.push(row);
  }

  for (const candidates of candidatesByAnnotator) {
    candidates.sort(compareCandidates);
  }

  const annotatorOrder = annotatorSteps
    .map((_, bi) => bi)
    .sort((a, b) => {
      const countDelta = candidatesByAnnotator[a]!.length - candidatesByAnnotator[b]!.length;
      if (countDelta !== 0) return countDelta;

      const bestA = candidatesByAnnotator[a]![0]?.score ?? -1;
      const bestB = candidatesByAnnotator[b]![0]?.score ?? -1;
      return bestB - bestA || a - b;
    });

  const assignedAgentIndexes = new Set<number>();
  const coveredAnnotator = new Set<string>();
  const assignedByAgent = new Map<number, AlignmentCandidate>();

  for (const annotatorIndex of annotatorOrder) {
    const candidate = candidatesByAnnotator[annotatorIndex]!
      .find((item) => !assignedAgentIndexes.has(item.agentIndex));

    if (!candidate) continue;

    assignedAgentIndexes.add(candidate.agentIndex);
    assignedByAgent.set(candidate.agentIndex, candidate);
    if (candidate.annotatorStepId) {
      coveredAnnotator.add(candidate.annotatorStepId);
    }
  }

  const alignments: StepAlignment[] = agentSteps.map((agentStep, ai) => {
    const assigned = assignedByAgent.get(ai);
    if (assigned) {
      return {
        agentStepId: assigned.agentStepId,
        annotatorStepId: assigned.annotatorStepId,
        score: assigned.score,
        lexicalScore: assigned.lexicalScore,
        semanticScore: assigned.semanticScore,
        positionScore: assigned.positionScore,
        toolScore: assigned.toolScore,
        matched: true,
      };
    }

    const best = candidatesByAgent[ai]?.[0];
    if (best) {
      return {
        agentStepId: best.agentStepId,
        annotatorStepId: best.annotatorStepId,
        score: best.score,
        lexicalScore: best.lexicalScore,
        semanticScore: best.semanticScore,
        positionScore: best.positionScore,
        toolScore: best.toolScore,
        matched: false,
      };
    }

    return {
      agentStepId: agentStep.id,
      annotatorStepId: null,
      score: 0,
      lexicalScore: 0,
      semanticScore: 0,
      positionScore: 0,
      toolScore: 0,
      matched: false,
    };
  });

  return {
    alignments,
    coveredAnnotator,
    annotatorBestCandidate,
    candidatesByAnnotator,
    candidatesByAgent,
    assignedByAgent,
  };
}

export function alignAgentPlanToAnnotator(
  record: PlanRecord,
  minimumScoreOrOptions?: number | AlignmentOptions,
): PlanAlignmentResult {
  const { minimumScore, mode } = resolveAlignmentOptions(minimumScoreOrOptions);
  const annotatorSteps = record.steps.filter((step) => step.group === 'annotator');
  const agentSteps = record.steps.filter(isRealAgentPlanStep);
  const annotatorTotal = annotatorSteps.length;

  const {
    alignments,
    coveredAnnotator,
    annotatorBestCandidate,
    candidatesByAnnotator,
    candidatesByAgent,
  } = computeUniqueAlignments(agentSteps, annotatorSteps, minimumScore, mode);

  const uncoveredAnnotatorStepIds = annotatorSteps
    .map((step) => step.id)
    .filter((id) => !coveredAnnotator.has(id));

  const uncoveredAgentStepIds = alignments
    .filter((alignment) => !alignment.matched || alignment.annotatorStepId === null)
    .map((alignment) => alignment.agentStepId);

  const assignmentConflictAnnotatorStepIds = uncoveredAnnotatorStepIds.filter((annotatorStepId) => {
    const annotatorIndex = annotatorSteps.findIndex((step) => step.id === annotatorStepId);
    return annotatorIndex >= 0 && (candidatesByAnnotator[annotatorIndex]?.length ?? 0) > 0;
  });

  const contentGateBlockedAnnotatorStepIds = uncoveredAnnotatorStepIds.filter((annotatorStepId) => {
    const annotatorIndex = annotatorSteps.findIndex((step) => step.id === annotatorStepId);
    if (annotatorIndex < 0 || (candidatesByAnnotator[annotatorIndex]?.length ?? 0) > 0) {
      return false;
    }

    const bestRawCandidate = candidatesByAgent
      .map((row) => row.find((candidate) => candidate.annotatorIndex === annotatorIndex) ?? null)
      .filter((candidate): candidate is AlignmentCandidate => candidate !== null)
      .sort(compareCandidates)[0];

    return !!bestRawCandidate && bestRawCandidate.score + MATCH_EPSILON >= minimumScore;
  });

  const gapDescriptions: GapDescription[] = uncoveredAnnotatorStepIds.map((annotatorStepId) => {
    const annotatorStep = annotatorSteps.find((s) => s.id === annotatorStepId)!;
    const candidate = annotatorBestCandidate.get(annotatorStepId);
    return {
      annotatorStepId,
      annotatorStepIndex: annotatorStep.index,
      reason: candidate
        ? `best candidate: ${candidate.agentStepId} scored ${candidate.score.toFixed(2)} (threshold ${minimumScore})`
        : 'no agent plan steps to compare',
      bestCandidateAgentStepId: candidate?.agentStepId ?? null,
      bestCandidateScore: candidate?.score ?? 0,
    };
  });

  return {
    traceId: record.traceId,
    mode,
    alignments,
    uncoveredAnnotatorStepIds,
    uncoveredAgentStepIds,
    assignmentConflictAnnotatorStepIds,
    contentGateBlockedAnnotatorStepIds,
    gapDescriptions,
    coverage: annotatorTotal === 0 ? 0 : coveredAnnotator.size / annotatorTotal,
    minimumScore,
  };
}

export function diagnosePlanAlignmentConflicts(
  record: PlanRecord,
  minimumScoreOrOptions?: number | AlignmentOptions,
): AlignmentConflictDiagnostic[] {
  const { minimumScore, mode } = resolveAlignmentOptions(minimumScoreOrOptions);
  const annotatorSteps = record.steps.filter((step) => step.group === 'annotator');
  const agentSteps = record.steps.filter(isRealAgentPlanStep);

  const {
    coveredAnnotator,
    candidatesByAnnotator,
    assignedByAgent,
  } = computeUniqueAlignments(agentSteps, annotatorSteps, minimumScore, mode);

  return annotatorSteps.flatMap((annotatorStep, annotatorIndex) => {
    if (coveredAnnotator.has(annotatorStep.id)) {
      return [];
    }

    const candidates = candidatesByAnnotator[annotatorIndex] ?? [];
    if (candidates.length === 0) {
      return [];
    }

    const detailedCandidates: AlignmentConflictCandidate[] = candidates.map((candidate) => {
      const assigned = assignedByAgent.get(candidate.agentIndex);
      const agentStep = agentSteps[candidate.agentIndex]!;
      const assignedAnnotatorStep = assigned?.annotatorStepId
        ? annotatorSteps.find((step) => step.id === assigned.annotatorStepId) ?? null
        : null;

      return {
        agentStepId: candidate.agentStepId,
        agentStepIndex: agentStep.index,
        agentText: agentStep.description,
        score: candidate.score,
        lexicalScore: candidate.lexicalScore,
        semanticScore: candidate.semanticScore,
        positionScore: candidate.positionScore,
        toolScore: candidate.toolScore,
        assignedAnnotatorStepId: assigned?.annotatorStepId ?? null,
        assignedAnnotatorStepIndex: assignedAnnotatorStep?.index ?? null,
      };
    });

    return [{
      traceId: record.traceId,
      mode,
      minimumScore,
      annotatorStepId: annotatorStep.id,
      annotatorStepIndex: annotatorStep.index,
      annotatorText: annotatorStep.description,
      candidates: detailedCandidates,
    } satisfies AlignmentConflictDiagnostic];
  });
}

export function diagnosePlanContentGateBlocks(
  record: PlanRecord,
  minimumScoreOrOptions?: number | AlignmentOptions,
): ContentGateBlockDiagnostic[] {
  const { minimumScore, mode } = resolveAlignmentOptions(minimumScoreOrOptions);
  const annotatorSteps = record.steps.filter((step) => step.group === 'annotator');
  const agentSteps = record.steps.filter(isRealAgentPlanStep);

  const {
    coveredAnnotator,
    candidatesByAnnotator,
    candidatesByAgent,
  } = computeUniqueAlignments(agentSteps, annotatorSteps, minimumScore, mode);

  return annotatorSteps.flatMap((annotatorStep, annotatorIndex) => {
    if (coveredAnnotator.has(annotatorStep.id)) {
      return [];
    }

    const thresholdPassingCandidates = candidatesByAnnotator[annotatorIndex] ?? [];
    if (thresholdPassingCandidates.length > 0) {
      return [];
    }

    const bestRawCandidate = candidatesByAgent
      .map((row) => row.find((candidate) => candidate.annotatorIndex === annotatorIndex) ?? null)
      .filter((candidate): candidate is AlignmentCandidate => candidate !== null)
      .sort(compareCandidates)[0];

    if (!bestRawCandidate || bestRawCandidate.score + MATCH_EPSILON < minimumScore) {
      return [];
    }

    const agentStep = agentSteps[bestRawCandidate.agentIndex]!;
    return [{
      traceId: record.traceId,
      mode,
      minimumScore,
      annotatorStepId: annotatorStep.id,
      annotatorStepIndex: annotatorStep.index,
      annotatorText: annotatorStep.description,
      bestCandidateAgentStepId: bestRawCandidate.agentStepId,
      bestCandidateAgentStepIndex: agentStep.index,
      bestCandidateAgentText: agentStep.description,
      score: bestRawCandidate.score,
      lexicalScore: bestRawCandidate.lexicalScore,
      semanticScore: bestRawCandidate.semanticScore,
      positionScore: bestRawCandidate.positionScore,
      toolScore: bestRawCandidate.toolScore,
    } satisfies ContentGateBlockDiagnostic];
  });
}

export function diagnosePlanSegmentSupport(
  record: PlanRecord,
  options: AlignmentOptions & { maxSpanLength?: number } = {},
): SegmentSupportDiagnostic[] {
  const { minimumScore, mode } = resolveAlignmentOptions(options);
  const maxSpanLength = options.maxSpanLength ?? 4;
  const annotatorSteps = record.steps.filter((step) => step.group === 'annotator');
  const agentSteps = record.steps.filter(isRealAgentPlanStep);
  const agentTotal = agentSteps.length;
  const annotatorTotal = annotatorSteps.length;

  const { candidatesByAgent } = computeUniqueAlignments(agentSteps, annotatorSteps, minimumScore, mode);

  return agentSteps.flatMap((agentStep, ai) => {
    const agentProfile = buildTokenProfile(agentStep.description);
    const agentLocalPos = ai + 1;
    const singleStepBest = candidatesByAgent[ai]?.[0] ?? null;

    let bestSpan: SegmentSupportDiagnostic | null = null;

    for (let start = 0; start < annotatorSteps.length; start++) {
      for (let length = 2; length <= maxSpanLength && start + length <= annotatorSteps.length; length++) {
        const spanSteps = annotatorSteps.slice(start, start + length);
        const spanText = spanSteps.map((step) => step.description).join(' ');
        const spanTools = [...new Set(spanSteps.flatMap((step) => step.toolsUsed))];
        const spanProfile = buildTokenProfile(spanText);
        const spanMidpoint = start + 1 + (length - 1) / 2;

        const lexicalScore = jaccard(agentProfile.lexical, spanProfile.lexical);
        const semanticScore = softJaccard(agentProfile.semantic, spanProfile.semantic);
        const positionScore = computePositionScore(agentLocalPos, agentTotal, spanMidpoint, annotatorTotal);
        const toolScore = toolJaccard(agentStep.toolsUsed, spanTools);
        const score = computeCompositeScore(lexicalScore, semanticScore, positionScore, toolScore, mode);

        if (!bestSpan || score > bestSpan.score) {
          bestSpan = {
            traceId: record.traceId,
            mode,
            minimumScore,
            agentStepId: agentStep.id,
            agentStepIndex: agentStep.index,
            agentText: agentStep.description,
            singleStepBestAnnotatorStepId: singleStepBest?.annotatorStepId ?? null,
            singleStepBestScore: singleStepBest?.score ?? 0,
            spanStartAnnotatorStepId: spanSteps[0]!.id,
            spanEndAnnotatorStepId: spanSteps[length - 1]!.id,
            spanStartAnnotatorStepIndex: spanSteps[0]!.index,
            spanEndAnnotatorStepIndex: spanSteps[length - 1]!.index,
            spanLength: length,
            spanText,
            score,
            lexicalScore,
            semanticScore,
            positionScore,
            toolScore,
            improvementOverSingleStep: score - (singleStepBest?.score ?? 0),
          };
        }
      }
    }

    return bestSpan ? [bestSpan] : [];
  });
}

export function computePlanSegmentSupport(
  record: PlanRecord,
  options: AlignmentOptions & { maxSpanLength?: number } = {},
): PlanSegmentSupportResult {
  const { minimumScore, mode } = resolveAlignmentOptions(options);
  const maxSpanLength = options.maxSpanLength ?? 4;
  const annotatorSteps = record.steps.filter((step) => step.group === 'annotator');
  const agentSteps = record.steps.filter(isRealAgentPlanStep);
  const agentTotal = agentSteps.length;
  const annotatorTotal = annotatorSteps.length;
  const coveredAnnotator = new Set<string>();
  const assignments: SegmentSupportAssignment[] = [];

  for (let ai = 0; ai < agentSteps.length; ai++) {
    const agentStep = agentSteps[ai]!;
    const agentProfile = buildTokenProfile(agentStep.description);
    const agentLocalPos = ai + 1;
    let bestAssignment: SegmentSupportAssignment | null = null;

    for (let start = 0; start < annotatorSteps.length; start++) {
      for (let length = 1; length <= maxSpanLength && start + length <= annotatorSteps.length; length++) {
        const spanSteps = annotatorSteps.slice(start, start + length);
        const spanText = spanSteps.map((step) => step.description).join(' ');
        const spanTools = [...new Set(spanSteps.flatMap((step) => step.toolsUsed))];
        const spanProfile = buildTokenProfile(spanText);
        const spanMidpoint = start + 1 + (length - 1) / 2;

        const lexicalScore = jaccard(agentProfile.lexical, spanProfile.lexical);
        const semanticScore = softJaccard(agentProfile.semantic, spanProfile.semantic);
        const positionScore = computePositionScore(agentLocalPos, agentTotal, spanMidpoint, annotatorTotal);
        const toolScore = toolJaccard(agentStep.toolsUsed, spanTools);
        const score = computeCompositeScore(lexicalScore, semanticScore, positionScore, toolScore, mode);

        if (score + MATCH_EPSILON < minimumScore || !hasContentSignal(lexicalScore, semanticScore, toolScore)) {
          continue;
        }

        const candidate: SegmentSupportAssignment = {
          agentStepId: agentStep.id,
          agentStepIndex: agentStep.index,
          agentText: agentStep.description,
          spanStartAnnotatorStepId: spanSteps[0]!.id,
          spanEndAnnotatorStepId: spanSteps[length - 1]!.id,
          spanStartAnnotatorStepIndex: spanSteps[0]!.index,
          spanEndAnnotatorStepIndex: spanSteps[length - 1]!.index,
          spanLength: length,
          spanText,
          coveredAnnotatorStepIds: spanSteps.map((step) => step.id),
          score,
          lexicalScore,
          semanticScore,
          positionScore,
          toolScore,
        };

        if (!bestAssignment || score > bestAssignment.score) {
          bestAssignment = candidate;
        }
      }
    }

    if (bestAssignment) {
      assignments.push(bestAssignment);
      for (const annotatorStepId of bestAssignment.coveredAnnotatorStepIds) {
        coveredAnnotator.add(annotatorStepId);
      }
    }
  }

  return {
    traceId: record.traceId,
    mode,
    minimumScore,
    coveredAnnotatorStepIds: [...coveredAnnotator],
    assignments,
    coverage: annotatorSteps.length === 0 ? 0 : coveredAnnotator.size / annotatorSteps.length,
  };
}

/**
 * Align agent execution steps (group='agent:exec') to annotator steps using the
 * same composite scoring used for plan alignment.
 *
 * Execution steps are now enriched with the agent's Thought text (extracted by
 * the canonicalizer), making lexical similarity meaningful even when the plan
 * text was sparse.
 */
export function alignAgentExecToAnnotator(
  record: PlanRecord,
  minimumScoreOrOptions?: number | AlignmentOptions,
): ExecAlignmentResult {
  const { minimumScore, mode } = resolveAlignmentOptions(minimumScoreOrOptions);
  const annotatorSteps = record.steps.filter((step) => step.group === 'annotator');
  const execSteps = record.steps.filter((step) => step.group === 'agent:exec');
  const annotatorTotal = annotatorSteps.length;

  const {
    alignments,
    coveredAnnotator,
    annotatorBestCandidate,
  } = computeUniqueAlignments(execSteps, annotatorSteps, minimumScore, mode);

  const uncoveredAnnotatorStepIds = annotatorSteps
    .map((step) => step.id)
    .filter((id) => !coveredAnnotator.has(id));

  const uncoveredExecStepIds = alignments
    .filter((a) => !a.matched || a.annotatorStepId === null)
    .map((a) => a.agentStepId);

  const gapDescriptions: GapDescription[] = uncoveredAnnotatorStepIds.map((annotatorStepId) => {
    const annotatorStep = annotatorSteps.find((s) => s.id === annotatorStepId)!;
    const candidate = annotatorBestCandidate.get(annotatorStepId);
    return {
      annotatorStepId,
      annotatorStepIndex: annotatorStep.index,
      reason: candidate
        ? `best exec candidate: ${candidate.agentStepId} scored ${candidate.score.toFixed(2)} (threshold ${minimumScore})`
        : 'no agent execution steps to compare',
      bestCandidateAgentStepId: candidate?.agentStepId ?? null,
      bestCandidateScore: candidate?.score ?? 0,
    };
  });

  return {
    traceId: record.traceId,
    mode,
    alignments,
    uncoveredAnnotatorStepIds,
    uncoveredExecStepIds,
    gapDescriptions,
    coverage: annotatorTotal === 0 ? 0 : coveredAnnotator.size / annotatorTotal,
    minimumScore,
  };
}

export function deriveAlignmentRiskFlags(
  record: PlanRecord,
  alignment: PlanAlignmentResult,
  minimumScore = alignment.minimumScore,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  for (const gap of alignment.gapDescriptions) {
    flags.push({
      id: `alignment:risk:missing_step:${gap.annotatorStepId}`,
      stepId: gap.annotatorStepId,
      type: 'missing_step',
      description:
        `Annotator step ${gap.annotatorStepIndex} is not covered by the agent plan. ` +
        gap.reason,
      severity:
        gap.bestCandidateScore >= minimumScore * 0.75 ? 'medium' : 'high',
      provenance: {
        origin: 'inferred',
        sourceEvidence: `alignment gap for ${gap.annotatorStepId} in trace ${record.traceId}`,
        confidence: 0.8,
      },
    });
  }

  for (const agentStepId of alignment.uncoveredAgentStepIds) {
    flags.push({
      id: `alignment:risk:unmatched_agent_step:${agentStepId}`,
      stepId: agentStepId,
      type: 'gap',
      description: `Agent plan step ${agentStepId} did not match any annotator reference step above threshold ${minimumScore}.`,
      severity: 'medium',
      provenance: {
        origin: 'inferred',
        sourceEvidence: `alignment unmatched agent step ${agentStepId} in trace ${record.traceId}`,
        confidence: 0.75,
      },
    });
  }

  return flags;
}
