import { Provider, Proposal } from '../types.js';

const GENERATOR_PROMPT_DE = `Du bist ein unabhängiger Analyst. Beantworte diese Frage mit einer konkreten Position.

{context}

REGELN:
- Leg dich fest. Keine "es kommt drauf an" ohne konkrete Bedingungen
- Nenne Zahlen wo möglich
- Sag was schiefgehen kann
- Max 500 Wörter

FRAGE: {question}`;

const GENERATOR_PROMPT_EN = `You are an independent analyst. Answer this question with a concrete position.

{context}

RULES:
- Take a stand. No "it depends" without concrete conditions
- Provide numbers where possible
- Say what can go wrong
- Max 500 words

QUESTION: {question}`;

export async function runGenerator(
  provider: Provider,
  model: string,
  question: string,
  language: 'de' | 'en' = 'de',
  dryRun: boolean = false,
  contextText?: string
): Promise<Proposal> {
  if (dryRun) {
    return {
      model: model.split('/').pop() || model,
      role: 'generator',
      content: `[DRY-RUN] Simulated response from ${model} for question: "${question}"\n\nThis is a placeholder response that would contain the actual analysis.`,
    };
  }

  const template = language === 'de' ? GENERATOR_PROMPT_DE : GENERATOR_PROMPT_EN;
  const contextSection = contextText || '';
  const prompt = template
    .replace('{context}', contextSection)
    .replace('{question}', question);

  const response = await provider.call(model, prompt);

  return {
    model: model.split('/').pop() || model,
    role: 'generator',
    content: response.content,
  };
}

export async function runGenerators(
  providers: { provider: Provider; model: string }[],
  question: string,
  language: 'de' | 'en' = 'de',
  dryRun: boolean = false,
  contextText?: string
): Promise<Proposal[]> {
  const promises = providers.map(({ provider, model }) =>
    runGenerator(provider, model, question, language, dryRun, contextText)
      .catch((error: Error) => ({
        model: model.split('/').pop() || model,
        role: 'generator' as const,
        content: `[ERROR] ${provider.name} (${model}) failed: ${error.message}`,
      }))
  );

  const results = await Promise.all(promises);
  const successful = results.filter(r => !r.content.startsWith('[ERROR]'));
  
  if (successful.length === 0) {
    throw new Error('All generators failed. Check API keys and connectivity.');
  }
  
  return results;
}
