/**
 * Raw shape of a GAIA OpenTelemetry trace as produced by the Patronus SDK.
 * These types mirror the actual JSON — no transformation yet.
 */

export interface GaiaTraceLogBody {
  'function.name': string;
  'function.arguments': Record<string, unknown>;
  'function.output': unknown;
}

export interface GaiaTraceLog {
  timestamp: string;
  trace_id: string;
  span_id: string;
  trace_flags: number;
  severity_text: string;
  severity_number: number;
  service_name: string;
  body: GaiaTraceLogBody;
  resource_schema_url: string;
  resource_attributes: Record<string, string>;
  scope_schema_url: string;
  scope_name: string;
  scope_version: string;
  scope_attributes: Record<string, string>;
  log_attributes: Record<string, string>;
  evaluations: unknown[];
  annotations: unknown[];
}

export interface GaiaTraceSpan {
  timestamp: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  trace_state: string;
  span_name: string;
  span_kind: 'Internal' | 'LLM' | 'AGENT' | 'CHAIN' | 'TOOL' | string;
  service_name: string;
  resource_attributes: Record<string, string>;
  scope_name: string;
  scope_version: string;
  span_attributes: Record<string, unknown>;
  duration: string; // ISO 8601 duration, e.g. "PT1M48.75533S"
  status_code: string;
  status_message: string;
  events: unknown[];
  links: unknown[];
  logs: GaiaTraceLog[];
  child_spans: GaiaTraceSpan[];
}

export interface GaiaTrace {
  trace_id: string;
  spans: GaiaTraceSpan[];
}

// ---------------------------------------------------------------------------
// Helpers for known annotator metadata shape
// ---------------------------------------------------------------------------

export interface GaiaAnnotatorMetadata {
  'How long did this take?': string;
  'Number of steps': string;
  'Number of tools': string;
  Steps: string;
  Tools: string;
}

export interface GaiaExample {
  task_id: string;
  question: string;
  task: string;
  true_answer: string;
  file_name: string;
  file_path: string;
  'Annotator Metadata': GaiaAnnotatorMetadata;
}
