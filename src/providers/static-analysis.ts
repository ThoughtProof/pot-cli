import { BaseProvider } from './base.js';
import { APIResponse } from '../types.js';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

class StaticAnalysisProvider extends BaseProvider {
  name = 'StaticAnalysis';

  constructor() {
    super();
  }

  isAvailable(): boolean {
    return true;
  }

  private runTool(cmd: string, cwd: string): { output: string; found: boolean } {
    try {
      const out = execSync(cmd, { cwd, timeout: 30000, encoding: 'utf8' });
      return { output: out, found: true };
    } catch (e: any) {
      let output = '';
      if (e.stdout) output += e.stdout;
      if (e.stderr) output += '\n' + e.stderr;
      if (!output) output = e.message || '';
      const notInstalled = output.includes('not found') || output.includes('ENOENT') || output.includes('command not found');
      return { output, found: !notInstalled };
    }
  }

  async call(model: string, prompt: string): Promise<APIResponse> {
    // Extract code block from prompt
    const codeMatch = prompt.match(/```(\w+)?\s*\n([\s\S]*?)```/);
    let language = 'unknown';
    let code = '';
    if (codeMatch) {
      language = (codeMatch[1] || 'text').toLowerCase();
      code = codeMatch[2].trim();
    }
    if (!code) {
      return { content: 'No code block found in prompt. Wrap code in ```language ... ```', tokens: 0, cost: 0 };
    }

    // Map language to tools
    let ext = '';
    let tools: string[] = [];
    if (['python', 'py'].includes(language)) {
      ext = 'py';
      tools = ['ruff', 'mypy'];
    } else if (['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx'].includes(language)) {
      ext = 'js';
      tools = ['eslint'];
    } else if (['sh', 'bash', 'shell', 'zsh'].includes(language)) {
      ext = 'sh';
      tools = ['shellcheck'];
    } else {
      return { content: `Unsupported language: ${language}. Supported: python, javascript/typescript, shell.`, tokens: 0, cost: 0 };
    }

    // Write code to temp file
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'pot-static-'));
    const fileName = `code.${ext}`;
    const filePath = path.join(tmpDir, fileName);

    try {
      writeFileSync(filePath, code, 'utf8');

      const sections: string[] = [];
      const usedTools: string[] = [];

      for (const tool of tools) {
        let cmd = '';
        switch (tool) {
          case 'ruff':
            cmd = `ruff check --output-format=concise ${fileName} 2>&1`;
            break;
          case 'mypy':
            cmd = `mypy --no-error-summary --no-incremental ${fileName} 2>&1`;
            break;
          case 'eslint':
            cmd = `npx eslint --no-eslintrc --rule '{"no-unused-vars":"warn","no-undef":"error","eqeqeq":"warn"}' ${fileName} 2>&1`;
            break;
          case 'shellcheck':
            cmd = `shellcheck ${fileName} 2>&1`;
            break;
        }

        const result = this.runTool(cmd, tmpDir);
        if (result.found) {
          usedTools.push(tool);
          const output = result.output.trim();
          if (output) {
            sections.push(`### ${tool}\n${output}`);
          }
        }
      }

      if (usedTools.length === 0) {
        return {
          content: `Static analysis tools not available for ${language}. Install: ${tools.join(', ')}`,
          tokens: 0,
          cost: 0
        };
      }

      // Count errors and warnings
      const allOutput = sections.join('\n');
      const errorCount = (allOutput.match(/error/gi) || []).length;
      const warningCount = (allOutput.match(/warn/gi) || []).length;

      if (!allOutput.trim() || (errorCount === 0 && warningCount === 0 && !allOutput.includes(':'))) {
        return {
          content: `## Static Analysis Report\n\n### Language: ${language.toUpperCase()}\n### Tools: ${usedTools.join(', ')}\n\n✅ No issues found by static analysis.\n\n[Note: This is deterministic static analysis, not AI inference]`,
          tokens: 0,
          cost: 0
        };
      }

      const report = `## Static Analysis Report

### Language: ${language.toUpperCase()}
### Tools: ${usedTools.join(', ')}

### Findings:
${sections.join('\n\n')}

### Summary:
- ~${errorCount} errors, ~${warningCount} warnings detected
- Tools used: ${usedTools.join(', ')}

[Note: This is deterministic static analysis, not AI inference. Zero hallucination risk.]`;

      return { content: report, tokens: 0, cost: 0 };

    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

export { StaticAnalysisProvider };
