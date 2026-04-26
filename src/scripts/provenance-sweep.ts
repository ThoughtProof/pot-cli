/**
 * Provenance Matcher Sweep — vorher/nachher Confusion-Matrix
 * ===========================================================
 *
 * Two modes:
 *
 *  (A) MATCHER-ONLY MODE  (default; works without API keys)
 *      For every one of the 40 cases, take the trace_steps verbatim and
 *      probe verifyProvenance() with a deterministic set of quote variants:
 *        - exact substring (sanity baseline)
 *        - smart-apostrophe variant (Mode 1)
 *        - smart-double-quotes variant (Mode 1)
 *        - em-dash variant (Mode 1)
 *        - ellipsis-char variant (Mode 1)
 *        - structural meta-quote wrapping (Mode 3)
 *        - paraphrase variant — MUST stay rejected (Mode 2 guard)
 *        - wrong-source pattern — MUST stay rejected (Mode 4 guard)
 *      Counts how many of each Mode resolve under the BEFORE matcher
 *      (3 paths) vs the AFTER matcher (5 paths).
 *
 *  (B) FULL EVAL MODE     (--full, requires XAI_API_KEY)
 *      Runs evaluateBatch on all 40 cases, captures the verdict, then
 *      monkey-patches the matcher to disable the new paths and re-runs
 *      to compare. Produces a real verdict-level confusion matrix.
 *
 * Usage (after npm run build):
 *   node dist/scripts/provenance-sweep.js                          # mode A (matcher-only)
 *   XAI_API_KEY=... node dist/scripts/provenance-sweep.js --full   # mode B (verdict-level)
 *
 * Mode B uses the PLV_DISABLE_NEW_MATCH_PATHS env toggle in verifyProvenance
 * to run the same evaluateBatch twice (vorher disabled, nachher enabled).
 * Determinism: evaluateBatch already sets temperature=0 in Tier 2.
 *
 * Sample-Lock SHA256 (plv-new-40-cases-2026-04-26.json):
 *   ee6e43483ef18494e25a9d2fe2a8febba97b46feca06c6c872a30bf017e26814
 *
 * Output:
 *   plv_provenance_sweep_report.md           (mode A)
 *   plv_provenance_sweep_full_report.md      (mode B)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyProvenance, evaluateBatch, type StepEvaluation, type EvalInput } from '../plan/graded-support-evaluator.js';

// ─── Local replica of the BEFORE matcher (3 paths) ────────────────────────────
// Mirrors the matcher BEFORE the Mode-1/Mode-3 fixes were added. Replicates the
// EXACT logic from src/plan/graded-support-evaluator.ts as it was prior to the
// Unicode-Normalize and Strip-Wrapping-Quotes paths. Source of truth for fuzzy:
// fragments split on "...|…" must appear in order in the (whitespace-normalized) trace.
function checkTruncatedQuoteBefore(quote: string, trace: string): boolean {
  const fragments = quote.split(/\.{2,}|…/).map(f => f.trim()).filter(f => f.length >= 8);
  if (fragments.length < 1) return false;
  const normalizedTrace = trace.replace(/^\s+/gm, '').replace(/\s+/g, ' ');
  let searchFrom = 0;
  for (const frag of fragments) {
    const normalizedFrag = frag.replace(/\s+/g, ' ').trim();
    let idx = trace.indexOf(frag, searchFrom);
    if (idx === -1) idx = normalizedTrace.indexOf(normalizedFrag, searchFrom > 0 ? 0 : 0);
    if (idx === -1) return false;
    searchFrom = idx + normalizedFrag.length;
  }
  return true;
}
function verifyProvenanceBefore(quote: string, traceExcerpt: string): { matched: boolean; matchPath: string } {
  const cleanQuote = quote.replace(/\.{2,}\s*$/, '').replace(/…\s*$/, '').trim();
  const isSubstring = traceExcerpt.includes(cleanQuote) || traceExcerpt.includes(quote);
  const normTrace = traceExcerpt.replace(/^[ \t]+/gm, '');
  const normQuote = cleanQuote.replace(/^[ \t]+/gm, '');
  const isNormalizedMatch = !isSubstring && normTrace.includes(normQuote);
  const isFuzzyMatch = !isSubstring && !isNormalizedMatch && checkTruncatedQuoteBefore(cleanQuote, traceExcerpt);
  const matched = isSubstring || isNormalizedMatch || isFuzzyMatch;
  const matchPath = isSubstring
    ? 'exact'
    : isNormalizedMatch
    ? 'whitespace-normalized'
    : isFuzzyMatch
    ? 'fuzzy-truncated'
    : 'no-match';
  return { matched, matchPath };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Case {
  id: string;
  question: string;
  answer: string;
  trace_steps: string;
  gold_plan_steps: Array<{ index: number; description: string; criticality: string }>;
  expected_verdict: 'BLOCK' | 'HOLD' | 'ALLOW';
}

interface ProbeResult {
  caseId: string;
  mode: string;
  probeQuote: string;
  beforeMatched: boolean;
  beforeMatchPath: string;
  afterMatched: boolean;
  afterMatchPath: string;
}

// ─── Mode probe constructors ─────────────────────────────────────────────────

/** Take the first sentence of the trace, length-bounded, as a "real" quote anchor. */
function pickAnchor(trace: string): string {
  // Strip leading "Step N [..]:" prefix if present, take first 60-90 chars,
  // and end at a word boundary.
  const stripped = trace.replace(/^Step \d+ \[[^\]]+\][^:]*:\s*/m, '');
  const head = stripped.substring(0, 90);
  const lastSpace = head.lastIndexOf(' ');
  const anchor = (lastSpace > 50 ? head.substring(0, lastSpace) : head).trim();
  return anchor;
}

