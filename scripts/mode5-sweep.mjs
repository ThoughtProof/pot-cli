#!/usr/bin/env node
/**
 * Mode 5 Probe Sweep — matcher-only, no LLM.
 *
 * For each of the 40 cases in plv-new-40-cases-2026-04-26.json we synthesize
 * a Mode-5-pattern quote (cross-line truncation: takes one line of trace_steps
 * + a leading fragment of the next line) and run it through detectMode5.
 *
 * This is a structural sweep — it answers: "of the cases that exhibit a
 * cross-line truncation pattern in their traces, how many would the probes
 * label correctly?" No verdict-run, no LLM call, no scoring impact.
 */
import { readFileSync } from 'node:fs';
import { detectMode5 } from '../dist/plan/probes/mode5-truncation-detection.js';

const casesPath = process.argv[2] ?? '/home/user/workspace/plv-new-40-cases-2026-04-26.json';
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

/**
 * Synthesize a Mode-5-style truncation quote from a trace.
 * Reference pattern (CODE-02): one full line + "\n" + leading 8-12 chars of next line.
 * Returns null if the trace can't carry such a pattern.
 */
function synthesizeMode5Quote(trace) {
  const lines = trace.split('\n');
  if (lines.length < 2) return null;

  // Take the first non-trivial line and the first 8-12 chars of the next line.
  for (let i = 0; i < lines.length - 1; i++) {
    const left = lines[i].trim();
    const next = lines[i + 1].trim();
    if (left.length < 20) continue;       // need a substantive left half
    if (next.length < 12) continue;       // need a substantive right half
    // Truncate "next" mid-word: take 10 chars, ensure last char is letter or [
    const tail = next.slice(0, 10);
    if (!/[A-Za-z\[\(]$/.test(tail)) continue;
    return `${left}\n${tail}`;
  }
  return null;
}

const results = [];
let synthesized = 0;
let triggeredAny = 0;
let trig5a = 0;
let trig5b = 0;
let trig5c = 0;
let trigCombo = 0; // ≥2 signals

/**
 * Synthesize a Mode-5 BRIDGE-SPAN quote (Probe 5c target):
 * concatenate Step 1's content with the START of a NON-ADJACENT step
 * (Step ≥3) so the resulting span is NOT contiguous in the trace.
 */
function synthesizeBridgeQuote(trace) {
  const lines = trace.split('\n');
  if (lines.length < 3) return null;
  const left = lines[0].trim();
  // pick a line at index >=2 (skip the directly adjacent line)
  for (let j = 2; j < lines.length; j++) {
    const right = lines[j].trim();
    if (left.length >= 10 && right.length >= 8) {
      // truncate right to ~12 chars on a clean word boundary or letter
      const tail = right.slice(0, 12);
      if (!/[A-Za-z\[\(]$/.test(tail)) continue;
      return `${left}\n${tail}`;
    }
  }
  return null;
}

let bridgeSynth = 0;
let bridgeTrig5c = 0;

for (const c of cases) {
  const trace = c.trace_steps ?? '';
  const quote = synthesizeMode5Quote(trace);
  if (!quote) {
    results.push({ id: c.id, status: 'skip-no-pattern', signals: [] });
    continue;
  }
  synthesized++;

  // Sweep is matcher-only: we just call detectMode5 on the synthetic quote
  // against the real trace. No verifyProvenance, no scoring — pure detection.
  const det = detectMode5(quote, trace);
  const signals = det.signals;
  if (signals.length > 0) triggeredAny++;
  if (signals.includes('cross_line_fragment_tail')) trig5a++;
  if (signals.includes('mid_word_termination')) trig5b++;
  if (signals.includes('bridge_span_concat')) trig5c++;
  if (signals.length >= 2) trigCombo++;

  // Secondary synth: bridge-span (non-adjacent halves) to exercise 5c.
  const bridgeQuote = synthesizeBridgeQuote(trace);
  let bridgeSignals = [];
  if (bridgeQuote) {
    bridgeSynth++;
    const bdet = detectMode5(bridgeQuote, trace);
    bridgeSignals = bdet.signals;
    if (bdet.signals.includes('bridge_span_concat')) bridgeTrig5c++;
  }

  results.push({
    id: c.id,
    status: signals.length > 0 ? 'mode5-detected' : 'no-signal',
    signals,
    bridge_signals: bridgeSignals,
    quote_preview: quote.length > 70 ? quote.slice(0, 67) + '...' : quote,
  });
}

console.log('\n# Mode 5 Probe Sweep — synthesized truncation quotes\n');
console.log(`Total cases:                ${cases.length}`);
console.log(`Synthesizable (≥2 lines):   ${synthesized}`);
console.log(`Triggered ≥1 signal:        ${triggeredAny}`);
console.log(`  5a cross_line_fragment_tail: ${trig5a}`);
console.log(`  5b mid_word_termination:     ${trig5b}`);
console.log(`  5c bridge_span_concat:       ${trig5c}`);
console.log(`  Combo (≥2 signals):          ${trigCombo}`);
console.log('\n## Bridge-Span (Probe 5c) follow-up sweep\n');
console.log('Synthesis: left = Step 1, right = first 12 chars of a NON-adjacent step (≥3).');
console.log(`  Bridge-synthesizable cases:  ${bridgeSynth}`);
console.log(`  Triggered 5c bridge_span:    ${bridgeTrig5c}`);
console.log('\n## Per-case detail\n');
console.log('| Case | Status | Truncation signals | Bridge-quote signals | Quote preview |');
console.log('|---|---|---|---|---|');
for (const r of results) {
  const sig = r.signals.join(',') || '—';
  const bsig = (r.bridge_signals && r.bridge_signals.length) ? r.bridge_signals.join(',') : '—';
  const q = (r.quote_preview ?? '').replace(/\n/g, '\\n').replace(/\|/g, '\\|');
  console.log(`| ${r.id} | ${r.status} | ${sig} | ${bsig} | \`${q}\` |`);
}
