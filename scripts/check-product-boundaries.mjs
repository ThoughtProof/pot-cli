#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['cases', 'runs', 'experiments', 'docs', 'src'];
const failures = [];
const skippedDirs = new Set(['node_modules', 'dist', '.git', 'tmp']);

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (skippedDirs.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walk(path);
    } else if (/\.(json|md|mjs|ts)$/.test(path)) {
      check(path);
    }
  }
}

function check(path) {
  const text = readFileSync(path, 'utf8');

  if (path.includes('serv-pot-rv') && /PLV Benchmark/i.test(text)) {
    failures.push(`${path}: SERV PoT/RV artifact must not be labeled PLV Benchmark`);
  }

  if (/cases\/plv/i.test(path) && /"claim"\s*:/.test(text) && /"rationale"\s*:/.test(text) && !/"plan_steps"\s*:/.test(text)) {
    failures.push(`${path}: PLV case file appears to contain RV claim/rationale/evidence records`);
  }

  if (/cases\/rv/i.test(path) && /"plan_steps"\s*:|"trace_steps"\s*:/.test(text)) {
    failures.push(`${path}: RV case file appears to contain PLV plan/trace fields`);
  }

  if (/docs\/.*serv/i.test(path) && /public SERV benchmark|SERV replacing Sonnet|SERV production verifier/i.test(text)) {
    failures.push(`${path}: SERV wording looks public/production-oriented; keep SERV beta framing private and scoped`);
  }
}

for (const root of roots) {
  walk(root);
}

if (failures.length) {
  console.error('Product boundary check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Product boundary checks passed');