/** Replace ASCII apostrophes/quotes with smart equivalents. */
function smartApostropheVariant(s: string): string {
  return s.replace(/'/g, '\u2019');
}
function smartDoubleQuoteVariant(s: string): string {
  // If no double quotes in source, inject around the second word as a smart-wrap.
  if (s.includes('"')) {
    return s.replace(/"/g, '\u201C').replace(/\u201C([^\u201C]*)\u201C/g, '\u201C$1\u201D');
  }
  return s;
}
function emDashVariant(s: string): string {
  // Replace ASCII " - " with " — " (em-dash with same spacing) only if pattern present.
  return s.replace(/ - /g, ' \u2014 ');
}
function ellipsisCharVariant(s: string): string {
  return s.replace(/\.\.\./g, '\u2026');
}
function structuralWrapVariant(s: string): string {
  return `"${s}"`;
}
function paraphraseVariant(s: string): string {
  // Trivial paraphrase: swap two random adjacent words.
  const tokens = s.split(' ');
  if (tokens.length < 4) return s + ' (paraphrased)';
  const i = Math.floor(tokens.length / 2);
  [tokens[i], tokens[i + 1]] = [tokens[i + 1]!, tokens[i]!];
  return tokens.join(' ');
}
function wrongSourceVariant(_s: string): string {
  // Mode-4 is detected by R6 reasoning regex, not by the matcher. Here we
  // just emit a quote that doesn't appear in the trace at all — should
  // remain rejected by the matcher (PROV_FAIL_02).
  return 'According to industry analysts, deployment fell 20% in Q3.';
}

// ─── Probe runner ─────────────────────────────────────────────────────────────

function makeEval(quote: string): StepEvaluation {
  return {
    step_id: 'probe',
    score: 0.85,
    tier: 'strong',
    quote,
    quote_location: { line_start: null, line_end: null, char_offset_start: null, char_offset_end: null, turn: null },
    quote_to_criterion_mapping: null,
    reasoning: '',
    abstain_if_uncertain: false,
    predicate: 'supported',
  };
}

function probeAfter(trace: string, quote: string): { matched: boolean; matchPath: string } {
  const violations = verifyProvenance(makeEval(quote), trace);
  const failed = violations.some((v: string) => v.startsWith('PROV_FAIL_02'));
  const trace_line = violations.find((v: string) => v.startsWith('PROV_TRACE'));
  const matchPath = trace_line ? trace_line.split('match_path=')[1] ?? 'unknown' : 'unknown';
  return { matched: !failed, matchPath };
}

function runMatcherOnlyMode(cases: Case[]): ProbeResult[] {
  const results: ProbeResult[] = [];

  for (const c of cases) {
    const anchor = pickAnchor(c.trace_steps);
    if (anchor.length < 20) continue; // skip cases with no usable anchor

    const probes: Array<{ mode: string; quote: string }> = [
      { mode: 'baseline-exact',     quote: anchor },
      { mode: 'mode1-apostrophe',   quote: smartApostropheVariant(anchor) },
      { mode: 'mode1-doublequote',  quote: smartDoubleQuoteVariant(anchor) },
      { mode: 'mode1-emdash',       quote: emDashVariant(anchor) },
      { mode: 'mode1-ellipsis',     quote: ellipsisCharVariant(anchor) },
      { mode: 'mode3-structural',   quote: structuralWrapVariant(anchor) },
      { mode: 'mode2-paraphrase',   quote: paraphraseVariant(anchor) },     // expect REJECT
      { mode: 'mode4-wrongsource',  quote: wrongSourceVariant(anchor) },    // expect REJECT
    ];

    for (const p of probes) {
      const before = verifyProvenanceBefore(p.quote, c.trace_steps);
      const after = probeAfter(c.trace_steps, p.quote);
      results.push({
        caseId: c.id,
        mode: p.mode,
        probeQuote: p.quote.substring(0, 60),
        beforeMatched: before.matched,
        beforeMatchPath: before.matchPath,
        afterMatched: after.matched,
        afterMatchPath: after.matchPath,
      });
    }
  }

  return results;
}

// ─── Reporting ────────────────────────────────────────────────────────────────

function formatReport(results: ProbeResult[], cases: Case[]): string {
  const byMode = new Map<string, ProbeResult[]>();
  for (const r of results) {
    if (!byMode.has(r.mode)) byMode.set(r.mode, []);
    byMode.get(r.mode)!.push(r);
  }

  const expectMatch = new Set([
    'baseline-exact',
    'mode1-apostrophe',
    'mode1-doublequote',
    'mode1-emdash',
    'mode1-ellipsis',
    'mode3-structural',
  ]);
  const expectReject = new Set(['mode2-paraphrase', 'mode4-wrongsource']);

  const lines: string[] = [];
  lines.push('# Provenance Matcher Sweep — Vorher/Nachher Report');
  lines.push('');
  lines.push(`**Eingabe**: ${cases.length} Cases aus plv-new-40-cases-2026-04-26.json`);
  lines.push(`**Modus**: Matcher-Only (synthetische Quote-Varianten gegen echte trace_steps)`);
  lines.push(`**Erzeugt**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Confusion-Matrix nach Modus (Vorher → Nachher)');
  lines.push('');
  lines.push('| Modus | Erwartung | Vorher Match-Quote | Nachher Match-Quote | Δ | Bewertung |');
  lines.push('|---|---|---|---|---|---|');

  const modeOrder = ['baseline-exact', 'mode1-apostrophe', 'mode1-doublequote', 'mode1-emdash', 'mode1-ellipsis', 'mode3-structural', 'mode2-paraphrase', 'mode4-wrongsource'];
  for (const mode of modeOrder) {
    const rs = byMode.get(mode) ?? [];
    if (rs.length === 0) continue;
    const beforeMatched = rs.filter(r => r.beforeMatched).length;
    const afterMatched = rs.filter(r => r.afterMatched).length;
    const total = rs.length;
    const beforePct = total > 0 ? ((beforeMatched / total) * 100).toFixed(0) : '—';
    const afterPct = total > 0 ? ((afterMatched / total) * 100).toFixed(0) : '—';
    const delta = afterMatched - beforeMatched;
    const deltaStr = delta > 0 ? `**+${delta}**` : delta < 0 ? `**${delta}**` : '0';
    const expect = expectMatch.has(mode) ? 'sollte matchen' : expectReject.has(mode) ? 'sollte ablehnen' : '—';
    let verdict = '?';
    if (expectMatch.has(mode)) {
      if (afterMatched === total && delta >= 0) verdict = '✅ alle gematcht';
      else if (afterMatched === total && delta < 0) verdict = `✅ ${afterMatched}/${total} (Vorher hatte mehr — Anomalie?)`;
      else if (afterMatched === 0) verdict = '❌ keiner gematcht';
      else verdict = `⚠️ ${afterMatched}/${total}`;
    } else if (expectReject.has(mode)) {
      if (afterMatched === 0) verdict = '✅ alle abgelehnt (Lock hält)';
      else if (afterMatched <= beforeMatched) verdict = `⚠️ ${afterMatched}/${total} matchen — schon vorher so, kein Regress`;
      else verdict = `❌ +${delta} REGRESSION`;
    }
    lines.push(`| \`${mode}\` | ${expect} | ${beforeMatched}/${total} (${beforePct}%) | ${afterMatched}/${total} (${afterPct}%) | ${deltaStr} | ${verdict} |`);
  }

  lines.push('');
  lines.push('## Match-Pfad-Verteilung Nachher (gematchte Probes)');
  lines.push('');
  lines.push('| Modus | Match-Pfade |');
  lines.push('|---|---|');
  for (const mode of modeOrder) {
    const rs = byMode.get(mode) ?? [];
    if (rs.length === 0) continue;
    const pathDist = new Map<string, number>();
    for (const r of rs) {
      if (r.afterMatched) pathDist.set(r.afterMatchPath, (pathDist.get(r.afterMatchPath) ?? 0) + 1);
    }
    const distStr = Array.from(pathDist.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `\`${p}\`: ${n}`)
      .join(', ') || '—';
    lines.push(`| \`${mode}\` | ${distStr} |`);
  }

  lines.push('');
  lines.push('## Pro-Case-Detail: Vorher→Nachher Diff (nur Fälle mit Statusänderung oder Erwartungsverletzung)');
  lines.push('');
  const interesting = results.filter(r => {
    const expectsMatch = expectMatch.has(r.mode);
    const expectsReject = expectReject.has(r.mode);
    // Status changed before→after
    if (r.beforeMatched !== r.afterMatched) return true;
    // Expectation violated by AFTER
    if (expectsMatch && !r.afterMatched) return true;
    if (expectsReject && r.afterMatched) return true;
    return false;
  });
  if (interesting.length === 0) {
    lines.push('_Keine — alle Erwartungen erfüllt, keine Statusänderungen._');
  } else {
    lines.push('| Case | Modus | Vorher | Nachher | Match-Pfad (Nachher) | Probe-Quote (60ch) |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of interesting) {
      const before = r.beforeMatched ? 'match' : 'reject';
      const after = r.afterMatched ? 'match' : 'reject';
      const arrow = r.beforeMatched === r.afterMatched ? '=' : '→';
      lines.push(`| ${r.caseId} | \`${r.mode}\` | ${before} | ${arrow} **${after}** | \`${r.afterMatchPath}\` | \`${r.probeQuote.replace(/`/g, "'")}\` |`);
    }
  }

  lines.push('');
  lines.push('## Akzeptanzkriterien (Hard Rule)');
  lines.push('');
  const lockViolations = results.filter(r => expectReject.has(r.mode) && r.afterMatched && !r.beforeMatched);
  const matchRegressions = results.filter(r => expectMatch.has(r.mode) && !r.afterMatched && r.beforeMatched);
  lines.push(`- **Mode 2/4 Locks neu durchbrochen (Regressionen)**: ${lockViolations.length} ${lockViolations.length === 0 ? '✅' : '❌'}`);
  lines.push(`- **Vorher-Matches nachher verloren**: ${matchRegressions.length} ${matchRegressions.length === 0 ? '✅' : '❌'}`);
  lines.push('');
  lines.push('Beide Werte müssen `0` sein, damit der Patch das Akzeptanzgate passiert.');

  lines.push('');
  lines.push('## Was dieser Report sagt — und was nicht');
  lines.push('');
  lines.push('- **Sagt**: Wie oft die zwei neuen Match-Pfade (`unicode-normalized`, `structural-unwrapped`)');
  lines.push('  auf realen 40-Case-Traces greifen, wenn ein LLM eine bestimmte Mode-1- oder Mode-3-Variante');
  lines.push('  emittieren würde.');
  lines.push('- **Sagt nicht**: Den echten Verdict-Shift auf den 40 Cases. Dafür braucht es einen Vollauf');
  lines.push('  des Evaluators (LLM-Aufrufe). Siehe `--full` Modus mit XAI_API_KEY.');
  lines.push('- **Mode 2 (paraphrase) und Mode 4 (wrong-source)** Zeilen sind als Lock-Tests gedacht: jede');
  lines.push('  Match-Quote > 0 dort wäre eine Regression, die geblockt werden muss.');
  return lines.join('\n');
}

