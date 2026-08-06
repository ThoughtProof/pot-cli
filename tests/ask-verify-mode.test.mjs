import test from 'node:test';
import assert from 'node:assert/strict';

import { runSynthesizer, runDualSynthesizer } from '../dist/pipeline/synthesizer.js';

// Stub provider that captures the prompt it is called with.
function stubProvider(captured) {
  return {
    name: 'stub',
    isAvailable: () => true,
    call: async (model, prompt) => {
      captured.push({ model, prompt });
      return { content: 'Synthesis.\nConfidence: 80%' };
    },
  };
}

const proposals = [
  { model: 'g1', role: 'generator', content: 'Proposal one supports the claim with evidence.' },
  { model: 'g2', role: 'generator', content: 'Proposal two also supports the claim.' },
];
const critique = { model: 'c1', role: 'critic', content: 'No material objections.' };

test('default (epistemic) mode keeps 85% cap text', async () => {
  const captured = [];
  await runSynthesizer(stubProvider(captured), 'sonnet', proposals, critique, 'en', false);
  assert.match(captured[0].prompt, /85% maximum/);
  assert.match(captured[0].prompt, /cap at 70%/);
  assert.doesNotMatch(captured[0].prompt, /VERIFICATION MODE/);
});

test('verification mode swaps in claim-check caps (EN)', async () => {
  const captured = [];
  await runSynthesizer(stubProvider(captured), 'sonnet', proposals, critique, 'en', false, undefined, true);
  assert.match(captured[0].prompt, /VERIFICATION MODE/);
  assert.match(captured[0].prompt, /95% maximum/);
  assert.match(captured[0].prompt, /do NOT collapse to ~50%/);
  assert.doesNotMatch(captured[0].prompt, /85% maximum/);
});

test('verification mode swaps in claim-check caps (DE)', async () => {
  const captured = [];
  await runSynthesizer(stubProvider(captured), 'sonnet', proposals, critique, 'de', false, undefined, true);
  assert.match(captured[0].prompt, /VERIFICATION MODE/);
  assert.match(captured[0].prompt, /Maximum 95%/);
  assert.match(captured[0].prompt, /NICHT aus generischer Vorsicht/);
  assert.doesNotMatch(captured[0].prompt, /Maximum 85%/);
});

test('default DE prompt unchanged (regression guard)', async () => {
  const captured = [];
  await runSynthesizer(stubProvider(captured), 'sonnet', proposals, critique, 'de', false);
  assert.match(captured[0].prompt, /Maximum 85%/);
  assert.doesNotMatch(captured[0].prompt, /VERIFICATION MODE/);
});

test('runDualSynthesizer propagates verification mode to both runs', async () => {
  const captured = [];
  const p = stubProvider(captured);
  await runDualSynthesizer(p, 'sonnet', p, 'opus', proposals, critique, 'en', undefined, true);
  assert.equal(captured.length, 2);
  for (const c of captured) assert.match(c.prompt, /VERIFICATION MODE/);
});

test('runDualSynthesizer default stays epistemic on both runs', async () => {
  const captured = [];
  const p = stubProvider(captured);
  await runDualSynthesizer(p, 'sonnet', p, 'opus', proposals, critique, 'en');
  assert.equal(captured.length, 2);
  for (const c of captured) assert.match(c.prompt, /85% maximum/);
});

// Formatting guards (PR #50 review): the proposal assembly and dry-run content
// must contain REAL newlines, never literal backslash-n text. An over-escaped
// template once turned the synthesizer prompt into a one-liner with visible
// \n characters — cap-text-only tests did not catch it.

test('synthesizer prompt assembles proposals with real newlines', async () => {
  const captured = [];
  await runSynthesizer(stubProvider(captured), 'sonnet', proposals, critique, 'en', false);
  assert.match(captured[0].prompt, /\n=== PROPOSAL 1 \(g1\) ===\n/);
  assert.doesNotMatch(captured[0].prompt, /\\n=== PROPOSAL/);
});

test('synthesizer prompt newlines survive verification-mode swap', async () => {
  const captured = [];
  await runSynthesizer(stubProvider(captured), 'sonnet', proposals, critique, 'en', false, undefined, true);
  assert.match(captured[0].prompt, /\n=== PROPOSAL 1 \(g1\) ===\n/);
  assert.doesNotMatch(captured[0].prompt, /\\n=== PROPOSAL/);
});

test('dry-run content uses real newlines', async () => {
  const result = await runSynthesizer(stubProvider([]), 'sonnet', proposals, critique, 'en', true);
  assert.match(result.content, /\n\nCombining insights/);
  assert.doesNotMatch(result.content, /\\n/);
});
