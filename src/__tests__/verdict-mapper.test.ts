/**
 * verdict-mapper.test.ts
 * ======================
 * Anti-leak regression guard: ensures internal verdicts never leak
 * into public API responses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  toPublicVerdict,
  isInternalFormatAllowed,
  assertInternalFormat,
  type InternalVerdict,
  type PublicVerdict,
} from '../verdict-mapper.js';

describe('toPublicVerdict', () => {
  // ── All 5 internal states × expected public output ──

  it('maps ALLOW → ALLOW with schema_version v2', () => {
    const result = toPublicVerdict('ALLOW');
    expect(result.verdict).toBe('ALLOW');
    expect(result.metadata.schema_version).toBe('v2');
    expect(result.metadata.conditions).toBeUndefined();
    expect(result.metadata.review_needed).toBeUndefined();
    expect(result.metadata.dissent).toBeUndefined();
  });

  it('maps CONDITIONAL_ALLOW → ALLOW with conditions array', () => {
    const conditions = ['source verified', 'within scope'];
    const result = toPublicVerdict('CONDITIONAL_ALLOW', conditions);
    expect(result.verdict).toBe('ALLOW');
    expect(result.metadata.schema_version).toBe('v2');
    expect(result.metadata.conditions).toEqual(conditions);
  });

  it('maps CONDITIONAL_ALLOW with empty conditions → ALLOW with empty array', () => {
    const result = toPublicVerdict('CONDITIONAL_ALLOW');
    expect(result.verdict).toBe('ALLOW');
    expect(result.metadata.conditions).toEqual([]);
  });

  it('maps HOLD → UNCERTAIN with review_needed', () => {
    const result = toPublicVerdict('HOLD');
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.metadata.schema_version).toBe('v2');
    expect(result.metadata.review_needed).toBe(true);
  });

  it('maps DISSENT → UNCERTAIN with dissent flag', () => {
    const result = toPublicVerdict('DISSENT');
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.metadata.schema_version).toBe('v2');
    expect(result.metadata.dissent).toBe(true);
  });

  it('maps BLOCK → BLOCK with schema_version v2', () => {
    const result = toPublicVerdict('BLOCK');
    expect(result.verdict).toBe('BLOCK');
    expect(result.metadata.schema_version).toBe('v2');
  });

  // ── Anti-leak guards: MUST NOT leak internal tier names ──

  it('MUST NOT leak internal tier — HOLD never appears in public verdict', () => {
    const allInternal: InternalVerdict[] = [
      'ALLOW', 'CONDITIONAL_ALLOW', 'HOLD', 'DISSENT', 'BLOCK',
    ];
    for (const v of allInternal) {
      const result = toPublicVerdict(v);
      expect(result.verdict).not.toBe('HOLD');
      expect(result.verdict).not.toBe('CONDITIONAL_ALLOW');
      expect(result.verdict).not.toBe('DISSENT');
    }
  });

  it('MUST NOT leak internal tier — only ALLOW/BLOCK/UNCERTAIN in output', () => {
    const allInternal: InternalVerdict[] = [
      'ALLOW', 'CONDITIONAL_ALLOW', 'HOLD', 'DISSENT', 'BLOCK',
    ];
    const validPublic: PublicVerdict[] = ['ALLOW', 'BLOCK', 'UNCERTAIN'];
    for (const v of allInternal) {
      const result = toPublicVerdict(v);
      expect(validPublic).toContain(result.verdict);
    }
  });

  it('schema_version is v2 on every output', () => {
    const allInternal: InternalVerdict[] = [
      'ALLOW', 'CONDITIONAL_ALLOW', 'HOLD', 'DISSENT', 'BLOCK',
    ];
    for (const v of allInternal) {
      const result = toPublicVerdict(v);
      expect(result.metadata.schema_version).toBe('v2');
    }
  });

  // ── Exhaustiveness: unknown verdict throws ──

  it('throws on unknown internal verdict', () => {
    expect(() => toPublicVerdict('UNKNOWN' as InternalVerdict)).toThrow(
      'Unknown internal verdict',
    );
  });
});

describe('isInternalFormatAllowed', () => {
  const originalEnv = process.env.THOUGHTPROOF_INTERNAL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.THOUGHTPROOF_INTERNAL;
    } else {
      process.env.THOUGHTPROOF_INTERNAL = originalEnv;
    }
  });

  it('returns false when THOUGHTPROOF_INTERNAL is not set', () => {
    delete process.env.THOUGHTPROOF_INTERNAL;
    expect(isInternalFormatAllowed()).toBe(false);
  });

  it('returns false when THOUGHTPROOF_INTERNAL is "0"', () => {
    process.env.THOUGHTPROOF_INTERNAL = '0';
    expect(isInternalFormatAllowed()).toBe(false);
  });

  it('returns true when THOUGHTPROOF_INTERNAL is "1"', () => {
    process.env.THOUGHTPROOF_INTERNAL = '1';
    expect(isInternalFormatAllowed()).toBe(true);
  });
});

describe('assertInternalFormat', () => {
  const originalEnv = process.env.THOUGHTPROOF_INTERNAL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.THOUGHTPROOF_INTERNAL;
    } else {
      process.env.THOUGHTPROOF_INTERNAL = originalEnv;
    }
  });

  it('throws without THOUGHTPROOF_INTERNAL=1', () => {
    delete process.env.THOUGHTPROOF_INTERNAL;
    expect(() => assertInternalFormat()).toThrow('research mode');
  });

  it('does not throw with THOUGHTPROOF_INTERNAL=1', () => {
    process.env.THOUGHTPROOF_INTERNAL = '1';
    expect(() => assertInternalFormat()).not.toThrow();
  });
});
