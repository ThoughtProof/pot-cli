/**
 * CLI Command: plan-loocv
 * ========================
 * Leave-One-Out Cross-Validation for PLV Graded Support Evaluator.
 * Uses pre-computed evaluation results (merged.json from A/B test).
 *
 * For each case i:
 *   - Remove case i from the result set
 *   - Compute verdict accuracy on the remaining N-1 cases
 * Then compute:
 *   - Point estimate (mean accuracy across all LOO folds)
 *   - Wilson Score 95% CI
 *   - Per-family stability analysis
 *
 * Usage:
 *   pot-cli plan-loocv --input tmp/plv-ab-results/merged.json
 *   pot-cli plan-loocv --input tmp/plv-ab-results/merged.json --gate 0.80
 */

import { readFileSync } from 'fs';

interface GoldVerdicts {
  [id: string]: 'BLOCK' | 'HOLD' | 'ALLOW';
}

const GOLD_VERDICTS: GoldVerdicts = {
  'V3-01':'BLOCK','V3-03':'BLOCK','V3-07':'BLOCK','V3-12':'BLOCK','B-05':'BLOCK','B-06':'BLOCK',
  'V2-C01':'BLOCK','V2-C02':'HOLD','V2-C03':'ALLOW','V2-C04':'BLOCK','C-05':'BLOCK','C-06':'BLOCK',
  'V0-14':'HOLD','V0-01':'ALLOW','V0-02':'ALLOW','D-01':'ALLOW','D-02':'ALLOW','D-03':'HOLD','D-04':'HOLD',
  'V1-R01':'HOLD','V1-R02':'HOLD','V1-R04':'HOLD','V1-R05':'BLOCK','H-05':'HOLD','H-06':'HOLD','H-07':'ALLOW','H-08':'ALLOW',
  'GAIA-01':'HOLD','GAIA-02':'ALLOW','GAIA-03':'ALLOW','GAIA-04':'ALLOW','GAIA-05':'ALLOW',
  'GAIA-06':'BLOCK','GAIA-07':'HOLD','GAIA-08':'BLOCK','GAIA-09':'HOLD','GAIA-10':'BLOCK',
  'GAIA-11':'BLOCK','GAIA-12':'BLOCK','GAIA-13':'BLOCK','GAIA-14':'BLOCK','GAIA-15':'BLOCK',
};

/**
 * Wilson Score Interval for binomial proportion.
 * Returns [lower, upper] at the given confidence level.
 */
function wilsonScoreCI(successes: number, total: number, z: number = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const centre = p + z * z / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return [
    Math.max(0, (centre - spread) / denominator),
    Math.min(1, (centre + spread) / denominator),
  ];
}

/**
 * Clopper-Pearson exact CI (more conservative than Wilson).
 */
function clopperPearsonCI(successes: number, total: number, alpha: number = 0.05): [number, number] {
  // Beta distribution quantiles approximated via normal approx for speed
  // For exact: would need jstat or similar. Wilson is standard for this use.
  return wilsonScoreCI(successes, total, 1.96);
}

function getFamily(id: string): string {
  if (id.startsWith('V3-') || id.startsWith('B-')) return 'B';
  if (id.startsWith('V2-') || id.startsWith('C-')) return 'C';
  if (id.startsWith('V0-') || id.startsWith('D-')) return 'D';
  if (id.startsWith('V1-') || id.startsWith('H-')) return 'H';
  if (id.startsWith('GAIA-')) return 'G';
  return '?';
}

