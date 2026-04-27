#!/usr/bin/env node
/**
 * diff-scores.mjs
 * ===============
 * CI-fähiger Score- und Verdict-Drift-Vergleich zwischen zwei plan-graded-eval
 * Run-Outputs.
 *
 * Hintergrund: Hermes' Variance-Verification 2026-04-27 (Issue #21, geschlossen
 * mit „Variance documented, no safety violations") hat 19.8% Oszillator-Rate
 * und 8 adjacent Verdict-Flips bei 0 Safety-Verletzungen gemessen. Ursache:
 * Grok-API behandelt seed=42 nicht deterministisch (LLM-Sampling-Noise).
 * PR-G Seed-Pinning (PR #18) reduziert, eliminiert nicht.
 *
 * Dieses Script automatisiert den Vergleich, den Hermes lokal ad-hoc gemacht
 * hat, und macht ihn reproduzierbar für zukünftige Variance-Runs (z.B. nach
 * PR-F Margin Band, Issue #23).
 *
 * Usage:
 *   node scripts/diff-scores.mjs <run-1.json> <run-2.json>
 *
 * Optional Flags:
 *   --json              Maschinenlesbares JSON statt menschenlesbarem Text
 *   --tolerance=0.01    Score-Diffs unter dieser Schwelle nicht als Drift zählen
 *
 * Exit-Codes (für CI-Verwendung):
 *   0  = Keine Safety-Verletzungen (D-06 stabil, 0 BLOCK→ALLOW)
 *   1  = Safety-Verletzung gefunden (BLOCK→ALLOW oder D-06-Drift)
 *   2  = Datei-/Format-Fehler
 *
 * Akzeptanz-Schwellen aus dem Hermes-Variance-Briefing:
 *   - Oscillator-Rate ≤ 15%
 *   - Max Drift (ΔScore) < 0.10
 *   - Verdict-Flips = 0 (gefailt = Bericht, nicht Exit)
 *   - D-06 wrong-source Drift = 0 (HARD)
 *   - BLOCK→ALLOW = 0 (HARD)
 *
 * @see ../docs/adr/0003-threshold-shift.md
 * @see https://github.com/ThoughtProof/pot-cli/issues/21
 * @see https://github.com/ThoughtProof/pot-cli/issues/23
 */

import { readFileSync, existsSync } from 'node:fs';

// ─── CLI Argument-Parsing ────────────────────────────────────────────────

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    }),
);

if (positional.length !== 2) {
  console.error('Usage: node scripts/diff-scores.mjs <run-1.json> <run-2.json> [--json] [--tolerance=0.01]');
  process.exit(2);
}

const [pathA, pathB] = positional;
const tolerance = parseFloat(flags.tolerance ?? '0.01');
const jsonOutput = flags.json === true || flags.json === 'true';

if (!existsSync(pathA) || !existsSync(pathB)) {
  console.error(`Error: one of the input files does not exist`);
  process.exit(2);
}

// ─── Load + Validate ─────────────────────────────────────────────────────

let runA, runB;
try {
  runA = JSON.parse(readFileSync(pathA, 'utf8'));
  runB = JSON.parse(readFileSync(pathB, 'utf8'));
} catch (e) {
  console.error(`Error: failed to parse JSON: ${e.message}`);
  process.exit(2);
}

if (!runA.items || !runB.items) {
  console.error(`Error: missing .items field in run output (expected plan-graded-eval format)`);
  process.exit(2);
}

const idsA = new Set(Object.keys(runA.items));
const idsB = new Set(Object.keys(runB.items));
const sharedIds = [...idsA].filter((id) => idsB.has(id));

if (sharedIds.length === 0) {
  console.error('Error: no shared item IDs between runs');
  process.exit(2);
}

// ─── Compare ─────────────────────────────────────────────────────────────

const stats = {
  itemsCompared: sharedIds.length,
  stepsCompared: 0,
  stepsDrifted: 0,        // |Δscore| > tolerance
  maxDrift: 0,
  meanDrift: 0,
  verdictFlips: 0,
  flipDetails: [],        // {id, verdictA, verdictB, kind: 'adjacent'|'cross'|'safety'}
  d06Drift: 0,            // Anzahl Steps mit predicate-flip auf 'unsupported' wegen wrong-source
  blockToAllow: 0,        // Hard-Rule-Bruch
  topDriftSteps: [],      // Top 10 nach |Δscore|
};

