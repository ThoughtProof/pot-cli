import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import type { FirstPartyGaiaTrace, FirstPartyTraceStep } from './first-party-adapter.js';

type TraceKind = FirstPartyTraceStep['kind'];

interface GaiaSampleInput {
  task_id: string;
  level?: string | number;
  Level?: string | number;
  Question?: string;
  question?: string;
  Final_answer?: string | null;
  'Final answer'?: string | null;
  final_answer?: string | null;
  ground_truth?: string | null;
  file_path?: string | null;
  attachments?: Array<{ path: string; kind?: string | null }>;
  Annotator_Metadata?: Record<string, unknown> | null;
  annotator_metadata?: Record<string, unknown> | null;
  'Annotator Metadata'?: Record<string, unknown> | null;
}

interface NormalizedGaiaSample {
  task_id: string;
  level: string | number;
  question: string;
  groundTruth?: string;
  attachments?: Array<{ path: string; kind?: string | null }>;
  annotatorMetadata?: Record<string, unknown>;
}

interface GeneratedTracePayload {
  answer: string;
  steps: Array<{
    index?: number;
    kind?: string;
    tool?: string | null;
    summary?: string;
    evidence?: string[];
  }>;
  notes?: string;
}

interface NormalizedGeneratedTracePayload {
  answer: string;
  steps: FirstPartyTraceStep[];
  notes?: string;
}

interface OpenAiChatCompletionResponse {
  choices: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface AnthropicMessageResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface GeneratedFirstPartyTrace {
  trace: FirstPartyGaiaTrace;
  tokenUsage: TokenUsage;
}

interface GeneratorOptions {
  inputPath: string;
  outputPath: string;
  limit?: number;
  offset: number;
  model: string;
  provider: 'anthropic' | 'openai';
  apiKey: string;
  delayMs: number;
  resume: boolean;
  overwrite: boolean;
}

const SYSTEM_PROMPT = `You are an autonomous AI agent solving a GAIA-style task.
Return EXCLUSIVELY valid JSON matching this schema:
{
  "answer": "the final answer you would submit",
  "steps": [
    {
      "index": 1,
      "kind": "observe|search|browse|read|reason|calculate|answer",
      "tool": "web_search|web_fetch|browser|internal|python|calculator|null",
      "summary": "what you did in this step, written as a concise past-tense trace line",
      "evidence": ["optional short fact or artifact used in this step"]
    }
  ],
  "notes": "optional short note about assumptions or uncertainty"
}
Rules:
- Keep the plan realistic and moderately compressed, like a real agent trace.
- Use 2-6 steps unless the task truly needs more.
- Always include a final answer string.
- Always include an answer step as the final step.
- No markdown, no commentary outside the JSON.`;

export function normalizeGaiaSample(sample: GaiaSampleInput): NormalizedGaiaSample {
  const question = sample.question ?? sample.Question;
  if (!sample.task_id || !question) {
    throw new Error(`Invalid GAIA sample, missing task_id or question: ${JSON.stringify(sample)}`);
  }

  const groundTruth = sample.ground_truth ?? sample.Final_answer ?? sample['Final answer'] ?? sample.final_answer ?? undefined;
  const attachments = sample.attachments
    ?? (sample.file_path ? [{ path: sample.file_path }] : undefined);
  const annotatorMetadata = sample.annotator_metadata
    ?? sample.Annotator_Metadata
    ?? (sample['Annotator Metadata'] as Record<string, unknown> | undefined)
    ?? undefined;

  return {
    task_id: sample.task_id,
    level: sample.level ?? sample.Level ?? 'unknown',
    question,
    groundTruth: groundTruth ?? undefined,
    attachments,
    annotatorMetadata: annotatorMetadata ?? undefined,
  };
}

function normalizeComparableAnswer(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeKind(kind: string | undefined): TraceKind {
  const normalized = (kind ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'observe':
    case 'search':
    case 'browse':
    case 'read':
    case 'reason':
    case 'calculate':
    case 'answer':
      return normalized;
    default:
      return 'reason';
  }
}

function normalizeTool(tool: string | null | undefined): string | null {
  if (!tool) return null;
  const normalized = tool.trim();
  return normalized.length > 0 ? normalized : null;
}

export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedJson?.[1]) {
    return extractJsonObject(fencedJson[1]);
  }

