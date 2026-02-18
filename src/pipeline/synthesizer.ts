import { Provider, Proposal, Critique, Synthesis } from '../types.js';

const SYNTHESIZER_PROMPT_DE = `Du bist der Synthesizer. Kombiniere die Proposals und die Kritik zu einer optimalen Antwort.

{context}

REGELN:
- Nutze die Stärken aller Proposals
- Adressiere die Kritikpunkte explizit — besonders UNVERIFIZIERTE Behauptungen die der Critic markiert hat
- Gib eine klare Empfehlung

CONFIDENCE-BEWERTUNG (PFLICHT):
- Schreibe am Ende "Confidence: X%"
- Maximum 85% — kein Multi-Modell-System kann Wahrheit garantieren
- Bei subjektiven/strategischen Fragen: Maximum 70%
- Bei Fragen wo alle Modelle übereinstimmen aber der Critic Shared Bias fand: Maximum 60%
- Hoher Dissens zwischen Proposals = NIEDRIGERE Confidence, nicht gemittelt

DISSENS-ABSCHNITT (PFLICHT):
- Füge einen "Wo die Modelle sich widersprechen" Abschnitt ein
- Erkläre WARUM sie sich widersprechen
- Verstecke Dissens NICHT — er ist das wertvollste Signal

DISCLAIMER:
- Ende mit: "⚠️ Multi-Modell-Analyse — keine verifizierte Wahrheit. Dissens oben hervorgehoben."

- Max 800 Wörter

PROPOSALS:
{proposals}

KRITIK:
{critique}`;

const SYNTHESIZER_PROMPT_EN = `You are the Synthesizer. Combine the proposals and critique into an optimal answer.

{context}

RULES:
- Use the strengths of all proposals
- Address the critique points explicitly — especially any UNVERIFIED claims flagged by the critic
- Give a clear recommendation

CONFIDENCE SCORING (MANDATORY):
- State "Confidence: X%" at the end
- Cap confidence at 85% maximum — no multi-model system can guarantee truth
- For subjective/strategic questions: cap at 70%
- For questions where all models agree but the critic found shared bias: cap at 60%
- High disagreement between proposals = LOWER confidence, not averaged confidence

DISAGREEMENT SECTION (MANDATORY):
- Include a "Where Models Disagreed" section
- Explain WHY they disagreed (different assumptions? different data? different frameworks?)
- Do NOT hide disagreement — it is the most valuable signal

DISCLAIMER:
- End with: "⚠️ Multi-model analysis — not verified truth. Disagreements highlighted above."

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
