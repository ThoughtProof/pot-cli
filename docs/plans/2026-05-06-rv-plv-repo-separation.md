# RV/PLV Repository Separation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Separate classic PoT/RV (claim/rationale/evidence verification) from PLV (plan/trace verification) in code, docs, exports, and experiments without breaking current `pot-cli/plan` consumers.

**Architecture:** Keep current PLV implementation stable under `src/plan/*` for now, add explicit boundary docs and new RV module/types first, then introduce explicit `pot-cli/rv` and `pot-cli/plv` exports. Preserve backwards-compatible `pot-cli/plan` until dependent repos migrate.

**Tech Stack:** TypeScript, Node ESM, pot-cli package exports, Node test runner, Markdown docs.

---

## Current facts verified 2026-05-06

- Package name: `pot-cli`.
- README foregrounds original Proof-of-Thought adversarial pipeline and also plan-level workflow.
- Active PLV code is under `src/plan/*` and `src/commands/plan-*`.
- API v2 imports `pot-cli/plan`, `pot-cli/cascade`, `pot-cli/verdict` for PLV.
- SERV PoT/RV smoke tests are local-private artifacts under ignored `experiments/serv-private/rv/` (moved out of visible `runs/serv-pot-rv-*`).
- Product boundary doc added: `docs/product-boundary-rv-vs-plv.md`.

## Non-goals

- Do not rename the npm package now.
- Do not break `pot-cli/plan` imports.
- Do not move production PLV engine in the first pass.
- Do not publish SERV results as PLV benchmarks.
- Do not run more SERV evaluation until `src/rv/types.ts` and an RV gold policy exist.

---

### Task 1: Add explicit RV type definitions

**Objective:** Create a dedicated RV schema so new code cannot confuse claim/rationale/evidence with plan/trace inputs.

**Files:**
- Create: `src/rv/types.ts`
- Create: `src/rv/index.ts`
- Test: `src/rv/test-types.ts` or compile-only via `npm run build`

**Step 1: Create `src/rv/types.ts`**

```ts
export type PublicVerdict = 'ALLOW' | 'UNCERTAIN' | 'BLOCK';

export interface ReasoningVerificationInput {
  id?: string;
  claim: string;
  rationale: string;
  evidence: string;
  context?: string;
  domain?: string;
}

export interface ReasoningCriticJudgment {
  model: string;
  verdict: PublicVerdict;
  confidence: number;
  rationale: string;
  risk_flags: string[];
  evidence_gaps: string[];
}

export interface ReasoningVerificationResult {
  id: string;
  verdict: PublicVerdict;
  confidence: number;
  rationale: string;
  dissent: string[];
  risk_flags: string[];
  evidence_gaps: string[];
  critics?: ReasoningCriticJudgment[];
}
```

**Step 2: Create `src/rv/index.ts`**

```ts
export * from './types.js';
```

**Step 3: Build**

Run: `npm run build`

Expected: TypeScript compile passes.

**Step 4: Commit**

```bash
git add src/rv/types.ts src/rv/index.ts src/rv/__tests__/types.test.ts
git commit -m "feat(rv): add reasoning verification types"
```

**Steelman note:** compile/type tests must live under `src/rv/__tests__/` or another excluded path. Do not leave test-only files directly under `src/rv/`, because they compile into `dist/rv/*` and get packed by npm.

---

### Task 2: Add an RV gold policy document

**Objective:** Define ALLOW/UNCERTAIN/BLOCK semantics for PoT/RV before further SERV tests.

**Files:**
- Create: `docs/rv-gold-policy.md`

**Content requirements:**

- Input object: `claim + rationale + evidence/context`.
- `ALLOW`: claim is adequately supported and scoped.
- `UNCERTAIN`: missing evidence/controls prevent defensible ALLOW.
- `BLOCK`: contradiction, critical risk dismissal, or major overclaim.
- Explicit caveat rule: caveats already included in the claim should not automatically downgrade to UNCERTAIN.
- Immediate high-impact action rule: missing critical execution controls may be BLOCK, not merely UNCERTAIN.
- Examples from `runs/serv-pot-rv-smoke-8cases.json`.

**Verification:**

Run: `grep -n "claim + rationale + evidence\|critical risk dismissal\|high-impact action" docs/rv-gold-policy.md`

Expected: all terms found.

**Commit:**

```bash
git add docs/rv-gold-policy.md
git commit -m "docs(rv): define gold verdict policy"
```

---

### Task 3: Keep SERV PoT/RV experiments local-private

**Objective:** Keep SERV beta artifacts out of git/npm while preserving local reproducibility.

**Files:**
- Local ignored directory: `experiments/serv-private/rv/`
- Already moved local-private artifacts:
  - `experiments/serv-private/rv/serv-pot-rv-runner.mjs`
  - `experiments/serv-private/rv/serv-pot-rv-synth-matrix.mjs`
  - `experiments/serv-private/rv/serv-pot-rv-smoke-8cases.json`
  - local result and feedback files under the same ignored directory
- Guardrails:
  - `.gitignore` ignores `experiments/serv-private/`, `experiments/rv/serv/private/`, `experiments/plv/serv/private/`, and `runs/serv-*`.
  - `.npmignore` excludes the same private experiment directories.