  const directJson = trimmed.match(/\{[\s\S]*\}$/);
  if (directJson) {
    return directJson[0];
  }

  throw new Error(`Model response did not contain a JSON object: ${raw.slice(0, 200)}`);
}

export function coerceGeneratedTracePayload(payload: GeneratedTracePayload): NormalizedGeneratedTracePayload {
  const rawSteps = Array.isArray(payload.steps) ? payload.steps : [];
  const coercedSteps: FirstPartyTraceStep[] = rawSteps
    .filter((step) => step && typeof step.summary === 'string' && step.summary.trim().length > 0)
    .map((step, index) => ({
      index: step.index ?? index + 1,
      kind: normalizeKind(step.kind),
      tool: normalizeTool(step.tool),
      summary: step.summary!.trim(),
      evidence: Array.isArray(step.evidence) ? step.evidence.filter((item) => typeof item === 'string' && item.trim().length > 0) : undefined,
    }))
    .sort((a, b) => a.index - b.index)
    .map((step, index) => ({ ...step, index: index + 1 }));

  const answer = String(payload.answer ?? '').trim();
  const finalAnswer = answer || 'Unable to determine a final answer.';

  const hasAnswerStep = coercedSteps.at(-1)?.kind === 'answer';
  if (!hasAnswerStep) {
    coercedSteps.push({
      index: coercedSteps.length + 1,
      kind: 'answer',
      tool: null,
      summary: `Submitted the final answer: ${finalAnswer}`,
    });
  }

  return {
    answer: finalAnswer,
    notes: payload.notes?.trim() || undefined,
    steps: coercedSteps,
  };
}

export function buildFirstPartyTrace(
  sample: NormalizedGaiaSample,
  payload: GeneratedTracePayload,
  model: string,
): FirstPartyGaiaTrace {
  const normalized = coerceGeneratedTracePayload(payload);
  const finalCorrect = sample.groundTruth
    ? normalizeComparableAnswer(normalized.answer) === normalizeComparableAnswer(sample.groundTruth)
    : undefined;

  return {
    task_id: sample.task_id,
    level: sample.level,
    question: sample.question,
    model,
    answer: normalized.answer,
    ground_truth: sample.groundTruth,
    final_correct: finalCorrect,
    attachments: sample.attachments,
    annotator_metadata: sample.annotatorMetadata,
    trace: {
      steps: normalized.steps,
      notes: normalized.notes,
    },
  };
}

function buildUserPrompt(sample: NormalizedGaiaSample): string {
  const attachmentLines = sample.attachments?.length
    ? `Attachments:\n${sample.attachments.map((attachment) => `- ${attachment.path}`).join('\n')}\n\n`
    : '';

  return `Task ID: ${sample.task_id}\nLevel: ${sample.level}\n\nQuestion: ${sample.question}\n\n${attachmentLines}Produce a realistic compressed agent trace for this task.`;
}

async function callOpenAiModel(sample: NormalizedGaiaSample, model: string, apiKey: string): Promise<{ payload: GeneratedTracePayload; usage: TokenUsage }> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(sample) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API Error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as OpenAiChatCompletionResponse;
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI API returned no message content.');
  }

  return {
    payload: JSON.parse(extractJsonObject(content)) as GeneratedTracePayload,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

async function callAnthropicModel(sample: NormalizedGaiaSample, model: string, apiKey: string): Promise<{ payload: GeneratedTracePayload; usage: TokenUsage }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildUserPrompt(sample) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API Error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as AnthropicMessageResponse;
  const content = Array.isArray(data.content)
    ? data.content.map((item) => item.text).find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined;
  if (!content) {
    throw new Error(`Anthropic API returned no text content. Raw content: ${JSON.stringify(data.content ?? null).slice(0, 300)}`);
  }

  return {
    payload: JSON.parse(extractJsonObject(content)) as GeneratedTracePayload,
    usage: {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
    },
  };
}

