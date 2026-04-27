/**
 * Test: conditions plumbing from evaluateItem → public output
 *
 * Verifies that CONDITIONAL_ALLOW conditions propagate through
 * toPublicVerdict() when called with item.conditions.
 *
 * Bug found by Paul's CM-Run (2026-04-27): toPublicVerdict() was called
 * without item.conditions, producing metadata.conditions=[] for CA verdicts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicVerdict, type InternalVerdict } from '../verdict-mapper.js';

// ─── T14: Conditions survive public mapping when passed ──────────────────────

test('T14: toPublicVerdict(CA, conditions) propagates conditions to metadata', () => {
  const conditions = [
    'step_1: partial (score=0.5, non-critical)',
    'step_4: partial (score=0.25, non-critical)',
  ];
  const pub = toPublicVerdict('CONDITIONAL_ALLOW', conditions);
  assert.equal(pub.verdict, 'ALLOW');
  assert.deepStrictEqual(pub.metadata.conditions, conditions);
  assert.equal(pub.metadata.conditions!.length, 2);
});

// ─── T15: CA without conditions defaults to empty array ─────────────────────

test('T15: toPublicVerdict(CA) without conditions defaults to []', () => {
  const pub = toPublicVerdict('CONDITIONAL_ALLOW');
  assert.equal(pub.verdict, 'ALLOW');
  assert.deepStrictEqual(pub.metadata.conditions, []);
});

// ─── T16: Non-CA verdicts have no conditions in metadata ────────────────────

test('T16: ALLOW/HOLD/DISSENT/BLOCK have no conditions in metadata', () => {
  for (const v of ['ALLOW', 'HOLD', 'DISSENT', 'BLOCK'] as InternalVerdict[]) {
    const pub = toPublicVerdict(v);
    assert.equal(pub.metadata.conditions, undefined,
      `${v} should not have conditions in metadata`);
  }
  // ADR-0001: DISSENT→UNCERTAIN carries dissent:true, not conditions
  const dissent = toPublicVerdict('DISSENT');
  assert.equal(dissent.verdict, 'UNCERTAIN');
  assert.equal(dissent.metadata.dissent, true);
  assert.equal(dissent.metadata.conditions, undefined);
});
