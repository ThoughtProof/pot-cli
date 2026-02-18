import { Provider, Proposal, Critique } from '../types.js';

// Round 1: Critic reads proposals and asks pointed questions
const INTERROGATION_PROMPT_EN = `You are a brutal Red-Team analyst conducting a cross-examination. You have read these proposals and now must ask POINTED QUESTIONS to expose weaknesses.

{context}

For EACH proposal, ask 2-3 specific questions that:
- Challenge unverified claims ("You say X% — what's your source?")
- Probe logical gaps ("If A is true, why does your conclusion say B?")
- Test for hallucination ("You cite [study] — does this study actually exist?")
- Expose hidden assumptions ("You assume X — what if the opposite is true?")

Format your output as:

## Questions for Proposal 1 ({model1})
1. [question]
2. [question]

## Questions for Proposal 2 ({model2})
1. [question]
2. [question]

## Questions for Proposal 3 ({model3})
1. [question]
2. [question]

Be specific. No softball questions.

PROPOSALS:
{proposals}`;

const INTERROGATION_PROMPT_DE = `Du bist ein brutaler Red-Team Analyst im Kreuzverhör. Du hast diese Proposals gelesen und stellst jetzt GEZIELTE FRAGEN um Schwächen aufzudecken.

{context}

Stelle für JEDES Proposal 2-3 spezifische Fragen die:
- Unbelegte Behauptungen hinterfragen ("Du sagst X% — welche Quelle?")
- Logische Lücken aufdecken ("Wenn A stimmt, warum sagst du B?")
- Halluzinationen testen ("Du zitierst [Studie] — existiert die wirklich?")
- Versteckte Annahmen entlarven ("Du nimmst X an — was wenn das Gegenteil stimmt?")

Format:

## Fragen an Proposal 1 ({model1})
1. [Frage]
2. [Frage]

## Fragen an Proposal 2 ({model2})
1. [Frage]
2. [Frage]

## Fragen an Proposal 3 ({model3})
1. [Frage]
2. [Frage]

Sei spezifisch. Keine Softball-Fragen.

PROPOSALS:
{proposals}`;

// Round 2: Each generator must defend their proposal
const DEFENSE_PROMPT_EN = `You previously wrote a proposal in response to a question. A Red-Team critic has now asked you pointed questions about your proposal. You MUST answer honestly.

RULES:
- If you cannot verify a claim, say "I cannot verify this — it may be incorrect"
- If you made an error, admit it: "This was incorrect, the actual answer is..."
- If you cited a non-existent source, say "I fabricated this citation"
- Do NOT double down on claims you're unsure about
- Honesty is more important than defending your position

YOUR ORIGINAL PROPOSAL:
{proposal}

CRITIC'S QUESTIONS:
{questions}

Answer each question directly and honestly.`;

const DEFENSE_PROMPT_DE = `Du hast zuvor ein Proposal geschrieben. Ein Red-Team-Kritiker hat dir gezielte Fragen gestellt. Du MUSST ehrlich antworten.

REGELN:
- Wenn du eine Behauptung nicht verifizieren kannst: "Ich kann das nicht verifizieren — es könnte falsch sein"
- Wenn du einen Fehler gemacht hast: "Das war falsch, die richtige Antwort ist..."
- Wenn du eine nicht-existierende Quelle zitiert hast: "Dieses Zitat habe ich erfunden"
- Verdopple NICHT auf unsichere Behauptungen
- Ehrlichkeit ist wichtiger als Verteidigung

DEIN ORIGINAL-PROPOSAL:
{proposal}

FRAGEN DES KRITIKERS:
{questions}

Beantworte jede Frage direkt und ehrlich.`;

// Round 3: Final verdict with all evidence
const FINAL_VERDICT_PROMPT_EN = `You are the Red-Team critic delivering your FINAL VERDICT. You have:
1. Read the original proposals
2. Asked pointed questions
3. Received the generators' defenses

Now deliver your final analysis. Pay special attention to:
- Generators that ADMITTED errors or fabrications (this is valuable signal!)
- Generators that doubled down on unverifiable claims (red flag!)
- Claims that survived cross-examination vs. those that collapsed

{context}

ORIGINAL PROPOSALS:
{proposals}

YOUR QUESTIONS AND THEIR RESPONSES:
{cross_examination}

{verification_section}

Now write your FINAL CRITIQUE. Rate each proposal 1-10. Highlight which claims survived and which collapsed under questioning.`;

const FINAL_VERDICT_PROMPT_DE = `Du bist der Red-Team-Kritiker und gibst dein ENDGÜLTIGES URTEIL. Du hast:
1. Die Original-Proposals gelesen
2. Gezielte Fragen gestellt
3. Die Verteidigungen der Generatoren erhalten

Gib jetzt deine finale Analyse. Achte besonders auf:
- Generatoren die FEHLER ZUGABEN (wertvolles Signal!)
- Generatoren die auf unverifizierbaren Behauptungen beharrten (Red Flag!)
- Behauptungen die das Kreuzverhör überlebten vs. zusammenbrachen

{context}

ORIGINAL-PROPOSALS:
{proposals}

DEINE FRAGEN UND DEREN ANTWORTEN:
{cross_examination}

{verification_section}

Schreibe jetzt dein FINALES URTEIL. Bewerte jedes Proposal 1-10. Hebe hervor welche Behauptungen überlebten und welche unter Befragung zusammenbrachen.`;