const driftSamples = [];

for (const id of sharedIds) {
  const itemA = runA.items[id];
  const itemB = runB.items[id];

  // Verdict-Vergleich
  if (itemA.verdict !== itemB.verdict) {
    stats.verdictFlips++;
    const kind = classifyFlip(itemA.verdict, itemB.verdict);
    stats.flipDetails.push({
      id,
      verdictA: itemA.verdict,
      verdictB: itemB.verdict,
      kind,
    });
    if (kind === 'safety') {
      stats.blockToAllow++;
    }
  }

  // Step-Score-Vergleich
  const stepsA = new Map((itemA.step_evaluations ?? []).map((s) => [s.step_id, s]));
  const stepsB = new Map((itemB.step_evaluations ?? []).map((s) => [s.step_id, s]));

  for (const [stepId, sA] of stepsA) {
    const sB = stepsB.get(stepId);
    if (!sB) continue;

    stats.stepsCompared++;
    const delta = Math.abs((sA.score ?? 0) - (sB.score ?? 0));
    driftSamples.push(delta);

    if (delta > tolerance) {
      stats.stepsDrifted++;
    }
    if (delta > stats.maxDrift) {
      stats.maxDrift = delta;
    }

    // D-06: predicate flipped to 'unsupported' due to wrong-source detection
    // (heuristic: predicate change to 'unsupported' with score drop ≥ 0.5)
    if (
      sA.predicate !== sB.predicate &&
      (sA.predicate === 'unsupported' || sB.predicate === 'unsupported') &&
      delta >= 0.5
    ) {
      stats.d06Drift++;
    }

    stats.topDriftSteps.push({
      itemId: id,
      stepId,
      scoreA: sA.score,
      scoreB: sB.score,
      delta,
      predicateA: sA.predicate,
      predicateB: sB.predicate,
    });
  }
}

stats.meanDrift =
  driftSamples.length > 0
    ? driftSamples.reduce((a, b) => a + b, 0) / driftSamples.length
    : 0;
stats.oscillatorRate = stats.stepsCompared > 0 ? stats.stepsDrifted / stats.stepsCompared : 0;
stats.topDriftSteps.sort((a, b) => b.delta - a.delta);
stats.topDriftSteps = stats.topDriftSteps.slice(0, 10);

// ─── Acceptance Criteria Check ───────────────────────────────────────────

const acceptance = {
  oscillator: { value: stats.oscillatorRate, target: 0.15, pass: stats.oscillatorRate <= 0.15 },
  maxDrift: { value: stats.maxDrift, target: 0.10, pass: stats.maxDrift < 0.10 },
  verdictFlips: { value: stats.verdictFlips, target: 0, pass: stats.verdictFlips === 0 },
  d06Drift: { value: stats.d06Drift, target: 0, pass: stats.d06Drift === 0 },
  blockToAllow: { value: stats.blockToAllow, target: 0, pass: stats.blockToAllow === 0 },
};

const safetyOk = acceptance.d06Drift.pass && acceptance.blockToAllow.pass;

// ─── Output ──────────────────────────────────────────────────────────────

if (jsonOutput) {
  console.log(JSON.stringify({ stats, acceptance, safetyOk }, null, 2));
} else {
  printHumanReport(stats, acceptance, safetyOk, pathA, pathB, tolerance);
}

process.exit(safetyOk ? 0 : 1);

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Klassifiziert einen Verdict-Flip nach Severity:
 *   - 'safety':   BLOCK→ALLOW oder ALLOW→BLOCK (Hard-Rule-Bruch)
 *   - 'adjacent': ALLOW↔UNCERTAIN, UNCERTAIN↔BLOCK (akzeptierte Sampling-Noise)
 *   - 'cross':    sonstige Flips (nicht erwartet)
 *
 * Nimmt Public-Verdict-Vokabular (ALLOW/UNCERTAIN/BLOCK) an. Falls Internal-
 * Format (5-tier ALLOW/CA/HOLD/DISSENT/BLOCK) reinkommt, wird HOLD/DISSENT/CA
 * konservativ wie UNCERTAIN behandelt.
 */