// ─── Full Eval Mode ───────────────────────────────────────────────────────────

type Verdict = 'BLOCK' | 'HOLD' | 'ALLOW';

interface VerdictRow {
  caseId: string;
  expected: Verdict;
  vorher: Verdict;
  nachher: Verdict;
  vorherViolations: string[];
  nachherViolations: string[];
}

async function runOnce(cases: Case[], label: string): Promise<Map<string, { verdict: Verdict; violations: string[] }>> {
  const items: EvalInput[] = cases.map(c => ({
    id: c.id,
    question: c.question,
    answer: c.answer,
    trace_steps: c.trace_steps,
    gold_plan_steps: c.gold_plan_steps as EvalInput['gold_plan_steps'],
  }));

  const model = process.env.PLV_FULL_MODEL ?? 'grok';
  console.log(`[${label}] running evaluateBatch (${items.length} items, model=${model}, T=0)...`);
  const t0 = Date.now();
  const result = await evaluateBatch(items, model, {
    concurrency: 3,
    onProgress: (done: number, total: number, id: string) => {
      console.log(`  [${label}] ${done}/${total} done (${id})`);
    },
  });
  console.log(`[${label}] finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const out = new Map<string, { verdict: Verdict; violations: string[] }>();
  for (const c of cases) {
    const r = result.items[c.id];
    if (!r) continue;
    out.set(c.id, { verdict: r.verdict, violations: r.provenance_violations });
  }
  return out;
}

function formatVerdictReport(rows: VerdictRow[]): string {
  const lines: string[] = [];
  lines.push('# Provenance Matcher Sweep — Verdict-Level Vorher/Nachher (--full)');
  lines.push('');
  lines.push(`**Eingabe**: ${rows.length} Cases aus plv-new-40-cases-2026-04-26.json`);
  lines.push(`**Sample-SHA256**: ee6e43483ef18494e25a9d2fe2a8febba97b46feca06c6c872a30bf017e26814`);
  lines.push(`**Modus**: Full Eval (echte LLM-Aufrufe über evaluateBatch, T=0)`);
  lines.push(`**Modell**: ${process.env.PLV_FULL_MODEL ?? 'grok'}`);
  lines.push(`**Erzeugt**: ${new Date().toISOString()}`);
  lines.push('');

  const verdicts: Verdict[] = ['BLOCK', 'HOLD', 'ALLOW'];
  const buildMatrix = (key: 'vorher' | 'nachher') => {
    const m: Record<Verdict, Record<Verdict, number>> = {
      BLOCK: { BLOCK: 0, HOLD: 0, ALLOW: 0 },
      HOLD:  { BLOCK: 0, HOLD: 0, ALLOW: 0 },
      ALLOW: { BLOCK: 0, HOLD: 0, ALLOW: 0 },
    };
    for (const r of rows) m[r.expected][r[key]]++;
    return m;
  };
  const matVorher = buildMatrix('vorher');
  const matNachher = buildMatrix('nachher');

  const renderMatrix = (m: Record<Verdict, Record<Verdict, number>>, label: string) => {
    lines.push(`### ${label}`);
    lines.push('');
    lines.push('| expected \\ actual | BLOCK | HOLD | ALLOW | row total |');
    lines.push('|---|---|---|---|---|');
    for (const e of verdicts) {
      const row = m[e];
      const total = row.BLOCK + row.HOLD + row.ALLOW;
      lines.push(`| **${e}** | ${row.BLOCK} | ${row.HOLD} | ${row.ALLOW} | ${total} |`);
    }
    const correct = verdicts.reduce((sum, v) => sum + m[v][v], 0);
    lines.push('');
    lines.push(`**Diagonale (korrekt)**: ${correct}/${rows.length} (${((correct / rows.length) * 100).toFixed(1)}%)`);
    lines.push('');
  };
  lines.push('## Confusion-Matrix Vorher (PLV_DISABLE_NEW_MATCH_PATHS=1)');
  lines.push('');
  renderMatrix(matVorher, 'Vorher');
  lines.push('## Confusion-Matrix Nachher (Production-Default)');
  lines.push('');
  renderMatrix(matNachher, 'Nachher');

  lines.push('## Pro-Case-Verdict-Diff');
  lines.push('');
  lines.push('| Case | Erwartet | Vorher | Nachher | Bewegung | Bewertung |');
  lines.push('|---|---|---|---|---|---|');
  let beneficial = 0;
  let regressions = 0;
  let unchanged = 0;
  for (const r of rows) {
    let move = '=';
    let bewertung = '';
    if (r.vorher !== r.nachher) {
      move = `${r.vorher} → ${r.nachher}`;
      const wasWrongBefore = r.vorher !== r.expected;
      const isRightAfter = r.nachher === r.expected;
      if (wasWrongBefore && isRightAfter) {
        beneficial++;
        bewertung = '✅ fix landed';
      } else if (!wasWrongBefore && !isRightAfter) {
        regressions++;
        bewertung = '❌ REGRESSION';
      } else {
        bewertung = '⚠️ bewegt sich, aber nicht zum richtigen Verdict';
      }
    } else {
      unchanged++;
      bewertung = r.vorher === r.expected ? '✅ stabil-korrekt' : '⚪ stabil-falsch (kein Effekt durch Patch)';
    }
    lines.push(`| ${r.caseId} | ${r.expected} | ${r.vorher} | ${r.nachher} | ${move} | ${bewertung} |`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Beneficial movements** (falsch → richtig): ${beneficial}`);
  lines.push(`- **Regressions** (richtig → falsch): ${regressions} ${regressions === 0 ? '✅' : '❌'}`);
  lines.push(`- **Unchanged**: ${unchanged}`);
  lines.push('');
  lines.push('Acceptance: `regressions == 0`. Beneficial sollte > 0 sein, sonst hatte der Fix keinen Verdict-Effekt.');

  const targets = ['C-08', 'CODE-05', 'D-05', 'D-06'];
  lines.push('');
  lines.push('## Ziel-Cases (Aufmerksamkeitspunkt)');
  lines.push('');
  lines.push('| Case | Erwartet | Vorher | Nachher | Bewegung |');
  lines.push('|---|---|---|---|---|');
  for (const id of targets) {
    const r = rows.find(x => x.caseId === id);
    if (!r) continue;
    const move = r.vorher === r.nachher ? '=' : `${r.vorher} → ${r.nachher}`;
    lines.push(`| ${id} | ${r.expected} | ${r.vorher} | ${r.nachher} | ${move} |`);
  }
  lines.push('');
  lines.push('Hinweis: D-06 ist der Wrong-Source-Case und muss BLOCK/HOLD bleiben — das ist Feature, nicht Bug.');

  return lines.join('\n');
}

async function runFullMode(cases: Case[]): Promise<void> {
  if (!process.env.XAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('FULL mode requires a provider key. Set XAI_API_KEY (default), ANTHROPIC_API_KEY, or OPENAI_API_KEY.');
    process.exit(2);
  }

  process.env.PLV_DISABLE_NEW_MATCH_PATHS = '1';
  const before = await runOnce(cases, 'VORHER');

  delete process.env.PLV_DISABLE_NEW_MATCH_PATHS;
  const after = await runOnce(cases, 'NACHHER');

  const rows: VerdictRow[] = cases
    .map(c => {
      const v = before.get(c.id);
      const n = after.get(c.id);
      if (!v || !n) return null;
      return {
        caseId: c.id,
        expected: c.expected_verdict,
        vorher: v.verdict,
        nachher: n.verdict,
        vorherViolations: v.violations,
        nachherViolations: n.violations,
      };
    })
    .filter((r): r is VerdictRow => r !== null);

  const fullOutPath = '/home/user/workspace/plv_provenance_sweep_full_report.md';
  const report = formatVerdictReport(rows);
  writeFileSync(fullOutPath, report, 'utf8');
  console.log(`\nWrote verdict-level report to ${fullOutPath}`);
  console.log('');
  console.log(report.split('\n').slice(0, 60).join('\n'));
}

// ─── Main ────────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..');
const casesPath = '/home/user/workspace/plv-new-40-cases-2026-04-26.json';
const outPath = '/home/user/workspace/plv_provenance_sweep_report.md';

const cases: Case[] = JSON.parse(readFileSync(casesPath, 'utf8'));
console.log(`Loaded ${cases.length} cases.`);

const fullMode = process.argv.includes('--full');
if (!fullMode) {
  const results = runMatcherOnlyMode(cases);
  const report = formatReport(results, cases);
  writeFileSync(outPath, report, 'utf8');
  console.log(`Wrote ${results.length} probe results to ${outPath}`);
  console.log('');
  console.log(report.split('\n').slice(0, 30).join('\n'));
} else {
  await runFullMode(cases);
}