function extractQuestionsForProposal(interrogation: string, proposalIndex: number): string {
  // Try to extract questions for a specific proposal from the interrogation output
  const patterns = [
    new RegExp(`## (?:Questions for|Fragen an) Proposal ${proposalIndex + 1}[\\s\\S]*?(?=## (?:Questions|Fragen)|$)`, 'i'),
    new RegExp(`Proposal ${proposalIndex + 1}[\\s\\S]*?(?=Proposal ${proposalIndex + 2}|$)`, 'i'),
  ];
  
  for (const pattern of patterns) {
    const match = interrogation.match(pattern);
    if (match) return match[0].trim();
  }
  
  // Fallback: return all questions
  return interrogation;
}

export async function runMultiTurnCritic(
  criticProvider: Provider,
  criticModel: string,
  generators: { provider: Provider; model: string }[],
  proposals: Proposal[],
  language: 'de' | 'en' = 'en',
  dryRun: boolean = false,
  contextText?: string,
  verificationReport?: string,
  onProgress?: (step: string) => void
): Promise<Critique> {
  if (dryRun) {
    return {
      model: criticModel.split('/').pop() || criticModel,
      role: 'critic',
      content: `[DRY-RUN] Multi-turn critique simulation`,
    };
  }

  const proposalsText = proposals
    .map((p, i) => `\n=== PROPOSAL ${i + 1} (${p.model}) ===\n${p.content}`)
    .join('\n\n');

  const contextSection = contextText || '';

  // ROUND 1: Critic asks questions
  onProgress?.('Round 1: Critic formulating questions...');
  
  const interrogationTemplate = language === 'de' ? INTERROGATION_PROMPT_DE : INTERROGATION_PROMPT_EN;
  const interrogationPrompt = interrogationTemplate
    .replace('{context}', contextSection)
    .replace('{proposals}', proposalsText)
    .replace('{model1}', proposals[0]?.model || 'Model 1')
    .replace('{model2}', proposals[1]?.model || 'Model 2')
    .replace('{model3}', proposals[2]?.model || 'Model 3');

  const interrogationResponse = await criticProvider.call(criticModel, interrogationPrompt);
  const interrogation = interrogationResponse.content;

  // ROUND 2: Each generator defends their proposal
  onProgress?.('Round 2: Generators defending their proposals...');

  const defenseTemplate = language === 'de' ? DEFENSE_PROMPT_DE : DEFENSE_PROMPT_EN;
  const defensePromises = proposals.map(async (proposal, i) => {
    const questions = extractQuestionsForProposal(interrogation, i);
    const gen = generators[i % generators.length];
    
    const defensePrompt = defenseTemplate
      .replace('{proposal}', proposal.content)
      .replace('{questions}', questions);

    const response = await gen.provider.call(gen.model, defensePrompt);
    return {
      model: proposal.model,
      questions,
      defense: response.content,
    };
  });

  const defenses = await Promise.all(defensePromises);

  // ROUND 3: Final verdict
  onProgress?.('Round 3: Critic delivering final verdict...');

  const crossExaminationText = defenses
    .map((d, i) => `\n=== PROPOSAL ${i + 1} (${d.model}) ===\nQUESTIONS:\n${d.questions}\n\nDEFENSE:\n${d.defense}`)
    .join('\n\n---\n');

  const verificationSection = verificationReport
    ? `\n\n=== WEB VERIFICATION RESULTS ===\n${verificationReport}\n=== END VERIFICATION ===\n`
    : '';

  const verdictTemplate = language === 'de' ? FINAL_VERDICT_PROMPT_DE : FINAL_VERDICT_PROMPT_EN;
  const verdictPrompt = verdictTemplate
    .replace('{context}', contextSection)
    .replace('{proposals}', proposalsText)
    .replace('{cross_examination}', crossExaminationText)
    .replace('{verification_section}', verificationSection);

  const verdictResponse = await criticProvider.call(criticModel, verdictPrompt);

  // Combine all rounds into the final critique
  const fullCritique = [
    `## 🔍 MULTI-TURN CROSS-EXAMINATION (3 Rounds)`,
    ``,
    `### Round 1: Interrogation`,
    interrogation,
    ``,
    `### Round 2: Generator Defenses`,
    ...defenses.map((d, i) => `\n**${d.model} Defense:**\n${d.defense}`),
    ``,
    `### Round 3: Final Verdict`,
    verdictResponse.content,
  ].join('\n');

  return {
    model: criticModel.split('/').pop() || criticModel,
    role: 'critic',
    content: fullCritique,
  };
}