export async function generateTraceForQuestion(
  sample: NormalizedGaiaSample,
  options: Pick<GeneratorOptions, 'apiKey' | 'model' | 'provider'>,
): Promise<GeneratedFirstPartyTrace> {
  const result = options.provider === 'anthropic'
    ? await callAnthropicModel(sample, options.model, options.apiKey)
    : await callOpenAiModel(sample, options.model, options.apiKey);

  return {
    trace: buildFirstPartyTrace(sample, result.payload, options.model),
    tokenUsage: result.usage,
  };
}

function readExistingTaskIds(outputPath: string): Set<string> {
  if (!fs.existsSync(outputPath)) {
    return new Set<string>();
  }

  const raw = fs.readFileSync(outputPath, 'utf8');
  const taskIds = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { task_id?: string })
    .map((item) => item.task_id)
    .filter((taskId): taskId is string => typeof taskId === 'string');

  return new Set(taskIds);
}

function resolveGeneratorOptions(): GeneratorOptions {
  const args = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      limit: { type: 'string' },
      offset: { type: 'string', default: '0' },
      delayMs: { type: 'string', default: '1200' },
      model: { type: 'string' },
      provider: { type: 'string' },
      resume: { type: 'boolean', default: false },
      overwrite: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const defaultInputPath = path.join(process.cwd(), 'src/plan/__fixtures__', 'gaia-samples-input.json');
  const defaultOutputPath = path.join(process.cwd(), 'src/plan/__fixtures__', 'gaia-traces-generated.jsonl');

  const provider = (args.values.provider as 'anthropic' | 'openai' | undefined)
    ?? (process.env.GAIA_TRACE_PROVIDER as 'anthropic' | 'openai' | undefined)
    ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

  const defaultModel = provider === 'anthropic'
    ? (process.env.GAIA_TRACE_MODEL ?? 'claude-sonnet-4-5')
    : (process.env.GAIA_TRACE_MODEL ?? 'gpt-4o');

  const model = args.values.model ?? defaultModel;
  const apiKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(`Please set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} to generate traces.`);
  }

  return {
    inputPath: args.values.input ?? defaultInputPath,
    outputPath: args.values.output ?? defaultOutputPath,
    limit: args.values.limit ? Number(args.values.limit) : undefined,
    offset: Number(args.values.offset ?? '0') || 0,
    model,
    provider,
    apiKey,
    delayMs: Number(args.values.delayMs ?? '1200') || 0,
    resume: Boolean(args.values.resume),
    overwrite: Boolean(args.values.overwrite),
  };
}

function loadSamples(inputPath: string): NormalizedGaiaSample[] {
  const rawSamples = fs.readFileSync(inputPath, 'utf8');
  const samples = JSON.parse(rawSamples) as GaiaSampleInput[];
  return samples.map(normalizeGaiaSample);
}

async function main() {
  const options = resolveGeneratorOptions();
  const allSamples = loadSamples(options.inputPath);
  const slicedSamples = allSamples.slice(options.offset, options.limit ? options.offset + options.limit : undefined);
  const existingTaskIds = options.resume ? readExistingTaskIds(options.outputPath) : new Set<string>();

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  if (options.overwrite && fs.existsSync(options.outputPath)) {
    fs.writeFileSync(options.outputPath, '');
  }

  console.log(`Starting trace generation for ${slicedSamples.length} sample(s) via ${options.provider}:${options.model}`);

  for (const sample of slicedSamples) {
    if (existingTaskIds.has(sample.task_id)) {
      console.log(`↷ Skipping existing trace ${sample.task_id}`);
      continue;
    }

    console.log(`Processing ${sample.task_id}`);
    try {
      const result = await generateTraceForQuestion(sample, options);
      fs.appendFileSync(options.outputPath, JSON.stringify(result.trace) + '\n');
      console.log(
        `✅ Saved ${sample.task_id} (${result.tokenUsage.prompt_tokens} in / ${result.tokenUsage.completion_tokens} out)`,
      );
    } catch (error) {
      console.error(`Failed to generate trace for ${sample.task_id}:`, error);
    }

    if (options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  console.log(`Generation complete. Data saved to ${options.outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
