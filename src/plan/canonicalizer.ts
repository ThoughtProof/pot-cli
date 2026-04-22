/**
 * Milestone A canonicalizer — GAIA trace → PlanRecord.
 *
 * Extraction strategy:
 *   1. Walk the nested span tree into a flat ordered list.
 *   2. Pull goal / annotator steps from `get_examples_to_answer` log output.
 *   3. Pull agent fact-survey from the first LiteLLMModel.__call__ under CodeAgent.run.
 *   4. Pull agent plan from the second LiteLLMModel.__call__ under CodeAgent.run.
 *   5. Pull execution steps from CodeAgent.run child spans.
 *   6. Pull final answer from FinalAnswerTool span.
 *   7. Build sequential edges and information-flow edges (inferred).
 *   8. Flag answer mismatch as a RiskFlag.
 *
 * Every extracted value carries explicit Provenance (origin, sourceEvidence, confidence).
 */

import type {
  GaiaTrace,
  GaiaTraceSpan,
  GaiaExample,
} from './gaia-trace-types.js';
import type {
  PlanRecord,
  GoalNode,
  PlanStep,
  PlanEdge,
  InformationFlow,
  RiskFlag,
  Provenance,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Flatten a nested span tree into an ordered list (depth-first pre-order). */
function flattenSpans(span: GaiaTraceSpan): GaiaTraceSpan[] {
  const result: GaiaTraceSpan[] = [span];
  for (const child of span.child_spans) {
    result.push(...flattenSpans(child));
  }
  return result;
}

/** Return all spans matching a predicate. */
function findSpans(
  all: GaiaTraceSpan[],
  predicate: (s: GaiaTraceSpan) => boolean,
): GaiaTraceSpan[] {
  return all.filter(predicate);
}

/**
 * Parse ISO 8601 duration string into seconds.
 * Handles the subset used by Patronus plus optional day/hour components.
 */
function parseDurationSeconds(iso: string): number | null {
  // e.g. "PT1M48.75533S", "PT0.015362S", or "P1DT30M"
  const m = iso.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (!m) return null;
  const days = parseFloat(m[1] ?? '0');
  const hours = parseFloat(m[2] ?? '0');
  const minutes = parseFloat(m[3] ?? '0');
  const seconds = parseFloat(m[4] ?? '0');
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/** Get a string span attribute, or undefined. */
function strAttr(span: GaiaTraceSpan, key: string): string | undefined {
  const v = span.span_attributes[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Parse annotator steps text like:
 *   "1. Search the web for ...\n2. Note the results ...\n..."
 * into an array of step description strings.
 */
function parseAnnotatorSteps(stepsText: string): string[] {
  return stepsText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Parse agent plan text (numbered list, possibly with extra blank lines).
 * Returns step descriptions without the leading numbers.
 */
function parseAgentPlanSteps(planText: string): string[] {
  return planText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter((line) => line.length > 0 && /^\S/.test(line));
}

/** Cheap tool-name extractor from a description string. */
function extractToolNames(desc: string): string[] {
  const normalized = desc.toLowerCase();
  const known = [
    'search engine',
    'web browser',
    'python_interpreter',
    'final_answer',
    'visualizer',
    'inspect_file_as_text',
    'search_agent',
  ];

  const matches = new Set(
    known.filter((t) => normalized.includes(t.toLowerCase())),
  );

  for (const token of desc.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/gi) ?? []) {
    matches.add(token.toLowerCase());
  }

  for (const token of desc.match(/\b[A-Z][A-Za-z0-9]+Tool\b/g) ?? []) {
    matches.add(token.replace(/Tool$/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
  }

  return Array.from(matches);
}

function resolveAgentAnswer(rawInput: string): string {
  try {
    const parsed = JSON.parse(rawInput) as { args?: unknown[] };
    if (Array.isArray(parsed.args)) {
      return String(parsed.args[0] ?? rawInput);
    }
  } catch {
    // leave as-is
  }
  return rawInput;
}

function selectPlanLlmSpan(
  llmCallsUnderAgent: GaiaTraceSpan[],
): { span?: GaiaTraceSpan; selection: 'prompt_match' | 'last_llm_call' | 'missing' } {
  const promptMatched = llmCallsUnderAgent.find((s) => {
    const inputMessage = strAttr(s, 'llm.input_messages.0.message.content') ?? '';
    return inputMessage.includes('step-by-step high-level plan');
  });

  if (promptMatched) {
    return { span: promptMatched, selection: 'prompt_match' };
  }

  if (llmCallsUnderAgent.length > 0) {
    return {
      span: llmCallsUnderAgent[llmCallsUnderAgent.length - 1],
      selection: 'last_llm_call',
    };
  }

  return { selection: 'missing' };
}

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

export interface CanonicalizeOptions {
  /** ISO 8601 timestamp for `extractedAt`; defaults to now. */
  extractedAt?: string;
}

export function canonicalizeGaiaTrace(
  trace: GaiaTrace,
  options: CanonicalizeOptions = {},
): PlanRecord {
  const extractedAt = options.extractedAt ?? new Date().toISOString();
  const allSpans = trace.spans.flatMap(flattenSpans);

  // -------------------------------------------------------------------------
  // 1. Goal — from get_examples_to_answer log output
  // -------------------------------------------------------------------------
  const getExamplesSpan = findSpans(
    allSpans,
    (s) => s.span_name === 'get_examples_to_answer',
  )[0];

  let goal: GoalNode;

  if (getExamplesSpan) {
    const log = getExamplesSpan.logs[0];
    const examples = log?.body?.['function.output'];
    const example = (
      Array.isArray(examples) ? examples[0] : examples
    ) as GaiaExample | undefined;

    const question = example?.question ?? '[unknown question]';
    const taskId = example?.task_id ?? trace.trace_id;
    const trueAnswer = example?.true_answer;

    const prov: Provenance = {
      origin: 'explicit',
      sourceEvidence: `span:${getExamplesSpan.span_id} → logs[0].body.function.output[0]`,
      confidence: 1.0,
    };

    goal = {
      id: `goal:${taskId}`,
      description: question,
      taskId,
      trueAnswer,
      provenance: prov,
    };
  } else {
    // Fallback: no question found
    goal = {
      id: `goal:${trace.trace_id}`,
      description: '[question not found in trace]',
      taskId: trace.trace_id,
      provenance: {
        origin: 'inferred',
        sourceEvidence: 'trace top-level — get_examples_to_answer span missing',
        confidence: 0.1,
      },
    };
  }

  // -------------------------------------------------------------------------
  // 2. Annotator steps — from Annotator Metadata in get_examples_to_answer
  // -------------------------------------------------------------------------
  const steps: PlanStep[] = [];
  const riskFlags: RiskFlag[] = [];

  let annotatorStepCount = 0;
  let annotatorToolCount = 0;

  if (getExamplesSpan) {
    const log = getExamplesSpan.logs[0];
    const examples = log?.body?.['function.output'];
    const example = (
      Array.isArray(examples) ? examples[0] : examples
    ) as GaiaExample | undefined;

    const meta = example?.['Annotator Metadata'];
    if (meta) {
      const declaredAnnotatorStepCount = parseInt(meta['Number of steps'] ?? '0', 10) || 0;
      annotatorStepCount = declaredAnnotatorStepCount;
      annotatorToolCount = parseInt(meta['Number of tools'] ?? '0', 10) || 0;

      if (meta.Steps) {
        const parsed = parseAnnotatorSteps(meta.Steps);
        if (parsed.length > 0) {
          annotatorStepCount = parsed.length;
        }

        if (
          declaredAnnotatorStepCount > 0 &&
          parsed.length > 0 &&
          parsed.length !== declaredAnnotatorStepCount
        ) {
          riskFlags.push({
            id: 'risk:annotator_step_count_mismatch',
            type: 'gap',
            description:
              `Annotator Metadata.Number of steps declared ${declaredAnnotatorStepCount}, ` +
              `but parsed annotator steps text yielded ${parsed.length}`,
            severity: 'low',
            provenance: {
              origin: 'inferred',
              sourceEvidence:
                `span:${getExamplesSpan.span_id} → Annotator Metadata.Number of steps vs. Annotator Metadata.Steps text parsing`,
              confidence: 0.8,
            },
          });
        }

        for (let i = 0; i < parsed.length; i++) {
          const desc = parsed[i];
          steps.push({
            id: `annotator:step:${i + 1}`,
            group: 'annotator',
            index: i + 1,
            description: desc,
            toolsUsed: extractToolNames(desc),
            provenance: {
              origin: 'annotator',
              sourceEvidence: `span:${getExamplesSpan.span_id} → logs[0].body.function.output[0].Annotator Metadata.Steps[${i}]`,
              confidence: 1.0,
            },
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Agent plan steps — from the planning LiteLLMModel.__call__ span
  //    (the one whose input contains "[PLAN]" or whose prior sibling call
  //     already produced facts; identified heuristically as the 2nd LLM call
  //     under CodeAgent.run)
  // -------------------------------------------------------------------------
  const codeAgentSpan = findSpans(allSpans, (s) => s.span_name === 'CodeAgent.run')[0];

  // LLM calls directly under CodeAgent.run, in source order
  const llmCallsUnderAgent: GaiaTraceSpan[] = codeAgentSpan
    ? codeAgentSpan.child_spans.filter((c) =>
        c.span_name === 'LiteLLMModel.__call__',
      )
    : [];

  const factsSurveySpan = llmCallsUnderAgent[0];
  let factsSurveyStepId: string | undefined;

  if (factsSurveySpan) {
    const factsText =
      strAttr(factsSurveySpan, 'llm.output_messages.0.message.content') ?? '';
    factsSurveyStepId = `agent:plan:facts:${factsSurveySpan.span_id}`;
    steps.push({
      id: factsSurveyStepId,
      group: 'agent:plan',
      index: 1,
      description: `Fact survey before plan generation: ${factsText.slice(0, 120)}`,
      toolsUsed: [],
      spanId: factsSurveySpan.span_id,
      provenance: {
        origin: 'explicit',
        sourceEvidence: `span:${factsSurveySpan.span_id} → span_attributes.llm.output_messages.0.message.content`,
        confidence: 0.95,
      },
    });
  }

  // The planning call is ideally identified by a plan-specific prompt.
  // If that fails, fall back to the last LLM call under CodeAgent.run.
  const planSpanSelection = selectPlanLlmSpan(llmCallsUnderAgent);
  const planLlmSpan = planSpanSelection.span;

  if (planLlmSpan) {
    const planText =
      strAttr(planLlmSpan, 'llm.output_messages.0.message.content') ?? '';
    const parsed = parseAgentPlanSteps(planText);
    for (let i = 0; i < parsed.length; i++) {
      const desc = parsed[i];
      steps.push({
        id: `agent:plan:step:${i + 1}`,
        group: 'agent:plan',
        index: i + 1 + (factsSurveyStepId ? 1 : 0),
        description: desc,
        toolsUsed: extractToolNames(desc),
        spanId: planLlmSpan.span_id,
        provenance: {
          origin:
            planSpanSelection.selection === 'prompt_match' ? 'explicit' : 'inferred',
          sourceEvidence:
            `span:${planLlmSpan.span_id} → span_attributes.llm.output_messages.0.message.content[plan_step:${i}]` +
            (planSpanSelection.selection === 'prompt_match'
              ? ''
              : ' (plan span selected via fallback to last LLM call under CodeAgent.run)'),
          confidence:
            planSpanSelection.selection === 'prompt_match' ? 0.95 : 0.75,
        },
      });
    }

    if (planSpanSelection.selection !== 'prompt_match') {
      riskFlags.push({
        id: 'risk:plan_span_fallback',
        type: 'gap',
        description:
          'Plan LLM span was selected via fallback heuristic instead of direct prompt match',
        severity: 'medium',
        provenance: {
          origin: 'inferred',
          sourceEvidence:
            'CodeAgent.run child LLM calls lacked direct plan-prompt match; using last LLM call heuristic',
          confidence: 0.75,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Execution steps — from CodeAgent.run child spans (Step N, FinalAnswerTool)
  // -------------------------------------------------------------------------
  const executionStepSpans = codeAgentSpan
    ? codeAgentSpan.child_spans.filter(
        (c) => c.span_name.startsWith('Step ') || c.span_name === 'FinalAnswerTool',
      )
    : [];

  for (let i = 0; i < executionStepSpans.length; i++) {
    const s = executionStepSpans[i];
    const outputVal = strAttr(s, 'output.value') ?? '';
    const inputVal = strAttr(s, 'input.value') ?? '';

    let desc: string;
    let tools: string[];
    if (s.span_name === 'FinalAnswerTool') {
      desc = `Submit final answer via FinalAnswerTool → ${outputVal || inputVal}`;
      tools = ['final_answer'];
    } else {
      // Enrich description with the agent's Thought text from the LLM call within this step.
      // The thought is far more semantically rich than the raw output value, enabling better
      // lexical alignment against annotator steps.
      const llmChild = s.child_spans.find((c) => c.span_name === 'LiteLLMModel.__call__');
      const thoughtText = llmChild
        ? (strAttr(llmChild, 'llm.output_messages.0.message.content') ?? '').slice(0, 300)
        : '';
      desc = thoughtText
        ? `Execution ${s.span_name}: ${thoughtText}`
        : `Execution ${s.span_name}: output = ${outputVal.slice(0, 120)}`;
      // Extract tool names from TOOL-kind child spans (non-LLM tool calls within this step).
      tools = s.child_spans
        .filter((c) => c.span_kind === 'TOOL' && c.span_name !== 'FinalAnswerTool')
        .map((c) => c.span_name.toLowerCase().replace(/\s+/g, '_'));
    }

    steps.push({
      id: `agent:exec:${s.span_id}`,
      group: 'agent:exec',
      index: i + 1,
      description: desc,
      toolsUsed: tools,
      spanId: s.span_id,
      provenance: {
        origin: 'explicit',
        sourceEvidence: `span:${s.span_id} → span_attributes.output.value`,
        confidence: 0.98,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 5. Edges — sequential between plan steps of the same group
  // -------------------------------------------------------------------------
  const edges: PlanEdge[] = [];

  function buildSequentialEdges(
    group: PlanStep[],
    edgeIdPrefix: string,
  ): void {
    for (let i = 0; i < group.length - 1; i++) {
      edges.push({
        id: `${edgeIdPrefix}:edge:${i + 1}`,
        from: group[i].id,
        to: group[i + 1].id,
        type: 'sequential',
        provenance: {
          origin: 'inferred',
          sourceEvidence: `sequential ordering of ${edgeIdPrefix} steps`,
          confidence: 0.9,
        },
      });
    }
  }

  const annotatorSteps = steps.filter((s) => s.group === 'annotator');
  const agentPlanSteps = steps.filter((s) => s.group === 'agent:plan');
  const agentExecSteps = steps.filter((s) => s.group === 'agent:exec');

  buildSequentialEdges(annotatorSteps, 'annotator');
  buildSequentialEdges(agentPlanSteps, 'agent:plan');
  buildSequentialEdges(agentExecSteps, 'agent:exec');

  // -------------------------------------------------------------------------
  // 6. Information flows
  // -------------------------------------------------------------------------
  const informationFlows: InformationFlow[] = [];

  // Facts survey → first actual plan step
  if (factsSurveySpan && factsSurveyStepId && agentPlanSteps.length > 1) {
    const factsText =
      strAttr(factsSurveySpan, 'llm.output_messages.0.message.content') ?? '';
    informationFlows.push({
      id: 'flow:facts:to:plan',
      fromStep: factsSurveyStepId,
      toStep:
        agentPlanSteps.find((s) => s.id !== factsSurveyStepId)?.id ??
        agentPlanSteps[0].id,
      description: 'Facts survey injects task knowledge before plan generation',
      value: factsText.slice(0, 300),
      provenance: {
        origin: 'explicit',
        sourceEvidence: `span:${factsSurveySpan.span_id} → llm.output_messages.0.message.content`,
        confidence: 0.95,
      },
    });
  }

  // Agent plan → execution
  if (agentPlanSteps.length > 0 && agentExecSteps.length > 0) {
    informationFlows.push({
      id: 'flow:plan:to:exec',
      fromStep: agentPlanSteps[0].id,
      toStep: agentExecSteps[0].id,
      description: 'Agent plan guides execution steps',
      provenance: {
        origin: 'inferred',
        sourceEvidence:
          'plan text injected as [PLAN] in Step 1 LLM input messages',
        confidence: 0.9,
      },
    });
  }

  // Execution → final answer
  const finalAnswerSpan = findSpans(allSpans, (s) => s.span_name === 'FinalAnswerTool')[0];
  const finalAnswerExecStep = agentExecSteps.find(
    (s) => s.spanId === finalAnswerSpan?.span_id,
  );

  if (finalAnswerSpan && agentExecSteps.length > 0) {
    const rawInput = strAttr(finalAnswerSpan, 'input.value') ?? '';
    const agentAnswerValue = resolveAgentAnswer(rawInput);

    informationFlows.push({
      id: 'flow:exec:to:final_answer',
      fromStep: finalAnswerExecStep?.id ?? agentExecSteps[agentExecSteps.length - 1].id,
      toStep: 'final_answer',
      description: 'Execution produces final answer submitted by FinalAnswerTool',
      value: agentAnswerValue,
      provenance: {
        origin: 'explicit',
        sourceEvidence: `span:${finalAnswerSpan.span_id} → span_attributes.input.value`,
        confidence: 0.99,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 7. Risk flags
  // -------------------------------------------------------------------------

  // Resolve agent answer
  let agentAnswer = '';
  if (finalAnswerSpan) {
    const rawInput = strAttr(finalAnswerSpan, 'input.value') ?? '';
    agentAnswer = resolveAgentAnswer(rawInput);
  }
  // Also check CodeAgent.run output as a fallback
  if (!agentAnswer && codeAgentSpan) {
    agentAnswer = strAttr(codeAgentSpan, 'output.value') ?? '';
  }

  const trueAnswer = goal.trueAnswer ?? '';
  const verified =
    trueAnswer !== '' &&
    agentAnswer.trim().toLowerCase() === trueAnswer.trim().toLowerCase();

  if (!verified && trueAnswer !== '') {
    riskFlags.push({
      id: 'risk:wrong_answer',
      type: 'wrong_answer',
      description: `Agent answered "${agentAnswer}" but ground truth is "${trueAnswer}"`,
      severity: 'high',
      provenance: {
        origin: 'inferred',
        sourceEvidence:
          `normalized final answer comparison: span:${finalAnswerSpan?.span_id ?? 'unknown'} → input.value vs. get_examples_to_answer true_answer`,
        confidence: 0.7,
      },
    });
  }

  // Gap: agent used fewer steps than annotator
  const agentStepSpans = findSpans(
    allSpans,
    (s) => s.span_name.startsWith('Step '),
  );
  if (agentStepSpans.length < annotatorStepCount && annotatorStepCount > 0) {
    riskFlags.push({
      id: 'risk:fewer_steps',
      type: 'missing_step',
      description: `Agent executed ${agentStepSpans.length} step(s); annotator solution required ${annotatorStepCount}`,
      severity: 'medium',
      provenance: {
        origin: 'inferred',
        sourceEvidence:
          'count of Step N child spans vs. Annotator Metadata.Number of steps',
        confidence: 0.85,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 8. Metadata
  // -------------------------------------------------------------------------
  const mainSpan = trace.spans[0];
  const totalDurationSeconds = mainSpan
    ? parseDurationSeconds(mainSpan.duration)
    : null;

  const agentModel =
    (codeAgentSpan ? strAttr(
      llmCallsUnderAgent[0],
      'llm.model_name',
    ) : undefined) ?? 'unknown';

  return {
    id: `plan:${trace.trace_id}`,
    traceId: trace.trace_id,
    extractedAt,
    goal,
    steps,
    edges,
    informationFlows,
    riskFlags,
    metadata: {
      agentModel,
      agentAnswer,
      annotatorStepCount,
      annotatorToolCount,
      totalDurationSeconds: totalDurationSeconds ?? 0,
      verified,
    },
  };
}

export { flattenSpans, parseDurationSeconds, resolveAgentAnswer, selectPlanLlmSpan };
