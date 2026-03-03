import chalk from 'chalk';
import ora from 'ora';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  buildSecurityAuditCriticMessages,
  parseAuditCriticResponse,
  type AuditCriticResult,
} from '../prompts/security-audit-critic.js';
import { callModel } from '../utils/model-router.js';

// ─── Pattern Definitions ──────────────────────────────────────────────────────

interface DangerPattern {
  pattern: RegExp;
  cwe: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  lang: 'python' | 'javascript';
  label: string;
}

const DANGER_PATTERNS: DangerPattern[] = [
  // Python
  { pattern: /\bexec\s*\(/, cwe: 'CWE-94', severity: 'critical', lang: 'python', label: 'exec() — dynamic code execution' },
  { pattern: /\beval\s*\(/, cwe: 'CWE-94', severity: 'critical', lang: 'python', label: 'eval() — dynamic code execution' },
  { pattern: /subprocess\.(Popen|run|call|check_output)\s*\(/, cwe: 'CWE-78', severity: 'critical', lang: 'python', label: 'subprocess — shell execution' },
  { pattern: /os\.(system|popen|exec[lv]?p?e?)\s*\(/, cwe: 'CWE-78', severity: 'critical', lang: 'python', label: 'os.system/popen — shell execution' },
  { pattern: /importlib\.(import_module|util\.module_from_spec)/, cwe: 'CWE-829', severity: 'high', lang: 'python', label: 'importlib — dynamic module loading' },
  { pattern: /exec_module\s*\(/, cwe: 'CWE-829', severity: 'high', lang: 'python', label: 'exec_module — dynamic module execution' },
  { pattern: /pickle\.loads?\s*\(/, cwe: 'CWE-502', severity: 'critical', lang: 'python', label: 'pickle — unsafe deserialization' },
  { pattern: /yaml\.load\s*\((?!.*Loader)/, cwe: 'CWE-502', severity: 'high', lang: 'python', label: 'yaml.load without SafeLoader' },
  // JavaScript / TypeScript
  { pattern: /child_process\.(exec|spawn|execFile|fork)\s*\(/, cwe: 'CWE-78', severity: 'critical', lang: 'javascript', label: 'child_process — shell execution' },
  { pattern: /new Function\s*\(/, cwe: 'CWE-94', severity: 'critical', lang: 'javascript', label: 'new Function() — dynamic code generation' },
  { pattern: /vm\.runIn(New|This)Context\s*\(/, cwe: 'CWE-94', severity: 'high', lang: 'javascript', label: 'vm.runInContext — sandboxed eval (escapable)' },
];

const BYPASS_PATTERNS = [
  /BYPASS/i,
  /NON_INTERACTIVE/i,
  /DISABLE_SAFETY/i,
  /SKIP_CONFIRM/i,
  /AUTO_APPROVE/i,
  /TRUST_REMOTE/i,
  /UNSAFE/i,
];

const SANDBOX_KEYWORDS = [
  /\bsandbox\b/i, /\bcontainer\b/i, /\bjail\b/i, /\bseccomp\b/i,
  /\bchroot\b/i, /\bAppArmor\b/i, /\bSELinux\b/i, /\bWASM\b/i,
  /\bQuickJS\b/i, /\bisolated_process\b/i, /\bsecure_sandbox\b/i,
  /\bsandboxed\b/i, /\bvm\.runIn\b/,
];

const GUARD_KEYWORDS = [
  /\binput\s*\(/, /\bconfirm\s*\(/, /\bprompt\s*\(/, /\bapprove\s*\(/,
  /\bgetpass\s*\(/, /\bconsent\b/i, /\bask_user\b/i, /\bconfirmation\b/i,
];

// ─── Types ────────────────────────────────────────────────────────────────────

type GuardStatus = 'unguarded' | 'guarded' | 'guarded-but-bypassable';

interface Finding {
  file: string;
  line: number;
  code: string;
  pattern: DangerPattern;
  guardStatus: GuardStatus;
  bypassLine?: number;
  bypassSnippet?: string;
  hasSandbox: boolean;
  cvss: number;
  permalink?: string;
  criticVerdict?: AuditCriticResult;
}

interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  repoName: string;
  commitSha?: string;
  githubOwnerRepo?: string;
  durationMs: number;
}

// ─── Directories to ignore ────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__',
  'dist', 'build', '.tox', '.mypy_cache', '.pytest_cache',
  '.ruff_cache', 'site-packages', 'env',
  'tests', 'test', 'tests_integ', '__tests__', 'spec',
]);

// ─── File Collection ──────────────────────────────────────────────────────────

function gatherFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 10 || out.length >= 500) return out;

  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }

  for (const name of entries) {
    if (out.length >= 500) break;
    const full = path.join(dir, name);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(full); } catch { continue; }

    if (st.isDirectory()) {
      if (!IGNORE_DIRS.has(name)) gatherFiles(full, out, depth + 1);
    } else if (st.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (['.py', '.ts', '.js'].includes(ext) && st.size <= 1_048_576) {
        out.push(full);
      }
    }
  }
  return out;
}

// ─── Analysis Helpers ─────────────────────────────────────────────────────────

function detectLang(filePath: string): 'python' | 'javascript' {
  return filePath.endsWith('.py') ? 'python' : 'javascript';
}

function estimateCvss(status: GuardStatus, hasSandbox: boolean): number {
  if (hasSandbox) return 3.0;
  if (status === 'unguarded') return 9.1;
  if (status === 'guarded-but-bypassable') return 8.4;
  return 5.5; // guarded
}

function analyzeContext(
  lines: string[],
  hitLine: number, // 0-indexed
): {
  guardStatus: GuardStatus;
  bypassLine?: number;
  bypassSnippet?: string;
  hasSandbox: boolean;
} {
  // ±20 lines for sandbox + guard detection
  const start = Math.max(0, hitLine - 20);
  const end = Math.min(lines.length, hitLine + 21);
  const contextLines = lines.slice(start, end);
  const contextText = contextLines.join('\n');

  const hasSandbox = SANDBOX_KEYWORDS.some(r => r.test(contextText));
  const hasGuard   = GUARD_KEYWORDS.some(r => r.test(contextText));

  // Bypass detection: search FULL FILE (env vars are often defined far from exec())
  let bypassLine: number | undefined;
  let bypassSnippet: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    if (BYPASS_PATTERNS.some(r => r.test(lines[i]))) {
      bypassLine    = i + 1; // 1-indexed absolute
      bypassSnippet = lines[i].trim().slice(0, 120);
      break;
    }
  }

  let guardStatus: GuardStatus;
  if (bypassLine !== undefined) {
    // A bypass implies a guard exists somewhere in the file
    guardStatus = 'guarded-but-bypassable';
  } else if (hasGuard) {
    guardStatus = 'guarded';
  } else {
    guardStatus = 'unguarded';
  }

  return { guardStatus, bypassLine, bypassSnippet, hasSandbox };
}

function buildPermalink(
  githubOwnerRepo: string | undefined,
  commitSha: string | undefined,
  relPath: string,
  line: number,
): string | undefined {
  if (!githubOwnerRepo || !commitSha) return undefined;
  return `https://github.com/${githubOwnerRepo}/blob/${commitSha}/${relPath}#L${line}`;
}

function scanFile(
  filePath: string,
  repoRoot: string,
  githubOwnerRepo: string | undefined,
  commitSha: string | undefined,
): Finding[] {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf8'); } catch { return []; }

  const lines = raw.split('\n');
  const lang  = detectLang(filePath);
  const found: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const dp of DANGER_PATTERNS) {
      if (dp.lang !== lang) continue;
      if (!dp.pattern.test(line)) continue;

      const analysis  = analyzeContext(lines, i);
      const cvss      = estimateCvss(analysis.guardStatus, analysis.hasSandbox);
      const relPath   = path.relative(repoRoot, filePath).replace(/\\/g, '/');
      const permalink = buildPermalink(githubOwnerRepo, commitSha, relPath, i + 1);

      found.push({
        file: relPath,
        line: i + 1,
        code: line.trim().slice(0, 200),
        pattern: dp,
        guardStatus: analysis.guardStatus,
        bypassLine: analysis.bypassLine,
        bypassSnippet: analysis.bypassSnippet,
        hasSandbox: analysis.hasSandbox,
        cvss,
        permalink,
      });
    }
  }
  return found;
}

// ─── GitHub URL Parsing ───────────────────────────────────────────────────────

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function cloneRepo(url: string): { dir: string; sha: string } {
  const tmpDir = path.join(os.tmpdir(), `pot-security-audit-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  execSync(`git clone --depth 1 --quiet "${url}" "${tmpDir}"`, {
    timeout: 30_000,
    stdio: 'pipe',
  });

  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse HEAD', { cwd: tmpDir, timeout: 5_000, stdio: 'pipe' })
      .toString().trim().slice(0, 8);
  } catch { /* git rev-parse failed — repo without HEAD? */ }

  return { dir: tmpDir, sha };
}

// ─── Console Report ───────────────────────────────────────────────────────────

function severityLabel(s: DangerPattern['severity']): string {
  switch (s) {
    case 'critical': return chalk.red.bold('[CRITICAL]');
    case 'high':     return chalk.yellow.bold('[HIGH]');
    case 'medium':   return chalk.cyan('[MEDIUM]');
    case 'low':      return chalk.dim('[LOW]');
  }
}

function cvssLabel(cvss: number): string {
  const tag = `CVSS ~${cvss}`;
  if (cvss >= 9.0) return chalk.red(tag);
  if (cvss >= 7.0) return chalk.yellow(tag);
  if (cvss >= 4.0) return chalk.cyan(tag);
  return chalk.dim(tag);
}

function guardLabel(s: GuardStatus): string {
  switch (s) {
    case 'unguarded':              return chalk.red(s);
    case 'guarded':                return chalk.green(s);
    case 'guarded-but-bypassable': return chalk.yellow(s);
  }
}

function steelManNote(f: Finding): string {
  if (f.guardStatus === 'guarded-but-bypassable')
    return 'User explicitly configures the tool and sets the bypass env var.';
  if (f.guardStatus === 'guarded')
    return 'Requires explicit user approval before execution.';
  return 'No mitigating design pattern found in ±20 lines of context.';
}

function printConsoleReport(result: ScanResult): void {
  const { findings, filesScanned, repoName, commitSha, durationMs } = result;
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach(f => counts[f.pattern.severity]++);

  console.log(chalk.bold(`\n🔍 Security Audit: ${repoName}${commitSha ? ` (commit ${commitSha})` : ''}\n`));
  console.log(
    `Found ${chalk.bold(String(findings.length))} finding${findings.length !== 1 ? 's' : ''} ` +
    `in ${chalk.bold(String(filesScanned))} files scanned:\n`
  );

  if (findings.length === 0) {
    console.log(chalk.green('✅ No dangerous patterns detected.\n'));
    return;
  }

  for (const f of findings) {
    console.log(`${severityLabel(f.pattern.severity)} ${chalk.bold(`${f.file}:${f.line}`)}`);
    console.log(`  ${chalk.dim(f.code)}`);
    console.log(`  ${chalk.dim(f.pattern.cwe)} | ${cvssLabel(f.cvss)} | Status: ${guardLabel(f.guardStatus)}`);
    console.log(`  Pattern: ${f.pattern.label}`);

    if (f.bypassLine !== undefined) {
      console.log(chalk.yellow(`  Bypass: line ${f.bypassLine} — ${f.bypassSnippet ?? ''}`));
    }
    if (f.hasSandbox) {
      console.log(chalk.green('  Sandbox keywords found in ±20 lines'));
    } else {
      console.log(chalk.dim('  Context: No sandbox keywords in ±20 lines'));
    }
    console.log(chalk.dim(`  Steel-man: ${steelManNote(f)}`));

    if (f.permalink) {
      console.log(chalk.blue(`  🔗 ${f.permalink}`));
    }
    if (f.criticVerdict) {
      const cv = f.criticVerdict;
      const icon = cv.verdict === 'false_positive' ? chalk.yellow('⚠️  FP') : chalk.red('✅ VULN');
      console.log(`  Critic: ${icon} (${(cv.confidence * 100).toFixed(0)}%) — ${cv.reasoning.slice(0, 120)}`);
    }
    console.log('');
  }

  const secs = (durationMs / 1000).toFixed(1);
  console.log(
    chalk.bold('Summary: ') +
    chalk.red(`${counts.critical} Critical`) + ', ' +
    chalk.yellow(`${counts.high} High`) + ', ' +
    chalk.cyan(`${counts.medium} Medium`) + ', ' +
    chalk.dim(`${counts.low} Low`) +
    chalk.dim(` | ${filesScanned} files scanned | ${secs}s`)
  );
}

// ─── Markdown Report ──────────────────────────────────────────────────────────

function buildMarkdownReport(result: ScanResult): string {
  const { findings, filesScanned, repoName, commitSha, durationMs } = result;
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach(f => counts[f.pattern.severity]++);
  const secs = (durationMs / 1000).toFixed(1);

  const lines: string[] = [
    `# 🔍 Security Audit: ${repoName}${commitSha ? ` (commit \`${commitSha}\`)` : ''}`,
    '',
    `Found **${findings.length} finding${findings.length !== 1 ? 's' : ''}** in **${filesScanned} files** scanned:`,
    '',
  ];

  if (findings.length === 0) {
    lines.push('✅ No dangerous patterns detected.');
  }

  for (const f of findings) {
    lines.push('---', '');
    lines.push(`## [${f.pattern.severity.toUpperCase()}] \`${f.file}:${f.line}\``, '');
    lines.push('```');
    lines.push(f.code);
    lines.push('```', '');
    lines.push(`- **CWE:** ${f.pattern.cwe}`);
    lines.push(`- **CVSS:** ~${f.cvss}`);
    lines.push(`- **Status:** ${f.guardStatus}`);
    lines.push(`- **Pattern:** ${f.pattern.label}`);
    if (f.bypassLine !== undefined) {
      lines.push(`- **Bypass:** line ${f.bypassLine} — \`${f.bypassSnippet ?? ''}\``);
    }
    lines.push(f.hasSandbox
      ? '- **Sandbox:** Sandbox keywords found in ±20 lines'
      : '- **Context:** No sandbox keywords in ±20 lines'
    );
    lines.push(`- **Steel-man:** ${steelManNote(f)}`);
    if (f.permalink) {
      lines.push(`- **GitHub:** [${f.file}#L${f.line}](${f.permalink})`);
    }
    lines.push('');
  }

  lines.push(
    '---', '',
    '## Summary', '',
    `**${counts.critical} Critical, ${counts.high} High, ${counts.medium} Medium, ${counts.low} Low** | ` +
    `${filesScanned} files scanned | ${secs}s`,
    '',
    `_Generated by pot-cli security-audit — [ThoughtProof](https://thoughtproof.ai)_`,
  );

  return lines.join('\n');
}

// ─── TP-VC Attestation ────────────────────────────────────────────────────────

interface TpVcAttestation {
  '@context': string;
  type: string;
  id: string;
  issuedAt: string;
  subject: {
    repoName: string;
    commitSha?: string;
    filesScanned: number;
    findingsCount: number;
    criticalCount: number;
    highCount: number;
    patternsVersion: string;
  };
  findings: Array<{
    file: string;
    line: number;
    cwe: string;
    severity: string;
    cvss: number;
    status: string;
    permalink?: string;
  }>;
  integrity: string; // SHA-256 of canonical payload
}

function createTpVcAttestation(result: ScanResult): TpVcAttestation {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  result.findings.forEach(f => counts[f.pattern.severity]++);

  const findingsPayload = result.findings.map(f => ({
    file: f.file,
    line: f.line,
    cwe: f.pattern.cwe,
    severity: f.pattern.severity,
    cvss: f.cvss,
    status: f.guardStatus,
    permalink: f.permalink,
  }));

  const subject = {
    repoName: result.repoName,
    commitSha: result.commitSha,
    filesScanned: result.filesScanned,
    findingsCount: result.findings.length,
    criticalCount: counts.critical,
    highCount: counts.high,
    patternsVersion: '1.0.0',
  };

  const canonicalPayload = JSON.stringify({ subject, findings: findingsPayload });
  const integrity = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

  return {
    '@context': 'https://thoughtproof.ai/ns/security-audit/v1',
    type: 'SecurityAuditAttestation',
    id: `urn:tp:security-audit:${integrity.slice(0, 16)}`,
    issuedAt: new Date().toISOString(),
    subject,
    findings: findingsPayload,
    integrity,
  };
}

// ─── Main Command ─────────────────────────────────────────────────────────────

export async function securityAuditCommand(
  target: string,
  options: { json?: boolean; tpVc?: boolean; verbose?: boolean; critic?: boolean; criticModel?: string },
): Promise<void> {
  const startTime = Date.now();
  const spinner = ora('Initializing security audit...').start();

  let repoRoot: string;
  let repoName: string;
  let commitSha: string | undefined;
  let githubOwnerRepo: string | undefined;
  let isTemp = false;

  // ── Phase 1: Resolve target ──────────────────────────────────────────────────
  const isUrl = /^https?:\/\//.test(target);

  if (isUrl) {
    const gh = parseGithubUrl(target);
    if (gh) {
      githubOwnerRepo = `${gh.owner}/${gh.repo}`;
      repoName = githubOwnerRepo;
    } else {
      repoName = target.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
    }

    spinner.text = `Cloning ${repoName}...`;
    try {
      const cloned = cloneRepo(target);
      repoRoot = cloned.dir;
      commitSha = cloned.sha;
      isTemp = true;
    } catch (err) {
      spinner.fail(chalk.red(`Clone failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  } else {
    repoRoot = path.resolve(target);
    if (!existsSync(repoRoot)) {
      spinner.fail(chalk.red(`Path not found: ${repoRoot}`));
      process.exit(1);
    }
    repoName = path.basename(repoRoot);

    // Try to get git metadata from local repo
    try {
      commitSha = execSync('git rev-parse HEAD', { cwd: repoRoot, timeout: 5_000, stdio: 'pipe' })
        .toString().trim().slice(0, 8);
    } catch { /* not a git repo, or no commits */ }

    try {
      const remote = execSync('git remote get-url origin', { cwd: repoRoot, timeout: 5_000, stdio: 'pipe' })
        .toString().trim();
      const gh = parseGithubUrl(remote);
      if (gh) githubOwnerRepo = `${gh.owner}/${gh.repo}`;
    } catch { /* no remote */ }
  }

  // ── Phase 2: Collect & Scan ──────────────────────────────────────────────────
  spinner.text = 'Collecting files...';
  const files = gatherFiles(repoRoot);

  if (options.verbose) {
    spinner.stopAndPersist({ symbol: chalk.dim('→'), text: chalk.dim(`${files.length} file(s) to scan`) });
    spinner.start();
  }

  spinner.text = `Scanning ${files.length} files for dangerous patterns...`;

  const allFindings: Finding[] = [];
  for (const file of files) {
    const hits = scanFile(file, repoRoot, githubOwnerRepo, commitSha);
    if (hits.length > 0) {
      allFindings.push(...hits);
      if (options.verbose) {
        spinner.stopAndPersist({
          symbol: chalk.yellow('!'),
          text: chalk.dim(`${path.relative(repoRoot, file)}: ${hits.length} hit(s)`),
        });
        spinner.start();
      }
    }
  }

  // Deduplicate (same file + line + cwe)
  const seen = new Set<string>();
  const findings = allFindings.filter(f => {
    const key = `${f.file}:${f.line}:${f.pattern.cwe}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: critical first, then high, then by file path
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => {
    const diff = order[a.pattern.severity] - order[b.pattern.severity];
    return diff !== 0 ? diff : a.file.localeCompare(b.file);
  });

  const durationMs = Date.now() - startTime;
  const result: ScanResult = {
    findings,
    filesScanned: files.length,
    repoName,
    commitSha,
    githubOwnerRepo,
    durationMs,
  };

  spinner.succeed(chalk.green(`Scan complete — ${findings.length} finding(s) in ${files.length} files (${(durationMs / 1000).toFixed(1)}s)`));

  // ── Phase 2b: DSPy-optimized Critic (optional) ───────────────────────────────
  if (options.critic && findings.length > 0) {
    const criticSpinner = ora(`Running DSPy-optimized critic on ${findings.length} findings...`).start();

    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      criticSpinner.text = `Critic: evaluating ${i + 1}/${findings.length} — ${f.file}:${f.line}`;

      try {
        const messages = buildSecurityAuditCriticMessages({
          codeSnippet: f.code,
          finding: `${f.pattern.label} (${f.pattern.cwe}) — ${f.guardStatus}, CVSS ~${f.cvss}`,
          vulnerabilityType: f.pattern.cwe.replace('CWE-', '').toLowerCase(),
        });

        const model = options.criticModel || 'sonnet';
        const response = await callModel(model, messages, { maxTokens: 1024 });
        f.criticVerdict = parseAuditCriticResponse(response.content);
      } catch {
        // Critic failure is non-fatal — finding stands without verdict
      }
    }

    const fpCount = findings.filter(f => f.criticVerdict?.verdict === 'false_positive').length;
    criticSpinner.succeed(
      chalk.green(`Critic complete — ${fpCount} likely false positive(s), ${findings.length - fpCount} confirmed`)
    );
  }

  // ── Phase 3: Output ──────────────────────────────────────────────────────────
  const safeRepoName = repoName.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 40);
  const datestamp    = new Date().toISOString().slice(0, 10);

  if (options.json) {
    const output = {
      repoName,
      commitSha,
      filesScanned: files.length,
      durationMs,
      findings: findings.map(f => ({
        file:          f.file,
        line:          f.line,
        code:          f.code,
        cwe:           f.pattern.cwe,
        severity:      f.pattern.severity,
        label:         f.pattern.label,
        guardStatus:   f.guardStatus,
        bypassLine:    f.bypassLine,
        bypassSnippet: f.bypassSnippet,
        hasSandbox:    f.hasSandbox,
        cvss:          f.cvss,
        permalink:     f.permalink,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    printConsoleReport(result);

    const reportFile = `security-audit-${safeRepoName}-${datestamp}.md`;
    writeFileSync(reportFile, buildMarkdownReport(result), 'utf8');
    console.log(chalk.dim(`\n📄 Report saved: ${reportFile}`));
  }

  if (options.tpVc) {
    const attestation = createTpVcAttestation(result);
    const attestFile  = `security-audit-attestation-${safeRepoName}-${datestamp}.json`;
    writeFileSync(attestFile, JSON.stringify(attestation, null, 2), 'utf8');
    console.log(chalk.cyan(`\n🔏 TP-VC Attestation saved: ${attestFile}`));
    console.log(chalk.dim(`   ID:        ${attestation.id}`));
    console.log(chalk.dim(`   Integrity: ${attestation.integrity.slice(0, 16)}...`));
  }

  // Cleanup temp clone directory
  if (isTemp) {
    try { execSync(`rm -rf "${repoRoot}"`, { timeout: 10_000, stdio: 'pipe' }); } catch { /* best effort */ }
  }
}
