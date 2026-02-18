import { Provider, Proposal, Critique, Synthesis } from '../types.js';

const SYNTHESIZER_PROMPT_DE = `Du bist der Synthesizer. Kombiniere die 3 Proposals und die Kritik zu einer optimalen Antwort.

{context}

REGELN:
- Nutze die Stärken aller Proposals
- Adressiere die Kritikpunkte
- Gib eine klare Empfehlung
- Quantifiziere Unsicherheit (Confidence: X%)
- Max 800 Wörter

PROPOSALS:
{proposals}

KRITIK:
{critique}`;

const SYNTHESIZER_PROMPT_EN = `You are the Synthesizer. Combine the 3 proposals and critique into an optimal answer.

{context}

RULES:
- Use the strengths of all proposals
- Address the critique points
- Give a clear recommendation
- Quantify uncertainty (Confidence: X%)
- Max 800 words

PROPOSALS:
{proposals}

CRITIQUE:
{critique}`;

export async function runSynthesizer(
  provider: Provider,
  model: string,
  proposals: Proposal[],
  critique: Critique,
  language: 'de' | 'en' = 'de',
  dryRun: boolean = false,
  contextText?: string
): Promise<Synthesis> {
  if (dryRun) {
    return {
      model: model.split('/').pop() || model,
      role: 'synthesizer',
      content: `[DRY-RUN] Simulated synthesis from ${model}\n\nCombining insights from all three proposals...\nAddressing critique points...\n\nFinal recommendation: [placeholder]\nConfidence: 85%`,
    };
  }

  const proposalsText = proposals
    .map((p, i) => `\n=== PROPOSAL ${i + 1} (${p.model}) ===\n${p.content}`)
    .join('\n\n');

  const template = language === 'de' ? SYNTHESIZER_PROMPT_DE : SYNTHESIZER_PROMPT_EN;
  const contextSection = contextText || '';
  const prompt = template
    .replace('{context}', contextSection)
    .replace('{proposals}', proposalsText)
    .replace('{critique}', critique.content);

  const response = await provider.call(model, prompt);

  return {
    model: model.split('/').pop() || model,
    role: 'synthesizer',
    content: response.content,
  };
}