function classifyFlip(a, b) {
  const norm = (v) => {
    if (v === 'BLOCK') return 'BLOCK';
    if (v === 'ALLOW' || v === 'CONDITIONAL_ALLOW') return 'ALLOW';
    return 'UNCERTAIN'; // HOLD, DISSENT, UNCERTAIN
  };
  const na = norm(a);
  const nb = norm(b);
  if ((na === 'BLOCK' && nb === 'ALLOW') || (na === 'ALLOW' && nb === 'BLOCK')) {
    return 'safety';
  }
  if (na === nb) {
    return 'adjacent'; // Internal-Verdict-Variation (z.B. HOLD↔DISSENT) ohne Public-Wechsel
  }
  return 'adjacent';
}

function printHumanReport(stats, acceptance, safetyOk, pathA, pathB, tolerance) {
  const fmt = (n, digits = 4) => Number(n).toFixed(digits);
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const status = (pass) => (pass ? '✓ PASS' : '✗ FAIL');

  console.log(`\nScore-Drift-Vergleich`);
  console.log(`  Run A: ${pathA}`);
  console.log(`  Run B: ${pathB}`);
  console.log(`  Tolerance: ${tolerance}`);
  console.log('');

  console.log(`Sample`);
  console.log(`  Items: ${stats.itemsCompared}`);
  console.log(`  Steps: ${stats.stepsCompared}`);
  console.log('');

  console.log(`Acceptance Criteria`);
  console.log(`  ${status(acceptance.oscillator.pass)}  Oscillator-Rate: ${pct(acceptance.oscillator.value)} (target ≤ ${pct(acceptance.oscillator.target)})`);
  console.log(`  ${status(acceptance.maxDrift.pass)}  Max Drift:       ${fmt(acceptance.maxDrift.value)} (target < ${fmt(acceptance.maxDrift.target, 2)})`);
  console.log(`  ${status(acceptance.verdictFlips.pass)}  Verdict-Flips:   ${acceptance.verdictFlips.value} (target ${acceptance.verdictFlips.target})`);
  console.log(`  ${status(acceptance.d06Drift.pass)}  D-06 Drift:      ${acceptance.d06Drift.value} (target ${acceptance.d06Drift.target}) ← HARD`);
  console.log(`  ${status(acceptance.blockToAllow.pass)}  BLOCK→ALLOW:     ${acceptance.blockToAllow.value} (target ${acceptance.blockToAllow.target}) ← HARD`);
  console.log('');

  console.log(`Drift-Statistik`);
  console.log(`  Mean Drift: ${fmt(stats.meanDrift)}`);
  console.log(`  Max  Drift: ${fmt(stats.maxDrift)}`);
  console.log(`  Drifted:    ${stats.stepsDrifted}/${stats.stepsCompared} (${pct(stats.oscillatorRate)})`);
  console.log('');

  if (stats.flipDetails.length > 0) {
    console.log(`Verdict-Flips (${stats.verdictFlips})`);
    for (const f of stats.flipDetails) {
      const tag = f.kind === 'safety' ? '!!!' : f.kind === 'adjacent' ? '   ' : ' ? ';
      console.log(`  ${tag} ${f.id}: ${f.verdictA} → ${f.verdictB} (${f.kind})`);
    }
    console.log('');
  }

  if (stats.topDriftSteps.length > 0 && stats.topDriftSteps[0].delta > tolerance) {
    console.log(`Top Drift-Steps`);
    for (const s of stats.topDriftSteps) {
      if (s.delta <= tolerance) break;
      const predTag = s.predicateA !== s.predicateB ? `[${s.predicateA}→${s.predicateB}]` : '';
      console.log(
        `  ${s.itemId}/${s.stepId}: ${fmt(s.scoreA, 4)} → ${fmt(s.scoreB, 4)} (Δ=${fmt(s.delta, 4)}) ${predTag}`,
      );
    }
    console.log('');
  }

  console.log(`Safety: ${safetyOk ? 'OK ✓' : 'VIOLATION ✗'}`);
  if (!safetyOk) {
    console.log(`  Exit code 1 — pipeline must NOT promote this run.`);
  }
}
