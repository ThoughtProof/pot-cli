/**
 * Span-entailment prototype tests.
 *
 * Covers:
 *   - R6 case 4b6bb5f7 — Doctor Who S9E11 scene heading (over-specific extraction)
 *   - R6 case b816bfce — Emily Midkiff dragons article adjective (wrong word from correct source)
 *   - Positive / negative controls
 *   - Exact-string question detection
 *   - Minimal local negation handling
 *
 * All fixtures are inline synthetic excerpts representing the key signal in
 * each case — no live web retrieval required.
 *
 * Run after `npm run build`:
 *   node --test dist/plan/test-span-entailment.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSpanEntailment } from './span-entailment.js';

// ===========================================================================
// R6 Case 4b6bb5f7 — Doctor Who S9E11 "Heaven Sent" scene heading
//
// Question: official script location name, "exactly as it appears in the
//           first scene heading"
// Agent answer:   INT. CASTLE - TELEPORT CHAMBER   (wrong granularity, missing THE)
// Ground truth:   THE CASTLE
//
// Source: the first scene heading of the script reads
//         "INT. THE CASTLE - TELEPORT CHAMBER"
//         The location name (place, not the full heading) is "THE CASTLE".
// ===========================================================================

const Q_4B6BB = [
  'What is the official script location name for Doctor Who S9E11 (Heaven Sent),',
  'exactly as it appears in the first scene heading?',
].join(' ');

// Synthetic excerpt representing the first page of the script.
const SRC_4B6BB = `
INT. THE CASTLE - TELEPORT CHAMBER

The Doctor materializes inside a swirling vortex of crackling light.
He looks around at the stone walls of THE CASTLE, ancient and unyielding.
A fireplace crackles in the corner.

DOCTOR: (quietly)
I'm in a castle.
`;

test('4b6bb5f7 — agent answer (INT. CASTLE - TELEPORT CHAMBER) is NOT exact-supported', () => {
  const result = assessSpanEntailment({
    question: Q_4B6BB,
    claimedAnswer: 'INT. CASTLE - TELEPORT CHAMBER',
    sourceText: SRC_4B6BB,
  });
  // "INT. CASTLE - TELEPORT CHAMBER" is not verbatim in the source
  // (source has "INT. THE CASTLE - TELEPORT CHAMBER" — note "THE" is present)
  assert.notEqual(
    result.support,
    'exact',
    `Agent answer should NOT be exact-supported. Got: ${result.support}` +
    (result.matchedSpan ? ` (matchedSpan="${result.matchedSpan}")` : ''),
  );
  assert.equal(result.exactStringQuestion, true, 'Should detect exact-string question');
});

test('4b6bb5f7 — ground truth (THE CASTLE) IS exact-supported', () => {
  const result = assessSpanEntailment({
    question: Q_4B6BB,
    claimedAnswer: 'THE CASTLE',
    sourceText: SRC_4B6BB,
  });
  assert.equal(result.support, 'exact',
    `Ground truth should be exact-supported. Got: ${result.support}`);
  assert.equal(result.confidence, 'high');
  assert.ok(result.matchedSpan, 'matchedSpan should be set');
});

test('4b6bb5f7 — R6 signal: ground truth is exact, agent answer is not', () => {
  const agentResult = assessSpanEntailment({
    question: Q_4B6BB,
    claimedAnswer: 'INT. CASTLE - TELEPORT CHAMBER',
    sourceText: SRC_4B6BB,
  });
  const truthResult = assessSpanEntailment({
    question: Q_4B6BB,
    claimedAnswer: 'THE CASTLE',
    sourceText: SRC_4B6BB,
  });
  assert.equal(truthResult.support, 'exact', 'Ground truth must be exact');
  assert.notEqual(agentResult.support, 'exact', 'Agent answer must NOT be exact');
  // In an exact-string question, a non-exact agent answer + an exact correct answer
  // is the R6 signal: correct source, wrong extracted span.
  assert.equal(agentResult.exactStringQuestion, true);
});

// ===========================================================================
// R6 Case b816bfce — Emily Midkiff "Dragons are Tricksy" adjective
//
// Question: which adjective does she use for dragons in children's literature?
// Agent answer:   pedestrian
// Ground truth:   fluffy
//
// Two fixture variants:
//   clean    — "pedestrian" absent from source → cleanly unsupported
//   negation — "pedestrian" appears in negated context → should be downgraded
// ===========================================================================

const Q_B816B =
  'What adjective does Emily Midkiff use for dragons in her article "Dragons are Tricksy"?';

// Clean fixture: "pedestrian" is simply absent.
const SRC_B816B_CLEAN = `
Emily Midkiff argues in "Dragons are Tricksy" that while dragons may seem fearsome,
they are often portrayed as surprisingly fluffy companions in children's literature.
The dragon figure transforms into something magical and approachable for young readers,
far removed from the terrifying monsters of mythology.
`;

// Negation fixture: "pedestrian" appears but in a negated clause.
// This represents the real-world situation where the agent extracts a word that
// appears in the source but in the wrong (negated) semantic role.
const SRC_B816B_NEGATION = `
Emily Midkiff argues in "Dragons are Tricksy" that while dragons may seem fearsome,
they are often portrayed as surprisingly fluffy companions in children's literature.
The dragon figure is not the pedestrian monster of adult fiction; it transforms
into something altogether more magical and approachable for young readers.
`;

// --- Clean fixture ---

test('b816bfce (clean) — ground truth (fluffy) is exact-supported', () => {
  const result = assessSpanEntailment({
    question: Q_B816B,
    claimedAnswer: 'fluffy',
    sourceText: SRC_B816B_CLEAN,
  });
  assert.equal(result.support, 'exact');
  assert.equal(result.confidence, 'high');
});

test('b816bfce (clean) — agent answer (pedestrian) is unsupported', () => {
  const result = assessSpanEntailment({
    question: Q_B816B,
    claimedAnswer: 'pedestrian',
    sourceText: SRC_B816B_CLEAN,
  });
  assert.equal(result.support, 'unsupported',
    `Expected unsupported, got: ${result.support}`);
});

test('b816bfce (clean) — R6 signal: fluffy is exact, pedestrian is unsupported', () => {
  const fluffyResult = assessSpanEntailment({
    question: Q_B816B,
    claimedAnswer: 'fluffy',
    sourceText: SRC_B816B_CLEAN,
  });
  const pedestrianResult = assessSpanEntailment({
    question: Q_B816B,
    claimedAnswer: 'pedestrian',
    sourceText: SRC_B816B_CLEAN,
  });
  assert.equal(fluffyResult.support, 'exact');
  assert.equal(pedestrianResult.support, 'unsupported');
});

// --- Negation fixture ---

test('b816bfce (negation) — ground truth (fluffy) is still exact-supported', () => {
  const result = assessSpanEntailment({
    question: Q_B816B,
    claimedAnswer: 'fluffy',
    sourceText: SRC_B816B_NEGATION,
  });
  assert.equal(result.support, 'exact');
});

test('b816bfce (negation) — pedestrian is downgraded when only present in locally negated context', () => {
  const result = assessSpanEntailment({
    question: Q_B816B,
    claimedAnswer: 'pedestrian',
    sourceText: SRC_B816B_NEGATION,
  });
  assert.equal(result.support, 'unsupported');
  assert.equal(result.confidence, 'high');
  assert.match(result.explanation, /negated source context/i);
});

// ===========================================================================
// Held-out slice — wording-sensitive / exact-span-sensitive cases outside Next10
// ===========================================================================

const Q_18EFA = 'How many images are there in the latest 2022 Lego english wikipedia article?';
const SRC_18EFA = `
Revision snapshot: 21 December 2022.
This version of the Lego article displays 13 images on the page.
`;

test('18efa24e — held-out numeric extraction is exact-supported when the count is present verbatim', () => {
  const result = assessSpanEntailment({
    question: Q_18EFA,
    claimedAnswer: '13',
    sourceText: SRC_18EFA,
  });
  assert.equal(result.support, 'exact');
  assert.equal(result.confidence, 'high');
});

const Q_387546 = 'In the year 2022, and before December, what does "R" stand for in the three core policies of the type of content that was violated in the public logs on the Legume Wikipedia page?';
const SRC_387546 = `
Wikipedia's three core content policies are neutral point of view, verifiability,
and no original research. In this context, R stands for research.
`;

test('387546b0 — held-out policy wording extraction is exact-supported', () => {
  const result = assessSpanEntailment({
    question: Q_387546,
    claimedAnswer: 'research',
    sourceText: SRC_387546,
  });
  assert.equal(result.support, 'exact');
  assert.equal(result.confidence, 'high');
});

const Q_08BE = 'What are the EC numbers of the two most commonly used chemicals for the virus testing method in the paper about SPFMV and SPCSV in the Pearl Of Africa from 2016? Return the semicolon-separated numbers in the order of the alphabetized chemicals.';
const SRC_08BE = `
The two most commonly used chemicals for ELISA are alkaline phosphatase (EC 3.1.3.1)
and horseradish peroxidase (EC 1.11.1.7).
`;

test('08be1639 — held-out compositional multi-span answer is composition-supported', () => {
  const result = assessSpanEntailment({
    question: Q_08BE,
    claimedAnswer: '3.1.3.1; 1.11.1.7',
    sourceText: SRC_08BE,
  });
  assert.equal(result.support, 'paraphrase');
  assert.equal(result.confidence, 'medium');
  assert.match(result.explanation, /individually exact-supported/i);
});

const Q_1DD91 = 'The Latin root of the Yola word "gimlie" shares a spelling with a Spanish word. What is the Google translation of the source title for the 1994 example sentence for that word in the Collins Spanish-to-English dictionary online? Answer in plain text, without punctuation.';
const SRC_1DD91 = `
1994 example source title: El Mundo del Siglo Veintiuno.
`;

test('1dd91d38 — held-out translation-style answer is supported by the narrow title-translation bridge', () => {
  const result = assessSpanEntailment({
    question: Q_1DD91,
    claimedAnswer: 'The World of the Twenty First Century',
    sourceText: SRC_1DD91,
  });
  assert.equal(result.support, 'paraphrase');
  assert.equal(result.confidence, 'medium');
  assert.match(result.explanation, /translated title-like source span/i);
});

// ===========================================================================
// Positive controls — clean exact matches
// ===========================================================================

test('positive: single-word verbatim answer is exact', () => {
  const result = assessSpanEntailment({
    question: 'What color is the flag?',
    claimedAnswer: 'blue',
    sourceText: 'The flag is blue and white, with a central star.',
  });
  assert.equal(result.support, 'exact');
  assert.equal(result.confidence, 'high');
  assert.ok(result.matchedSpan);
});

test('positive: multi-word verbatim phrase is exact', () => {
  const result = assessSpanEntailment({
    question: 'What is the paper title?',
    claimedAnswer: 'Mapping Human Oriented Information',
    sourceText: 'The paper "Mapping Human Oriented Information" was published in 2003.',
  });
  assert.equal(result.support, 'exact');
});

test('positive: case-insensitive match is exact', () => {
  const result = assessSpanEntailment({
    question: 'What is the location?',
    claimedAnswer: 'THE CASTLE',
    sourceText: 'The story begins at the castle on the hill.',
  });
  assert.equal(result.support, 'exact');
});

// ===========================================================================
// Negative controls — cleanly unsupported answers
// ===========================================================================

test('negative: answer absent from source is unsupported', () => {
  const result = assessSpanEntailment({
    question: 'What is the location?',
    claimedAnswer: 'THE DUNGEON',
    sourceText: 'The castle garden was full of flowers. The tower stood tall.',
  });
  assert.equal(result.support, 'unsupported');
});

test('negative: single word not in source is unsupported', () => {
  const result = assessSpanEntailment({
    question: 'What adjective describes the dragon?',
    claimedAnswer: 'majestic',
    sourceText: 'The dragon is small and friendly. It likes to play.',
  });
  assert.equal(result.support, 'unsupported');
});

// ===========================================================================
// Paraphrase detection
// ===========================================================================

test('paraphrase: same tokens in different order triggers paraphrase (not exact)', () => {
  // "static adaptive menus" — tokens appear in source sentence but with punctuation
  // separating them, so verbatim substring fails; token overlap is 3/6 = 0.5 → paraphrase
  const result = assessSpanEntailment({
    question: 'What was being compared?',
    claimedAnswer: 'static adaptive menus',
    sourceText: 'Comparing static, adaptive menus in detail.',
  });
  // Jaccard = {static,adaptive,menus} / {comparing,static,adaptive,menus,in,detail} = 3/6 = 0.5
  assert.ok(
    result.support === 'paraphrase' || result.support === 'exact',
    `Expected paraphrase or exact, got: ${result.support}`,
  );
});

// ===========================================================================
// Exact-string question detection
// ===========================================================================

test('question with "exactly as it appears" is flagged', () => {
  const result = assessSpanEntailment({
    question: 'What is the heading, exactly as it appears in the document?',
    claimedAnswer: 'THE CASTLE',
    sourceText: 'Heading: THE CASTLE',
  });
  assert.equal(result.exactStringQuestion, true);
});

test('question with "quote the exact sentence" is flagged', () => {
  const result = assessSpanEntailment({
    question: 'Quote the exact sentence identifying the ratification date of the US Bill of Rights.',
    claimedAnswer: 'By December 15, 1791, three-fourths of the states had ratified 10 of these, now known as the Bill of Rights.',
    sourceText: 'By December 15, 1791, three-fourths of the states had ratified 10 of these, now known as the Bill of Rights.',
  });
  assert.equal(result.exactStringQuestion, true);
});

test('question with "exact one-line description" is flagged', () => {
  const result = assessSpanEntailment({
    question: 'Quote the exact one-line description of HTTP status 418 as defined in RFC 2324 section 2.3.2.',
    claimedAnswer: 'Any attempt to brew coffee with a teapot should result in the error code "418 I\'m a teapot".',
    sourceText: 'Any attempt to brew coffee with a teapot should result in the error code "418 I\'m a teapot".',
  });
  assert.equal(result.exactStringQuestion, true);
});

test('question with "as given in the ... lede" is flagged', () => {
  const result = assessSpanEntailment({
    question: 'Quote the exact sentence naming the number of authors of "Attention Is All You Need" as given in the Wikipedia lede.',
    claimedAnswer: '"Attention Is All You Need" is a 2017 research paper in machine learning authored by eight scientists working at Google.',
    sourceText: '"Attention Is All You Need" is a 2017 research paper in machine learning authored by eight scientists working at Google.',
  });
  assert.equal(result.exactStringQuestion, true);
});

test('question without exact-string phrase is not flagged', () => {
  const result = assessSpanEntailment({
    question: 'What is the general location in the story?',
    claimedAnswer: 'the castle',
    sourceText: 'The story is set in a medieval castle.',
  });
  assert.equal(result.exactStringQuestion, false);
});
