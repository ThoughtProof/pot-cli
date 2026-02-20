import { Provider, Proposal, Critique, Synthesis, SynthesisBalance, SynthesisVerification } from '../types.js';

const SYNTHESIZER_PROMPT_DE = `Du bist der Synthesizer. Kombiniere die Proposals und die Kritik zu einer optimalen Antwort.

{context}

TRANSPARENCY — ZWINGEND EINZUHALTEN:
- Du MUSST jede Generator-Position (Proposal 1, 2, 3, ...) explizit adressieren
- Du MUSST dokumentieren, welche Argumente du VERWIRFST und WARUM
- Wenn du eine Position stark gewichtest: begründe es mit dem Evaluation/Critique-Ergebnis
- Dominanz ist OK wenn begründet — undokumentierte Dominanz ist das Problem
- Füge am Ende einen kurzen "Synthesis Decisions" Block ein: welche Argumente übernommen, welche verworfen, warum

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

TRANSPARENCY — MANDATORY:
- You MUST explicitly address each Generator position (Proposal 1, 2, 3, ...)
- You MUST document which arguments you REJECT and WHY
- If you weight one position heavily: justify it with the Evaluation/Critique results
- Dominance is OK when justified — undocumented dominance is the problem
- Add a brief "Synthesis Decisions" section at the end: which arguments adopted, which rejected, why

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

// ---------- Synthesis Balance Score ----------

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 4);
}

export function computeSynthesisBalance(
  proposals: Proposal[],
  synthesisContent: string
): SynthesisBalance {
  const synthesisWords = new Set(extractKeywords(synthesisContent));
  const N = proposals.length;

  // For each proposal, count how many of its keywords appear in the synthesis
  const coverageRaw = proposals.map(p => {
    const kw = extractKeywords(p.content);
    if (kw.length === 0) return { model: p.model, hits: 0, total: 0 };
    const hits = kw.filter(w => synthesisWords.has(w)).length;
    return { model: p.model, hits, total: kw.length };
  });

  const coverageScores = coverageRaw.map(c => (c.total > 0 ? c.hits / c.total : 0));
  const totalCoverage = coverageScores.reduce((a, b) => a + b, 0);

  // Share = fraction of total coverage this generator owns
  const shares = coverageScores.map(c => (totalCoverage > 0 ? c / totalCoverage : 1 / N));

  // Balance score: 1 - mean absolute deviation from ideal (1/N each)
  const ideal = 1 / N;
  const mad = shares.reduce((a, s) => a + Math.abs(s - ideal), 0) / N;
  const score = Math.max(0, 1 - mad / ideal);

  // Domination check: any generator with share > 0.6?
  // Per Perplexity critique: dominance at high evaluation score is legitimate.
  // Flag only when dominance is combined with low coverage of other generators.
  let dominated_by: string | undefined;
  let dominance_justified = false;
  shares.forEach((s, i) => {
    if (s > 0.6) {
      dominated_by = proposals[i].model;
      // If the other generators have very low coverage (<0.15 each),
      // the synthesizer likely had good reason (weak arguments).
      // Mark as potentially justified.
      const othersAvg = shares
        .filter((_, j) => j !== i)
        .reduce((a, b) => a + b, 0) / (N - 1);
      dominance_justified = othersAvg < 0.15;
    }
  });

  const details = proposals.map((p, i) => ({
    generator: p.model,
    coverage: coverageScores[i],
    share: shares[i],
  }));

  return {
    score: parseFloat(score.toFixed(4)),
    generator_coverage: details,
    dominated_by,
    dominance_justified,
    warning: !!dominated_by && !dominance_justified,
  };
}

// ---------- Synthesis Verification (dual-run) ----------

export function computeSynthesisSimilarity(a: string, b: string): number {
  const setA = new Set(extractKeywords(a));
  const setB = new Set(extractKeywords(b));
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export async function runDualSynthesizer(
  primaryProvider: Provider,
  primaryModel: string,
  secondaryProvider: Provider,
  secondaryModel: string,
  proposals: Proposal[],
  critique: Critique,
  language: 'de' | 'en' = 'de',
  contextText?: string
): Promise<{ primary: Synthesis; verification: SynthesisVerification }> {
  const primary = await runSynthesizer(
    primaryProvider, primaryModel, proposals, critique, language, false, contextText
  );
  const secondary = await runSynthesizer(
    secondaryProvider, secondaryModel, proposals, critique, language, false, contextText
  );

  const similarity = computeSynthesisSimilarity(primary.content, secondary.content);
  const CONVERGE_THRESHOLD = 0.35;
  const verified = similarity >= CONVERGE_THRESHOLD;
  const diverged = !verified;

  const verification: SynthesisVerification = {
    verified,
    diverged,
    similarity_score: parseFloat(similarity.toFixed(4)),
    alt_model: secondary.model,
    ...(diverged ? { alt_synthesis: secondary.content } : {}),
  };

  return { primary, verification };
}

// ---------- Core runSynthesizer ----------

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
