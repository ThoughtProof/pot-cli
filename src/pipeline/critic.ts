import { Provider, Proposal, Critique } from '../types.js';

const CRITIC_PROMPT_DE = `Du bist ein brutaler Red-Team Analyst und Fakten-Checker. Deine Aufgabe: Finde ALLE Schwächen in diesen Proposals.

{context}

REGELN:
- Bewerte jedes Proposal mit Score 1-10

FAKTEN-VERIFIZIERUNG (KRITISCH):
- Verifiziere JEDE spezifische Behauptung, Statistik, jedes Datum und Zitat
- Markiere Zahlen/Prozente die du nicht unabhängig bestätigen kannst als "UNVERIFIZIERT: [Behauptung]"
- Prüfe auf halluzinierte Zitate (Studien, Papers, Berichte die möglicherweise nicht existieren)
- Wenn ein Proposal eine Quelle zitiert, prüfe ob die Quelle das aussagt was behauptet wird

LOGISCHE ANALYSE:
- Finde logische Fehler, Widersprüche und falsche Annahmen
- Identifiziere fehlende Perspektiven und blinde Flecken
- Prüfe ob Schlussfolgerungen tatsächlich aus den Belegen folgen

DISSENS-ANALYSE:
- Wo widersprechen sich die Proposals? Diese Widersprüche sind SIGNAL, nicht Rauschen
- Markiere wo ALLE Proposals übereinstimmen aber der Konsens trotzdem falsch sein könnte (Shared Bias)

Sei schonungslos aber fair. Das Ziel ist epistemische Ehrlichkeit, nicht Zerstörung.

PROPOSALS:
{proposals}`;

const CRITIC_PROMPT_EN = `You are a brutal Red-Team analyst and fact-checker. Your task: Find ALL weaknesses in these proposals.

{context}

RULES:
- Rate each proposal with score 1-10

FACTUAL VERIFICATION (CRITICAL):
- Verify EVERY specific claim, statistic, date, and citation in each proposal
- Flag any number, percentage, or data point you cannot independently confirm as "UNVERIFIED: [claim]"
- Check for hallucinated citations (papers, studies, reports that may not exist)
- If a proposal cites a specific source, verify the source says what the proposal claims

LOGICAL ANALYSIS:
- Find logical errors, contradictions, and false assumptions
- Identify missing perspectives and blind spots
- Check if conclusions actually follow from the evidence presented

DISAGREEMENT ANALYSIS:
- Where do proposals contradict each other? These disagreements are SIGNAL, not noise
- Flag where all proposals agree but the consensus might still be wrong (shared bias)

Be ruthless but fair. The goal is epistemic honesty, not destruction.

PROPOSALS:
{proposals}`;

export async function runCritic(
  provider: Provider,
  model: string,
  proposals: Proposal[],
  language: 'de' | 'en' = 'de',
  dryRun: boolean = false,
  contextText?: string,
  verificationReport?: string
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
  const contextSection = contextText || '';
  const verificationSection = verificationReport 
    ? `\n\n=== WEB VERIFICATION RESULTS ===\nThe following claims were checked against web sources BEFORE your analysis. Use these results to inform your critique:\n\n${verificationReport}\n=== END VERIFICATION ===\n`
    : '';
  const prompt = template
    .replace('{context}', contextSection + verificationSection)
    .replace('{proposals}', proposalsText);

  const response = await provider.call(model, prompt);

  return {
    model: model.split('/').pop() || model,
    role: 'critic',
    content: response.content,
  };
}