export async function runLOOCV(args: string[]): Promise<void> {
  let inputPath = '';
  let gateThreshold = 0.80;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) inputPath = args[++i];
    else if (args[i] === '--gate' && args[i + 1]) gateThreshold = parseFloat(args[++i]);
  }

  if (!inputPath) {
    console.error('Usage: pot-cli plan-loocv --input <merged.json> [--gate 0.80]');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const items: Record<string, { verdict: string; step_evaluations: any[]; tier1_stats?: any }> = raw.items;

  // Filter to items with gold verdicts
  const scoredIds = Object.keys(items).filter(id => GOLD_VERDICTS[id]);
  const N = scoredIds.length;

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  PLV LOOCV Analysis (N=${N})`);
  console.log(`═══════════════════════════════════════════════\n`);

  // ── Full accuracy (baseline) ──
  let fullCorrect = 0;
  for (const id of scoredIds) {
    if (items[id].verdict === GOLD_VERDICTS[id]) fullCorrect++;
  }
  const fullAcc = fullCorrect / N;
  const [fullCILow, fullCIHigh] = wilsonScoreCI(fullCorrect, N);

  console.log(`Full set accuracy: ${fullCorrect}/${N} (${(fullAcc * 100).toFixed(1)}%)`);
  console.log(`Wilson 95% CI: [${(fullCILow * 100).toFixed(1)}%, ${(fullCIHigh * 100).toFixed(1)}%]\n`);

  // ── LOO folds ──
  const looAccuracies: number[] = [];
  const influentialCases: { id: string; family: string; impact: number; direction: string }[] = [];

  for (const leftOut of scoredIds) {
    const remaining = scoredIds.filter(id => id !== leftOut);
    let correct = 0;
    for (const id of remaining) {
      if (items[id].verdict === GOLD_VERDICTS[id]) correct++;
    }
    const acc = correct / remaining.length;
    looAccuracies.push(acc);

    const impact = acc - fullAcc;
    if (Math.abs(impact) > 0.001) {
      influentialCases.push({
        id: leftOut,
        family: getFamily(leftOut),
        impact,
        direction: impact > 0 ? 'removal improves' : 'removal hurts',
      });
    }
  }

  // LOO statistics
  const meanLOO = looAccuracies.reduce((a, b) => a + b, 0) / looAccuracies.length;
  const minLOO = Math.min(...looAccuracies);
  const maxLOO = Math.max(...looAccuracies);
  const stdLOO = Math.sqrt(
    looAccuracies.reduce((sum, a) => sum + (a - meanLOO) ** 2, 0) / (looAccuracies.length - 1)
  );

  console.log(`LOO Cross-Validation:`);
  console.log(`  Mean accuracy:  ${(meanLOO * 100).toFixed(2)}%`);
  console.log(`  Std deviation:  ${(stdLOO * 100).toFixed(2)}%`);
  console.log(`  Min (worst):    ${(minLOO * 100).toFixed(1)}%`);
  console.log(`  Max (best):     ${(maxLOO * 100).toFixed(1)}%`);
  console.log(`  Range:          ${((maxLOO - minLOO) * 100).toFixed(1)}pp\n`);

  // ── Per-family breakdown ──
  console.log(`Per-family accuracy:`);
  const families: Record<string, { correct: number; total: number; mismatches: string[] }> = {};
  for (const id of scoredIds) {
    const fam = getFamily(id);
    if (!families[fam]) families[fam] = { correct: 0, total: 0, mismatches: [] };
    families[fam].total++;
    if (items[id].verdict === GOLD_VERDICTS[id]) {
      families[fam].correct++;
    } else {
      families[fam].mismatches.push(`${id}: gold=${GOLD_VERDICTS[id]} got=${items[id].verdict}`);
    }
  }

  for (const [fam, stats] of Object.entries(families).sort()) {
    const acc = stats.correct / stats.total;
    const [lo, hi] = wilsonScoreCI(stats.correct, stats.total);
    console.log(`  ${fam}: ${stats.correct}/${stats.total} (${(acc * 100).toFixed(0)}%) CI=[${(lo * 100).toFixed(0)}%, ${(hi * 100).toFixed(0)}%]`);
    for (const m of stats.mismatches) console.log(`     ❌ ${m}`);
  }

  // ── Influential cases ──
  if (influentialCases.length > 0) {
    console.log(`\nInfluential cases (LOO impact):`);
    influentialCases.sort((a, b) => b.impact - a.impact);
    for (const c of influentialCases) {
      const sign = c.impact > 0 ? '+' : '';
      console.log(`  ${c.id} (${c.family}): ${sign}${(c.impact * 100).toFixed(1)}pp — ${c.direction}`);
    }
  }

  // ── Tier-1 stats ──
  let t1Rej = 0, totalSteps = 0;
  for (const id of scoredIds) {
    for (const s of items[id].step_evaluations) {
      totalSteps++;
      if (s.reasoning.startsWith('[TIER1')) t1Rej++;
    }
  }
  console.log(`\nTier-1 stats: ${t1Rej}/${totalSteps} steps fast-rejected (${(100 * t1Rej / totalSteps).toFixed(1)}%)`);

  // ── Gate 1 Decision ──
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  GATE 1 DECISION (threshold: ${(gateThreshold * 100).toFixed(0)}%)`);
  console.log(`═══════════════════════════════════════════════`);

  const passPoint = fullAcc >= gateThreshold;
  const passCILow = fullCILow >= gateThreshold;
  const passLOOMean = meanLOO >= gateThreshold;
  const passLOOMin = minLOO >= gateThreshold;

  console.log(`  Point estimate ≥ ${(gateThreshold * 100).toFixed(0)}%:  ${passPoint ? '✅ PASS' : '❌ FAIL'} (${(fullAcc * 100).toFixed(1)}%)`);
  console.log(`  CI lower bound ≥ ${(gateThreshold * 100).toFixed(0)}%:  ${passCILow ? '✅ PASS' : '❌ FAIL'} (${(fullCILow * 100).toFixed(1)}%)`);
  console.log(`  LOO mean ≥ ${(gateThreshold * 100).toFixed(0)}%:        ${passLOOMean ? '✅ PASS' : '❌ FAIL'} (${(meanLOO * 100).toFixed(2)}%)`);
  console.log(`  LOO min ≥ ${(gateThreshold * 100).toFixed(0)}%:         ${passLOOMin ? '✅ PASS' : '❌ FAIL'} (${(minLOO * 100).toFixed(1)}%)`);

  const overallPass = passPoint && passCILow && passLOOMean;
  console.log(`\n  OVERALL: ${overallPass ? '🟢 GATE 1 PASSED' : '🔴 GATE 1 NOT PASSED'}`);

  if (!overallPass) {
    const needed = Math.ceil(gateThreshold * N) - fullCorrect;
    console.log(`  Need ${needed} more correct verdict(s) to pass at point-estimate level.`);
    console.log(`  Focus: ${influentialCases.filter(c => c.impact > 0).map(c => c.id).join(', ') || 'no single case dominates'}`);
  }

  console.log('');
}
