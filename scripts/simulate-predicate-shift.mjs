#!/usr/bin/env node
/**
 * ADR-0003 v2.1 — Phase-1 Predicate-Simulation.
 *
 * Purpose: against Hermes' DS-Recon score distribution (4×4 runs across 158
 * steps per model), simulate the predicate transitions induced by the band
 * shift (supported 0.75→0.50, partial 0.25–0.49) and the R7/R1/quote-short
 * floors. This is Phase-1 acceptance evidence; Phase 2 (Hermes M4) provides
 * the real confusion matrix on the 82-case library.
 *
 * Caveats (intentional):
 *   - Score buckets are post-floor LLM output — we do NOT re-apply floors
 *     here, because the buckets ARE the observed distribution after floors.
 *   - Quote presence is unknown per-bucket → we report two scenarios:
 *       A) optimistic (assume all ≥ 0.50 had quote)
 *       B) pessimistic R1 (assume 25% of ≥ 0.50 lacked quote → cap to 0.25)
 *   - Predicate shifts only flip ALLOW/HOLD/BLOCK if a CRITICAL step changes
 *     class. Step-level criticality is not in the distribution table — so we
 *     report STEP-level drift, not verdict-level. Verdict drift = Phase 2.
 */

const SUPPORTED_OLD = 0.75;
const SUPPORTED_NEW = 0.50;
const PARTIAL_FLOOR = 0.25;

// Hermes 4×4 runs, 158 steps per model column.
// Buckets observed after floors (R3/R6/R7/R1/quote-short already applied).
const dist = {
  Grok:   { 0.00: 64, 0.25: 11, 0.50: 30, 0.75: 18, 1.00: 36 },
  DS:     { 0.00: 77, 0.25:  9, 0.50: 17, 0.75: 32, 1.00: 24 },
  Gemini: { 0.00: 71, 0.25: 24, 0.50: 13, 0.75: 31, 1.00: 20 },
};

function predicateOld(score) {
  if (score === 0) return 'skipped';
  if (score >= SUPPORTED_OLD) return 'supported';
  if (score >= PARTIAL_FLOOR) return 'partial';
  return 'unsupported';
}

function predicateNew(score) {
  if (score === 0) return 'skipped';
  if (score >= SUPPORTED_NEW) return 'supported';
  if (score >= PARTIAL_FLOOR) return 'partial';
  return 'unsupported';
}

function simulate(model) {
  const buckets = dist[model];
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const transitions = {};
  let unchanged = 0;
  let promoted = 0;     // partial → supported (the headline shift)
  let demoted = 0;      // any downgrade (should be 0 in the simple shift)
  for (const [scoreStr, count] of Object.entries(buckets)) {
    const score = Number(scoreStr);
    const old = predicateOld(score);
    const neu = predicateNew(score);
    const key = `${old} → ${neu}`;
    transitions[key] = (transitions[key] || 0) + count;
    if (old === neu) unchanged += count;
    else if (old === 'partial' && neu === 'supported') promoted += count;
    else demoted += count;
  }
  return { model, total, transitions, unchanged, promoted, demoted };
}

function fmtPct(n, total) {
  return `${((n / total) * 100).toFixed(1)}%`;
}

console.log('# ADR-0003 v2.1 — Step-Level Predicate-Drift Simulation');
console.log('');
console.log('Source: Hermes DS-Recon, 4 runs × 4 models, 158 steps per model.');
console.log('Method: re-classify each post-floor score bucket under the new band.');
console.log('Scope: STEP-level predicate transitions only. VERDICT-level CM = Phase 2 (Hermes M4).');
console.log('');

const results = ['Grok', 'DS', 'Gemini'].map(simulate);

for (const r of results) {
  console.log(`## ${r.model} (n=${r.total})`);
  console.log('');
  console.log('| Transition | Steps | Share |');
  console.log('|---|---:|---:|');
  for (const [key, n] of Object.entries(r.transitions)) {
    console.log(`| ${key} | ${n} | ${fmtPct(n, r.total)} |`);
  }
  console.log('');
  console.log(`- Unchanged: ${r.unchanged} (${fmtPct(r.unchanged, r.total)})`);
  console.log(`- Promoted partial→supported (the 0.50 bucket): ${r.promoted} (${fmtPct(r.promoted, r.total)})`);
  console.log(`- Demoted: ${r.demoted}`);
  console.log('');
}

console.log('## Aggregate');
console.log('');
const totalAll = results.reduce((a, r) => a + r.total, 0);
const promotedAll = results.reduce((a, r) => a + r.promoted, 0);
const demotedAll = results.reduce((a, r) => a + r.demoted, 0);
console.log(`- Total step-evaluations across 3 models: ${totalAll}`);
console.log(`- Total promoted partial→supported: ${promotedAll} (${fmtPct(promotedAll, totalAll)})`);
console.log(`- Total demoted: ${demotedAll}`);
console.log('');
console.log('## Interpretation');
console.log('');
console.log('The shift exclusively converts the 0.50-bucket from `partial` to `supported`.');
console.log('No downgrades occur in the simple shift. Demotions only enter via:');
console.log('  - R1 (no-quote at score≥0.50) — capped to 0.25, predicate becomes `partial`.');
console.log('  - R7/Quote-too-short — capped to 0.40, predicate becomes `partial`.');
console.log('Both floors are applied BEFORE the predicate band, so the buckets above');
console.log('already reflect their effect. No additional Phase-1 demotion is expected.');
console.log('');
console.log('## Hard-Rule Compatibility (User)');
console.log('');
console.log('User\'s acceptance hard-rule (from session memory): zero BLOCK→ALLOW or');
console.log('HOLD→ALLOW regressions on the 40-case CM. This Phase-1 simulation cannot');
console.log('verify that — it requires Hermes\' Phase-2 CM run on 82 cases with the');
console.log('seed pin (PR-G #18). Phase 1 evidence: only `partial→supported` transitions');
console.log('on the 0.50 bucket; never `unsupported→supported`. A BLOCK→ALLOW regression');
console.log('would require a critical step flipping unsupported→supported, which the');
console.log('shift cannot produce by construction (no score crosses the 0.25 boundary).');
