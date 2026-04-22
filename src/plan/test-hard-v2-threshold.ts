import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { planSweepFirstPartyCommand } from '../commands/plan-sweep-first-party.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./__fixtures__/hard-v2-threshold/${name}`, import.meta.url));
}

test('hard-v2 threshold regression holds across coarse, medium, fine, and fine+source-claim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pot-cli-hard-v2-threshold-'));
  const profilesFile = join(dir, 'profiles.json');
  const outFile = join(dir, 'sweep.json');

  writeFileSync(profilesFile, JSON.stringify({
    coarse: { goldMap: fixturePath('coarse-gold.json') },
    medium: { goldMap: fixturePath('medium-gold.json') },
    fine: {
      goldMap: fixturePath('fine-gold.json'),
      deriveSourceClaim: true,
    },
  }, null, 2));

  await planSweepFirstPartyCommand(fixturePath('traces.jsonl'), {
    profiles: profilesFile,
    out: outFile,
    minimumScore: '0.25',
    mode: 'semantic',
  });

  const payload = JSON.parse(readFileSync(outFile, 'utf8'));

  assert.deepEqual(payload.profiles.coarse.baseline.verdictCounts, {
    ALLOW: 3,
    CONDITIONAL_ALLOW: 0,
    HOLD: 0,
    BLOCK: 0,
  });

  assert.deepEqual(payload.profiles.medium.baseline.verdictCounts, {
    ALLOW: 3,
    CONDITIONAL_ALLOW: 0,
    HOLD: 0,
    BLOCK: 0,
  });

  assert.deepEqual(payload.profiles.fine.baseline.verdictCounts, {
    ALLOW: 1,
    CONDITIONAL_ALLOW: 0,
    HOLD: 2,
    BLOCK: 0,
  });

  assert.deepEqual(payload.profiles.fine.withSourceClaim.verdictCounts, {
    ALLOW: 1,
    CONDITIONAL_ALLOW: 2,
    HOLD: 0,
    BLOCK: 0,
  });

  assert.deepEqual(payload.summary.fine.verdictTransitions, {
    'ALLOW->ALLOW': 1,
    'HOLD->CONDITIONAL_ALLOW': 2,
  });
  assert.deepEqual(payload.summary.fine.sourceClaimSupportCounts, { exact: 3 });
  assert.deepEqual(payload.summary.fine.sourceClaimConfidenceCounts, { high: 3 });
});
