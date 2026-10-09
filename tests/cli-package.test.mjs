import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const workspace = mkdtempSync(join(tmpdir(), 'pot-cli-package-'));
const consumer = join(workspace, 'consumer');
const cli = join(consumer, 'node_modules', 'pot-cli', 'dist', 'index.js');

before(async () => {
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"private":true}\n');
  // npm ci in this repository keeps the development lockfile. A consumer
  // installs only the packed package and resolves its declared dependencies.
  const packed = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', workspace], {
    cwd: root,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const [{ filename }] = JSON.parse(packed.stdout);
  await run('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false', join(workspace, filename)], {
    cwd: consumer,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const provider = (model) => ({ name: model, model, apiKey: 'unused-dry-run', baseUrl: 'http://127.0.0.1:1' });
  writeFileSync(join(consumer, '.potrc.json'), JSON.stringify({
    generators: [provider('mock-author')],
    critic: provider('mock-critic'),
    synthesizer: provider('mock-synthesizer'),
    blockStoragePath: './blocks',
    language: 'en',
  }));
});

after(() => rmSync(workspace, { recursive: true, force: true }));

test('freshly installed CLI reports the packed package version', async () => {
  const { stdout } = await run(process.execPath, [cli, '--version'], { cwd: consumer });
  assert.equal(stdout.trim(), version);
});

test('freshly installed CLI runs ask --dry-run without API credentials', async () => {
  const { stdout } = await run(process.execPath, [cli, 'ask', 'Test question', '--dry-run'], {
    cwd: consumer,
    timeout: 30_000,
  });
  assert.match(stdout, /\[DRY-RUN\] Simulated synthesis/);
  assert.match(stdout, /Saved as PoT-001/);
});