Policy: `runs/` may keep non-SERV benchmark artifacts, but SERV/OpenServ beta runners, inputs, model outputs, screenshots, and metrics must stay in ignored local-private paths unless explicitly sanitized and approved for publication. Avoid duplicate runnable SERV copies under public paths.

**Verification:**

Run:

```bash
git check-ignore -v experiments/serv-private/rv/serv-pot-rv-runner.mjs
npm pack --dry-run --json | python3 -c 'import json,sys; files=[f["path"] for f in json.load(sys.stdin)[0]["files"]]; assert not any("serv-pot-rv" in f or "serv-private" in f for f in files)'
```

Expected: private SERV artifacts are ignored by git and absent from npm package.

**Commit:**

```bash
git add .gitignore .npmignore docs/product-boundary-rv-vs-plv.md docs/plans/2026-05-06-rv-plv-repo-separation.md
# Do not git add experiments/serv-private or runs/serv-*.
git commit -m "chore(serv): keep beta artifacts private"
```

---

### Task 4: Add explicit package exports for RV and PLV

**Objective:** Make product imports explicit while preserving old imports.

**Files:**
- Modify: `package.json`

**Change:**

Add exports:

```json
"./rv": {
  "types": "./dist/rv/index.d.ts",
  "default": "./dist/rv/index.js"
},
"./plv": {
  "types": "./dist/plan/graded-support-evaluator.d.ts",
  "default": "./dist/plan/graded-support-evaluator.js"
}
```

Keep existing `./plan` unchanged for compatibility.

**Verification:**

Run:

```bash
npm run build
node -e "import('pot-cli/rv').catch(e=>{console.error(e.message); process.exit(1)})"
```

If local package self-import fails before install, use a tiny temp package or inspect `dist/rv/index.js` and package exports manually.

**Commit:**

```bash
git add package.json
# Only add package-lock.json if npm install actually changed it.
git diff --quiet -- package-lock.json || git add package-lock.json
npm run build
git commit -m "feat(exports): add explicit rv and plv entrypoints"
```

---

### Task 5: Update docs and README references

**Objective:** Ensure top-level docs no longer imply PLV and PoT/RV are the same product.

**Files:**
- Modify: `README.md`
- Modify: `docs/plan-level-cli-workflow.md`
- Modify: `docs/tier-selection.md`

**Required wording:**

- README links `docs/product-boundary-rv-vs-plv.md`.
- Plan-level docs state they are PLV, not classic PoT/RV.
- Tier-selection doc states it applies to PLV tiers unless/until RV pricing exists.

**Verification:**

Run:

```bash
grep -n "Product Boundary\|PoT/RV\|PLV" README.md docs/plan-level-cli-workflow.md docs/tier-selection.md
```

**Commit:**

```bash
git add README.md docs/plan-level-cli-workflow.md docs/tier-selection.md docs/product-boundary-rv-vs-plv.md
git commit -m "docs: clarify rv and plv product boundary"
```

---

### Task 6: Add a no-mixing guard test for fixtures

**Objective:** Prevent future SERV PoT/RV artifacts from being filed or named as PLV.

**Files:**
- Create: `scripts/check-product-boundaries.mjs`
- Add npm script: `check:boundaries`

**Behavior:**

- Fail if a file path contains `serv-pot-rv` and content/header contains `PLV Benchmark`.
- Fail if a file path under `cases/plv*` contains claim/rationale/evidence-only RV records without `plan_steps`.
- Fail if a file path under `cases/rv*` contains PLV-only fields such as `plan_steps` or `trace_steps`.

**Implementation sketch:**

```js
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['cases', 'runs', 'experiments', 'docs'];
const failures = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (/\.(json|md|mjs|ts)$/.test(path)) check(path);
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
}

for (const root of roots) {
  try { walk(root); } catch {}
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Product boundary checks passed');
```

**Verification:**

Run:

```bash
node scripts/check-product-boundaries.mjs
```

Expected: passes on current tree after artifacts are properly labeled/moved.

**Commit:**

```bash
git add scripts/check-product-boundaries.mjs package.json
git commit -m "test: add rv plv boundary check"
```

---

### Task 7: Update API v2 imports only after pot-cli publishes explicit PLV export

**Objective:** Make API v2 import PLV by name instead of ambiguous `pot-cli/plan` once the new export exists.

**Files:**
- Modify in API repo: `/Users/rauljager/PROJECTS/ThoughtProof/thoughtproof-api-v2/src/engine.ts`

**Change:**

Replace:

```ts
import { evaluateItem, type EvalInput, ... } from 'pot-cli/plan';
```

with:

```ts
import { evaluateItem, type EvalInput, ... } from 'pot-cli/plv';
```

Keep `pot-cli/cascade` and `pot-cli/verdict` unless/until those also get explicit PLV/core aliases.

**Verification:**

In API v2 repo:

```bash
npm install pot-cli@<new-version>
npm test
npm run typecheck
```

**Commit:**

```bash
git add src/engine.ts package.json package-lock.json
git commit -m "chore: import explicit pot-cli plv entrypoint"
```
