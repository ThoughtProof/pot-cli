import { Provider, Proposal, Critique } from '../types.js';

const CRITIC_PROMPT_DE = `Du bist ein brutaler Red-Team Analyst. Deine Aufgabe: Finde ALLE Schwächen in diesen 3 Proposals.

REGELN:
- Bewerte jedes Proposal mit Score 1-10
- Finde logische Fehler, fehlende Perspektiven, falsche Annahmen
- Sei schonungslos aber fair
- Nenne was FEHLT (blinde Flecken)

PROPOSALS:
{proposals}`;

const CRITIC_PROMPT_EN = `You are a brutal Red-Team analyst. Your task: Find ALL weaknesses in these 3 proposals.

RULES:
- Rate each proposal with score 1-10
- Find logical errors, missing perspectives, false assumptions
- Be ruthless but fair
- Name what's MISSING (blind spots)

PROPOSALS:
{proposals}`;

export async function runCritic(
  provider: Provider,
  model: string,
  proposals: Proposal[],
  language: 'de' | 'en' = 'de',
  dryRun: boolean = false
): Promise<Critique> {
  if (dryRun) {
    return {
      model: model.split('/').pop() || model,
      role: 'critic',
      content: `[DRY-RUN] Simulated critique from ${model}\n\nProposal 1: Score 7/10 - Good analysis but lacks...\nProposal 2: Score 8/10 - Strong points, however...\nProposal 3: Score 6/10 - Weak on...`,
    };
  }

  const proposalsText = proposals
    .map((p, i) => `\n=== PROPOSAL ${i + 1} (${p.model}) ===\n${p.content}`)
    .join('\n\n');

  const template = language === 'de' ? CRITIC_PROMPT_DE : CRITIC_PROMPT_EN;
  const prompt = template.replace('{proposals}', proposalsText);

  const response = await provider.call(model, prompt);

  return {
    model: model.split('/').pop() || model,
    role: 'critic',
    content: response.content,
  };
}
