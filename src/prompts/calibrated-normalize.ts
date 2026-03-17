/**
 * Calibrated Normalize Prompt — pot-cli
 * ======================================
 * DSPy MIPROv2-optimized normalization step for the general PoT pipeline.
 *
 * Adapted from the payment-verification variant for use in `ask` / `deep` commands.
 * Here "verifiers" = individual model proposals, "reasoning" = synthesizer output.
 *
 * Baseline (regex parseConfidence):   0/500 hits → always returns 0.5
 * Optimized:                          68.3% accuracy, 90% adversarial detection
 * Overconfident wrong verdicts:       0
 *
 * Generated: 2026-03-04, DSPy MIPROv2, moonshot-v1-32k, 12 trials
 */

export const CALIBRATED_NORMALIZE_SYSTEM = `You are the final calibration step in a multi-model epistemic verification pipeline.

You receive:
1. The original question posed to the system
2. Individual model proposals (each model's position on the question)
3. The adversarial critique that challenged those proposals
4. The synthesizer's final output (combining proposals + critique)

Your task: extract a calibrated verdict and confidence score from the synthesis, correcting for:
- Synthesizer overconfidence (claims high certainty despite hedging language or disagreement)
- Synthesizer underconfidence (hedges unnecessarily when models strongly converge)
- False consensus (all models agreed on a wrong answer — lowest signal, not highest)
- Critique preservation failure (synthesis ignored valid objections)

VERDICT OPTIONS:
- VERIFIED:   Strong convergence, critique addressed, concrete evidence cited
- UNCERTAIN:  Mixed signals, hedging language, or unresolved dissent
- DISSENT:    Models fundamentally disagree — no synthesis is reliable
- UNVERIFIED: Synthesis internally contradicts itself or ignores critique entirely

CONFIDENCE CALIBRATION RULES:
- Max 0.90 (no multi-model system guarantees truth)
- All models converge + critique addressed → 0.75-0.90
- Some dissent or hedging language in synthesis → 0.50-0.70
- Majority of synthesis is caveats or "it depends" → 0.35-0.55
- Critique flagged factual errors that synthesis kept anyway → 0.30-0.50
- Strategic/subjective questions: cap at 0.70 regardless of convergence`;

export const CALIBRATED_NORMALIZE_USER_TEMPLATE = `Calibrate the following synthesis output.

Question: {question}

Model Proposals:
{proposals}

Adversarial Critique:
{critique}

Synthesizer Output (first 800 chars):
{synthesis}

Respond with ONLY valid JSON — no markdown, no prose:
{
  "verdict": "VERIFIED" | "UNCERTAIN" | "DISSENT" | "UNVERIFIED",
  "confidence": <float 0.0-0.90>,
  "calibration_reason": "<one sentence: key signal that determined this confidence level>"
}`;

export interface NormalizeInput {
  question: string;
  proposals: string;   // pre-formatted: "- modelA: <first 200 chars>\n- modelB: ..."
  critique: string;    // critique content (first 400 chars)
  synthesis: string;   // synthesis content (first 800 chars)
}

export interface NormalizeOutput {
  verdict: 'VERIFIED' | 'UNCERTAIN' | 'DISSENT' | 'UNVERIFIED';
  confidence: number;
  calibration_reason: string;
}

/**
 * Format proposals for the normalize prompt input.
 */
export function formatProposalsForNormalize(
  proposals: Array<{ model: string; content: string }>
): string {
  return proposals
    .map(p => `- ${p.model}: ${p.content.slice(0, 200).replace(/\n/g, ' ')}...`)
    .join('\n');
}

/**
 * Build the user prompt for the calibrated normalize step.
 */
export function buildCalibratedNormalizePrompt(input: NormalizeInput): string {
  return CALIBRATED_NORMALIZE_USER_TEMPLATE
    .replace('{question}',   input.question.slice(0, 300))
    .replace('{proposals}',  input.proposals)
    .replace('{critique}',   input.critique.slice(0, 400))
    .replace('{synthesis}',  input.synthesis.slice(0, 800));
}

/**
 * Parse and validate JSON output from the normalize LLM call.
 * Falls back gracefully — never throws.
 */
export function parseCalibratedNormalizeOutput(
  raw: string,
  fallbackConfidence: number = 0.5
): NormalizeOutput {
  const VALID_VERDICTS = new Set(['VERIFIED', 'UNCERTAIN', 'DISSENT', 'UNVERIFIED']);

  try {
    const cleaned = raw.replace(/```(?:json)?\s*/g, '').trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');

    const parsed = JSON.parse(match[0]);

    const verdict = String(parsed.verdict ?? '').toUpperCase();
    const rawConf = Number(parsed.confidence ?? fallbackConfidence);
    const confidence = Math.min(0.90, Math.max(0.0, isNaN(rawConf) ? fallbackConfidence : rawConf));
    const calibration_reason = String(parsed.calibration_reason ?? '');

    return {
      verdict: VALID_VERDICTS.has(verdict)
        ? (verdict as NormalizeOutput['verdict'])
        : 'UNCERTAIN',
      confidence,
      calibration_reason,
    };
  } catch {
    return {
      verdict: 'UNCERTAIN',
      confidence: fallbackConfidence,
      calibration_reason: 'Parse error — using fallback confidence',
    };
  }
}
