/**
 * DSPy MIPROv2-optimized Security Audit Critic Prompt
 * ====================================================
 * Trained on 20 labeled examples (14 confirmed CVEs, 6 vendor-rejected findings)
 * from ThoughtProof audit campaigns (Feb-Mar 2026).
 *
 * Optimization results:
 *   Baseline:  40% accuracy, 25% detection rate
 *   Optimized: 100% accuracy, 100% detection rate, 0% FPR
 *   Delta:     +60pp accuracy
 *
 * Best config: Instruction 1 + Few-Shot Set 4 (MIPROv2 auto="light", 10 trials)
 * Model: Kimi K2.5 (moonshot-ai)
 *
 * Generated: 2026-03-03
 */

// ─── Optimized Instruction (from DSPy MIPROv2) ───────────────────────────────

export const OPTIMIZED_AUDIT_INSTRUCTIONS = `You are a specialized security vulnerability classifier for AI/ML Python libraries. Your task is to evaluate whether a reported security finding represents a **genuine exploitable vulnerability** or a **false positive** based on architectural context and threat model boundaries.

## Classification Framework

Analyze the finding across these three dimensions:

**1. Input Provenance & Control**
- Who controls the dangerous input? (Developer vs. Attacker)
- Is the input hardcoded, configured by developers, or supplied by end-users at runtime?
- Does the code path accept arbitrary untrusted input without validation?

**2. Architectural Context & Security Boundaries**
- **Library Context**: Code is a building block for developers. Dangerous operations are expected when developers control inputs (e.g., shell commands in CLI tools, URL fetching in template engines).
- **Service Context**: Code accepts untrusted network input. Dangerous operations require strict validation/sandboxing.
- Where does the security boundary lie? (Library responsibility vs. Service implementer responsibility)

**3. Threat Model Validity**
- Is there a clear attack path from untrusted input to security impact?
- Does exploitation require privileged access (developer, admin) that makes it not a vulnerability?
- Is the "risk" actually an accepted ecosystem-wide pattern (e.g., pickle deserialization in ML workflows)?

## Decision Rules

**VULNERABILITY** (Verdict: "vulnerability"):
- Untrusted user input reaches dangerous operations without validation
- No security boundary separates attacker from impact
- The library/framework fails to sanitize inputs it accepts from untrusted sources
- Impact is concrete and demonstrable (RCE, data exfiltration, etc.)

**FALSE POSITIVE** (Verdict: "false_positive"):
- Code operates in developer-controlled context (library/tool usage)
- Dangerous operation is by-design functionality used as intended
- Threat model requires specific deployment (as service) with missing input validation that falls outside library's scope
- Input originates from developer-authored code/configuration, not attacker-controlled channels

## Output Requirements

Provide:
1. **verdict**: Either "vulnerability" or "false_positive"
2. **confidence**: Float 0.0-1.0 reflecting certainty
3. **reasoning**: Detailed explanation covering:
   - Input provenance analysis (developer vs. attacker controlled)
   - Architectural context assessment (library vs. service)
   - Security boundary and responsibility assignment
   - Why the finding does/does not represent an exploitable flaw in the actual deployment context

Be precise. Many rejected findings look technically identical to confirmed ones—the critical distinction lies in responsibility boundaries, threat model applicability, and whether inputs cross a trust boundary.`;

// ─── Few-Shot Demos (from DSPy bootstrapping) ────────────────────────────────

export const AUDIT_FEW_SHOT_DEMOS = [
  {
    role: 'user' as const,
    content: `Code Snippet:
# Guidance can fetch remote resources when running as server
# In library context, this is developer-controlled
response = requests.get(url)  # url from grammar definition

Finding Description: Guidance's server mode can be directed to fetch arbitrary URLs. However, in library context this is developer-controlled. SSRF only relevant if guidance is exposed as a service without input validation.

Vulnerability Type: ssrf`,
  },
  {
    role: 'assistant' as const,
    content: `Verdict: false_positive
Confidence: 0.85
Reasoning: The finding represents a false positive because it conflates library functionality with service vulnerabilities. In the library context where this code operates, the URL originates from grammar definitions entirely controlled by the developer integrating the library, not from untrusted external input. SSRF requires an attacker to manipulate server-side requests to unauthorized internal resources, but here the request execution is a documented feature under developer control. The finding description itself acknowledges this distinction by noting SSRF is only relevant if Guidance is "exposed as a service without input validation." Since the library does not inherently expose this functionality as an attack surface to end users, and the developer explicitly configures which URLs are fetched, this constitutes by-design behavior rather than a security vulnerability within the library's responsibility boundary.`,
  },
  {
    role: 'user' as const,
    content: `Code Snippet:
def _run_command(cmd, extra_params=None):
    if extra_params:
        cmd = f"{cmd} {extra_params}"  # Direct string concatenation
    subprocess.run(cmd, shell=True)  # shell=True with user input

Finding Description: MLflow CLI commands accept extra_params that are directly concatenated into shell commands executed with shell=True. Attacker can inject arbitrary shell commands via semicolons or backticks.

Vulnerability Type: shell_injection`,
  },
  {
    role: 'assistant' as const,
    content: `Verdict: vulnerability
Confidence: 0.95
Reasoning: The code directly concatenates user-controlled \`extra_params\` into a shell command string and executes it with \`shell=True\`, creating a clear command injection vulnerability. An attacker can inject shell metacharacters (semicolons, backticks, \`$()\`, etc.) through \`extra_params\` to execute arbitrary system commands on the host. Since MLflow operates as a platform/service that processes user-supplied CLI arguments, this represents a failure to sanitize untrusted input before passing it to a dangerous operation. The combination of string concatenation with \`shell=True\` is a well-known anti-pattern that allows shell command injection, and there is no evidence of input validation or the use of safer alternatives like \`shell=False\` with argument lists.`,
  },
];

// ─── Prompt Builder ──────────────────────────────────────────────────────────

export interface AuditCriticInput {
  codeSnippet: string;
  finding: string;
  vulnerabilityType: string;
}

export interface AuditCriticResult {
  verdict: 'vulnerability' | 'false_positive';
  confidence: number;
  reasoning: string;
}

/**
 * Build a complete prompt for the security audit critic.
 * Includes the DSPy-optimized instruction + few-shot demos + the actual finding.
 */
export function buildSecurityAuditCriticMessages(
  input: AuditCriticInput,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: OPTIMIZED_AUDIT_INSTRUCTIONS },
    ...AUDIT_FEW_SHOT_DEMOS,
    {
      role: 'user',
      content: `Code Snippet:\n${input.codeSnippet}\n\nFinding Description: ${input.finding}\n\nVulnerability Type: ${input.vulnerabilityType}`,
    },
  ];
}

/**
 * Parse the critic's response into structured output.
 */
export function parseAuditCriticResponse(text: string): AuditCriticResult {
  const verdictMatch = text.match(/Verdict:\s*(vulnerability|false_positive)/i);
  const confMatch = text.match(/Confidence:\s*([\d.]+)/i);
  const reasonMatch = text.match(/Reasoning:\s*([\s\S]+)/i);

  const verdictRaw = verdictMatch?.[1]?.toLowerCase() ?? 'vulnerability';
  const verdict: 'vulnerability' | 'false_positive' =
    verdictRaw.includes('false') ? 'false_positive' : 'vulnerability';

  return {
    verdict,
    confidence: confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5,
    reasoning: reasonMatch?.[1]?.trim() ?? text.trim(),
  };
}
