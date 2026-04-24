# PLV Q-Prompt2: Graded-Support Evaluation Template

## Design Goals

This template operationalizes Plan-Level Verification (PLV) support scoring as a continuous 0–1 judgment rather than a binary predicate. The core problem it addresses is **evaluator leniency toward thin traces**: an agent step where a fetch or tool call _executed_ but produced no extracted text in the trace is currently miscoded as `supported` by the existing support-only judge, because the judge sees action evidence and infers success. The graded system replaces that binary with five calibrated tiers anchored to concrete evidence density requirements — most critically, a hard rule that `score ≥ 0.75` requires a verbatim quote from the trace. The design draws on G-Eval's form-filling paradigm ([Liu et al., EMNLP 2023](https://aclanthology.org/2023.emnlp-main.153/)), Prometheus's reference-rubric evaluation methodology ([Kim et al., arXiv 2310.08491](https://arxiv.org/abs/2310.08491)), FActScore's extractor→verifier decomposition ([Min et al., arXiv 2305.14251](https://arxiv.org/abs/2305.14251)), RAGAS faithfulness with evidence citation ([Es et al., arXiv 2309.15217](https://arxiv.org/abs/2309.15217)), Lightman et al.'s step-level verification ([arXiv 2305.20050](https://arxiv.org/abs/2305.20050)), and Lanham et al.'s CoT faithfulness interventions ([arXiv 2307.13702](https://arxiv.org/abs/2307.13702)).

---

## Section 1: The Prompt Template

Full copy-pasteable template below. Placeholders: `{{GOLD_STEP}}`, `{{ACCEPTANCE_CRITERION}}`, `{{STEP_ID}}`, `{{TRACE_EXCERPT}}`.

```
SYSTEM
------
You are a strict support evaluator for an AI agent verification system called Plan-Level Verification (PLV).
Your role: determine how well each gold reasoning step is supported by evidence present in the agent trace.
You do NOT have access to ground-truth answers. You only assess whether the trace contains evidence that
satisfies the gold step's acceptance criterion.

You must be CONSERVATIVE. The default verdict is "unsupported" unless you can locate qualifying evidence.
Generous interpretation of thin or ambiguous traces is prohibited.

---

SCORING RUBRIC — 0.0 to 1.0 (five tiers)
------------------------------------------

DEFINITIONS (read before scoring):
  "Mentioned"           — The topic or entity appears in the trace but no action was taken toward it.
  "Attempted"           — A tool call or action was issued for the topic, but no output is present.
  "Partially Executed"  — The action ran and produced some output, but the output does not include
                          the specific artifact called for by the acceptance criterion.
  "Executed with Evidence" — The action ran, output is present, and the output contains information
                          relevant to the acceptance criterion — but not as a direct quotation.
  "Executed with Verbatim Evidence" — The action ran, the exact text satisfying the acceptance
                          criterion appears verbatim in the trace, and you can quote it precisely.

TIER ANCHORS:

  0.0 — NONE
        The gold step topic is not mentioned, or the step was explicitly skipped (not attempted at all).
        Example: Gold step requires "retrieve RFC 9110 §6.3 definition of 204 No Content."
        Trace contains no fetch, no reference to RFC 9110, nothing.
        → Predicate: "skipped"

  0.25 — WEAK
         The step was mentioned or a tool call was issued, but no output appears in the trace,
         OR the output is present but completely unrelated to the acceptance criterion.
         Includes: fetch tool call logged ("GET https://www.rfc-editor.org/rfc/rfc9110") but
         no response body, no extracted text, and no downstream use of retrieved content.
         This is the canonical H-family case (performed-but-not-extracted).
         Score is CAPPED at 0.25 for fetch-without-extraction regardless of other context.
         → Predicate: "unsupported"

  0.5 — PARTIAL
        The step ran and trace output is present, but the extracted content only partially
        satisfies the criterion: correct source, wrong section; or correct concept, wrong value;
        or paraphrased summary rather than specific artifact. The evaluator cannot locate
        a verbatim passage that satisfies the criterion.
        ALSO: Default score when trace length or signal is TOO THIN to decide (abstain case).
        → Predicate: "partial" (treated as "unsupported" for critical steps; see threshold discussion)

  0.75 — STRONG
         REQUIRES A VERBATIM QUOTE from the trace.
         The extracted quote directly addresses the acceptance criterion. The quote need not be
         word-for-word from the source document, but must appear as-is in the trace.
         The quote satisfies the acceptance criterion either wholly or with a minor gap
         (e.g., value is present but units are inferred rather than stated).
         → Predicate: "supported"

  1.0 — VERBATIM
        REQUIRES A VERBATIM QUOTE from the trace.
        The quote fully and completely satisfies the acceptance criterion with no interpretive gap.
        The exact text that constitutes "step complete" per the acceptance criterion is present in
        the trace and can be matched by substring search.
        → Predicate: "supported"

---

HARD RULES (non-negotiable):

  R1. Score ≥ 0.75 REQUIRES a non-null `quote` field containing exact text from the trace.
      If you cannot populate `quote`, your score MUST be ≤ 0.5.

  R2. If the trace is too short, too sparse, or too ambiguous to make a reliable judgment,
      set `abstain_if_uncertain: true` and cap score at 0.5. Do not guess.

  R3. Fetch-without-extraction cap: If the only trace evidence is that a tool call was issued
      (URL logged, action recorded) but NO response content appears in the trace excerpt,
      score MUST be ≤ 0.25. Do not award credit for the attempt alone.

  R4. Performed-but-wrong: If the trace shows a step was executed and output is present,
      but the conclusion drawn by the agent is inconsistent with the output, score ≤ 0.5
      and note the mismatch in `reasoning`.

  R5. Abstain over hallucinate: When uncertain, score low and set `abstain_if_uncertain: true`.
      Scores of 0.75+ carry downstream trust implications — do not inflate.

---

SUPPORT-PREDICATE MAPPING:

  score ≥ 0.75  AND  quote ≠ null   →  predicate = "supported"
  0.25 ≤ score < 0.75               →  predicate = "partial"
  score < 0.25  OR  quote = null with score attempt ≥ 0.75 (rule violation caught)
                                    →  predicate = "unsupported"
  Step not attempted at all (score = 0.0, tier = "none")
                                    →  predicate = "skipped"

  THRESHOLD DISCUSSION — "partial" predicate:
  For CRITICAL steps (steps whose output is a required input to a subsequent gold step),
  callers SHOULD treat "partial" as "unsupported". For NON-CRITICAL steps (informational
  or enrichment steps), callers MAY treat "partial" as a soft pass subject to their own
  risk tolerance. The template does not make this decision; it surfaces the predicate and
  the score so callers can apply their own threshold.

---

INPUT FORMAT
-----------

You will receive:

  GOLD_STEP:           A natural-language description of what the agent was supposed to do.
  ACCEPTANCE_CRITERION: A precise, testable condition that defines "this step is complete."
                        Written by the plan author. May include artifact type, expected value,
                        source identifier, and any structural requirements.
  STEP_ID:             Opaque string identifying this step in the plan.
  TRACE_EXCERPT:       The relevant portion of the agent trace for this step.
                       May include tool call logs, model outputs, retrieved text,
                       and inter-step context. Newlines preserved. Line numbers provided
                       where available as "L<n>:" prefix.

---

TASK
----

Evaluate whether the TRACE_EXCERPT contains evidence that satisfies the ACCEPTANCE_CRITERION
for the GOLD_STEP. Score 0–1 using the rubric above. Populate all fields in the JSON schema below.

GOLD_STEP:
{{GOLD_STEP}}

ACCEPTANCE_CRITERION:
{{ACCEPTANCE_CRITERION}}

STEP_ID:
{{STEP_ID}}

TRACE_EXCERPT:
{{TRACE_EXCERPT}}

---

OUTPUT
------

Return ONLY valid JSON matching this schema. No prose before or after.

{
  "step_id": "{{STEP_ID}}",
  "score": <float 0.0–1.0, one decimal place>,
  "tier": <"none" | "weak" | "partial" | "strong" | "verbatim">,
  "quote": <string | null>,
  "quote_location": {
    "line_start": <integer | null>,
    "line_end": <integer | null>,
    "char_offset_start": <integer | null>,
    "char_offset_end": <integer | null>,
    "turn": <integer | null>
  },
  "quote_to_criterion_mapping": <string | null>,
  "reasoning": "<≤2 sentences explaining the score. Must reference specific trace content or absence thereof.>",
  "abstain_if_uncertain": <boolean>,
  "predicate": <"supported" | "partial" | "unsupported" | "skipped">
}
```

---

## Section 2: Evidence-Citation Schema and Example

### 2.1 Schema Rationale

The citation format forces the evaluator to locate, quote, and annotate evidence before scoring. This directly addresses the leniency problem identified by [Lanham et al. (2023)](https://arxiv.org/abs/2307.13702): CoT steps that "mention" content rather than being causally grounded in it should receive low faithfulness scores. By requiring a verbatim quote for high scores, the schema operationalizes the FActScore principle that each atomic fact must be independently verifiable against a source ([Min et al., 2023](https://arxiv.org/abs/2305.14251)). RAGAS applies the analogous constraint: faithfulness requires that claims be *inferable from retrieved context*, and the framework explicitly extracts statements before checking them ([Es et al., 2023](https://arxiv.org/abs/2309.15217)).

### 2.2 Full JSON Schema (TypeScript-style annotations)

```typescript
interface SupportEvaluation {
  step_id: string;                    // Opaque plan step identifier
  score: number;                      // Float in [0.0, 1.0], one decimal
  tier: "none" | "weak" | "partial" | "strong" | "verbatim";
  quote: string | null;               // Exact substring from trace; null iff tier ∈ {none, weak}
  quote_location: {
    line_start: number | null;        // 1-indexed line in trace_excerpt where quote begins
    line_end: number | null;          // 1-indexed line where quote ends
    char_offset_start: number | null; // Character offset within trace_excerpt (0-indexed)
    char_offset_end: number | null;   // Exclusive end offset
    turn: number | null;              // Turn index in multi-turn trace; null if single-turn
  };
  quote_to_criterion_mapping: string | null;
  // Natural language: "The phrase '...' satisfies criterion clause '<X>' because ..."
  // Must be non-null iff quote is non-null.
  reasoning: string;                  // ≤2 sentences, must cite specific trace content or its absence
  abstain_if_uncertain: boolean;      // true → score is conservatively capped at 0.5
  predicate: "supported" | "partial" | "unsupported" | "skipped";
}
```

### 2.3 Quote Provenance Checks (caller-side)

After receiving the evaluator's JSON, the caller SHOULD run these checks before accepting the evaluation:

```python
def verify_provenance(eval_result: dict, trace_excerpt: str, lines: list[str]) -> list[str]:
    """
    Returns list of provenance violations. Empty list = clean.
    """
    violations = []
    quote = eval_result.get("quote")
    score = eval_result.get("score", 0.0)
    loc = eval_result.get("quote_location", {})

    # CHECK 1: Score ≥ 0.75 requires a non-null quote
    if score >= 0.75 and quote is None:
        violations.append(f"PROV_FAIL_01: score={score} but quote is null")

    if quote is not None:
        # CHECK 2: Substring match — quote must appear verbatim in trace
        if quote not in trace_excerpt:
            violations.append(f"PROV_FAIL_02: quote not found as substring in trace_excerpt")

        # CHECK 3: Line bounds must be consistent
        ls = loc.get("line_start")
        le = loc.get("line_end")
        if ls is not None and le is not None:
            if ls < 1 or le > len(lines):
                violations.append(f"PROV_FAIL_03: line bounds ({ls},{le}) out of range (1,{len(lines)})")
            else:
                region = "\n".join(lines[ls-1:le])
                if quote not in region:
                    violations.append(f"PROV_FAIL_04: quote not found within declared line range {ls}-{le}")

        # CHECK 4: Char offset consistency
        cs = loc.get("char_offset_start")
        ce = loc.get("char_offset_end")
        if cs is not None and ce is not None:
            if trace_excerpt[cs:ce] != quote:
                violations.append(
                    f"PROV_FAIL_05: char offsets [{cs}:{ce}] yield '{trace_excerpt[cs:ce]}', "
                    f"not '{quote[:40]}...'"
                )

        # CHECK 5: Quote length sanity (pathological single-char quotes)
        if len(quote.strip()) < 10:
            violations.append(f"PROV_WARN_06: quote is suspiciously short ({len(quote)} chars)")

    return violations
```

**Fallback rule**: If `PROV_FAIL_01` or `PROV_FAIL_02` fires, the caller MUST downgrade the evaluation: set `predicate = "unsupported"`, set `score = 0.25`, and log the provenance failure. Do not accept a `"supported"` verdict from a quote-less evaluation.

### 2.4 Rendered Example — Evidence Citation

**Scenario**: Agent retrieved RFC 9110 and extracted the definition of status code 204.

**Gold Step**: "Retrieve and record the definition of HTTP 204 No Content from RFC 9110."

**Acceptance Criterion**: "Trace must contain the verbatim text from RFC 9110 §15.3.5 defining the 204 status code semantics, specifically that the server has successfully processed the request but is not returning any content."

```json
{
  "step_id": "step_03",
  "score": 1.0,
  "tier": "verbatim",
  "quote": "The 204 (No Content) response code indicates that the server has successfully fulfilled the request and that there is no additional content to send in the response content.",
  "quote_location": {
    "line_start": 47,
    "line_end": 48,
    "char_offset_start": 2301,
    "char_offset_end": 2489,
    "turn": 3
  },
  "quote_to_criterion_mapping": "The phrase 'successfully fulfilled the request and that there is no additional content to send in the response content' directly satisfies criterion clause 'server has successfully processed the request but is not returning any content'.",
  "reasoning": "Trace turn 3 lines 47-48 contains a verbatim excerpt from RFC 9110 §15.3.5 defining 204 semantics. The extracted text fully satisfies the acceptance criterion with no interpretive gap.",
  "abstain_if_uncertain": false,
  "predicate": "supported"
}
```

---

## Section 3: Thin-Trace Calibration Techniques

### 3.1 The H-Family Problem

An **H-family step** is one where the agent issued a tool call (fetch, search, API call) that is logged in the trace, but the response content was never surfaced into the trace context. The agent may have consumed the response internally, but from the evaluator's perspective, no evidence exists. The existing binary `supported/unsupported` judge assigns `supported` because the action is present; the graded system caps these at `score ≤ 0.25` via Rule R3.

Concretely, a trace containing:
```
[TOOL CALL] fetch("https://www.rfc-editor.org/rfc/rfc9110", section="15.3.5")
[TOOL RESULT] <omitted from context window>
[AGENT] Based on the RFC, the 204 status means no content is returned.
```
...is an H-family step. The agent's conclusion may be correct, but the evaluator has no extractable evidence. Score = 0.25, tier = "weak", predicate = "unsupported".

This aligns with the spirit of [Lightman et al. (2023)](https://arxiv.org/abs/2305.20050): process supervision requires signal at *each step*, not just a correct final answer. A step that produced a plausible-sounding conclusion without traceable evidence is an unreliable step regardless of accuracy.

### 3.2 Acceptance Criteria Embedded Per Gold Step

Each gold step should carry a machine-readable `acceptance_criterion` that specifies exactly what artifact constitutes "done." This removes ambiguity from the evaluator and prevents score inflation via generous interpretation.

**Recommended acceptance criterion format**:

```json
{
  "step_id": "step_03",
  "description": "Retrieve RFC 9110 §15.3.5 definition of 204 No Content",
  "acceptance_criterion": {
    "artifact_type": "verbatim_quote",
    "source_identifier": "RFC 9110 §15.3.5",
    "required_content_pattern": "204.*No Content.*successfully.*no.*content",
    "minimum_quote_length_chars": 50,
    "must_appear_in_trace": true
  }
}
```

The evaluator receives this structured criterion rather than a free-form description. The `required_content_pattern` gives callers a regex-level sanity check independent of the LLM evaluator's judgment, analogous to the deterministic pre-checks in RAGAS's pipeline ([Es et al., 2023](https://arxiv.org/abs/2309.15217)).

### 3.3 Two-Turn Judge: Extractor → Verifier Decomposition

Directly inspired by FActScore's architecture ([Min et al., 2023](https://arxiv.org/abs/2305.14251)), which separates atomic fact generation from fact verification.

**Turn 1 — Extractor** (cheap model, e.g., `claude-haiku-3-5` or `gpt-4o-mini`):

```
SYSTEM: You are an evidence extractor. Given a trace excerpt and a gold step description,
find and return ALL spans from the trace that are potentially relevant to the gold step.
Return a JSON list of {span, line_start, line_end, char_offset_start, char_offset_end}.
Return an empty list if no relevant spans exist.

Do not score, evaluate, or judge. Only extract.
```

**Turn 2 — Verifier** (stronger model, e.g., `claude-sonnet-4-5`):

```
SYSTEM: You are a strict support evaluator (full system prompt from Section 1).

You have been given a PRE-EXTRACTED candidate evidence list. Score ONLY based on
whether these candidates satisfy the acceptance criterion.
If the candidate list is empty, score MUST be ≤ 0.25.

CANDIDATE EVIDENCE:
{{extractor_output}}

ACCEPTANCE_CRITERION:
{{acceptance_criterion}}
```

**Benefits**:
- Extractor forces explicit evidence retrieval before scoring — prevents the verifier from pattern-matching on "plausible agent behavior."
- Empty extractor output → automatic score cap, matching R3 without relying on the verifier's self-discipline.
- Cheaper model handles extraction (high volume, deterministic task); stronger model handles judgment (lower volume).
- Aligns with G-Eval's form-filling paradigm ([Liu et al., 2023](https://aclanthology.org/2023.emnlp-main.153/)): evaluation steps are made explicit rather than implicit.

### 3.4 Consistency Checks

Run the verifier twice with different contexts and flag divergence:

| Check | Method | Flag condition |
|---|---|---|
| **Trace-only** | Evaluate with trace excerpt only | Baseline score |
| **Trace + retrieved doc** | Append the actual source document (if available) to context | Score should not jump more than +0.3 |
| **Score consistency** | Run at temp=0 twice | Scores should be identical |
| **Quote consistency** | Compare quotes across runs | Different quotes for same score → flag |

If trace-only score is < 0.25 but trace+doc score is ≥ 0.75, this is strong evidence that the agent retrieved information but failed to surface it into the trace — a confirmed H-family step. Log the delta as `evidence_gap_score`.

### 3.5 Temperature 0, Structured Outputs, Forced-Function Schema

- **Temperature 0**: All evaluator calls run at `temperature=0`. The score rubric is deterministic by design; stochasticity serves no purpose and inflates variance. Research on structured output consistency confirms temperature is the dominant driver of output variation ([OpenReview 2512.23712](https://arxiv.org/abs/2512.23712)).
- **Structured outputs / constrained decoding**: Use the provider's native JSON mode or tool-calling interface to guarantee schema compliance. This eliminates hallucinated fields and ensures `quote` is either a proper string or `null` — not a made-up value.
- **Forced-function schema**: The `quote` field is not optional in the schema, but is nullable. By making it a required field with a nullable type, you force the model to make an explicit choice (populate or null) rather than omitting it silently. Omission is treated as `null` by callers, triggering the score-cap.

### 3.6 Score-Floor Rules Tied to Evidence Density

After the evaluator returns a score, apply these deterministic adjustments in caller code:

```python
def apply_evidence_density_floors(eval_result: dict, trace_excerpt: str) -> dict:
    """Deterministic post-processing of evaluator output."""
    quote = eval_result.get("quote")
    score = eval_result.get("score", 0.0)

    # Rule R3: fetch-without-extraction cap
    has_tool_call = "TOOL CALL" in trace_excerpt or "tool_call" in trace_excerpt.lower()
    has_response = "TOOL RESULT" in trace_excerpt or len(trace_excerpt) > 500
    if has_tool_call and not has_response and score > 0.25:
        eval_result["score"] = 0.25
        eval_result["tier"] = "weak"
        eval_result["predicate"] = "unsupported"
        eval_result["reasoning"] += " [FLOOR APPLIED: fetch-without-extraction cap]"

    # Rule R1: quote required for score ≥ 0.75
    if score >= 0.75 and quote is None:
        eval_result["score"] = 0.5
        eval_result["tier"] = "partial"
        eval_result["predicate"] = "partial"
        eval_result["reasoning"] += " [FLOOR APPLIED: score capped at 0.5 — no quote provided]"

    # Evidence density floor: quoted text < 10 chars → cap at 0.5
    if quote is not None and len(quote.strip()) < 10:
        eval_result["score"] = min(eval_result["score"], 0.5)
        eval_result["tier"] = "partial"
        eval_result["reasoning"] += " [FLOOR APPLIED: quote too short to be meaningful]"

    # Remap predicate after floors
    s = eval_result["score"]
    q = eval_result.get("quote")
    if s == 0.0:
        eval_result["predicate"] = "skipped"
    elif s >= 0.75 and q:
        eval_result["predicate"] = "supported"
    elif s >= 0.25:
        eval_result["predicate"] = "partial"
    else:
        eval_result["predicate"] = "unsupported"

    return eval_result
```

### 3.7 Solving the Right Problem: Producer-Side Step Markers

The calibration techniques above all operate on the **judge side**. There is a complementary (and arguably more robust) approach: fix the problem at the **producer side** by requiring the agent to emit a structured `step_complete` marker when it finishes each gold step.

**Proposed agent trace marker**:
```json
{
  "__plv_step_complete": true,
  "step_id": "step_03",
  "artifact_type": "verbatim_quote",
  "artifact_value": "The 204 (No Content) response code indicates...",
  "source": "RFC 9110 §15.3.5",
  "source_url": "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.5",
  "confidence": "high"
}
```

**Why this matters**: If the agent is required to emit this marker to signal step completion, the absence of the marker is itself a strong signal (`score ≤ 0.25`). Presence of the marker with a populated `artifact_value` gives the evaluator a direct quote to check — converting the judge's job from evidence hunting into quote validation. The PLV evaluator simply checks: (a) does the marker exist? (b) does `artifact_value` satisfy the acceptance criterion? (c) is `artifact_value` a substring of the trace?

**Important caveat**: This is only viable if you control the agent's prompt or training. For evaluation of third-party traces, the judge-side techniques in §3.2–3.6 are necessary. The producer-side approach is the cleaner long-term solution but requires changing agent behavior, not just the evaluator. Prometheus-style evaluation ([Kim et al., 2023](https://arxiv.org/abs/2310.08491)) implicitly assumes the evaluator receives an artifact to judge — the marker makes that assumption explicit and enforceable.

---

## Section 4: Two Worked Examples

### Example A — Clearly Supported (tier=verbatim, score=1.0)

**Setup**: The agent was tasked with verifying the HTTP 204 No Content response definition from RFC 9110.

---

**INPUT TO EVALUATOR**:

```
GOLD_STEP:
Retrieve the definition of HTTP status code 204 No Content from RFC 9110 and record
the exact text defining its semantics.

ACCEPTANCE_CRITERION:
The trace must contain a verbatim excerpt from RFC 9110 Section 15.3.5 that defines
the 204 No Content status code semantics, specifically covering: (a) what server state
it signals, and (b) the nature of the response payload (absent/empty). Minimum quoted
length: 50 characters.

STEP_ID:
step_03

TRACE_EXCERPT:
L1:  [TOOL CALL] fetch_url(url="https://www.rfc-editor.org/rfc/rfc9110", section="15.3.5")
L2:  [TOOL RESULT] HTTP 200 OK — 4,821 chars returned
L3:  [EXTRACTED CONTENT]
L4:  "15.3.5. 204 No Content
L5:   The 204 (No Content) response code indicates that the server has successfully
L6:   fulfilled the request and that there is no additional content to send in the
L7:   response content. Metadata in the response header fields refer to the target
L8:   resource and its selected representation after the requested action was applied."
L9:  [AGENT CONCLUSION] Recorded RFC 9110 §15.3.5 definition. 204 means: successful
L10: fulfillment, no response body. Will use this as acceptance criterion for downstream
L11: step validation.
```

---

**EVALUATOR JSON RESPONSE**:

```json
{
  "step_id": "step_03",
  "score": 1.0,
  "tier": "verbatim",
  "quote": "The 204 (No Content) response code indicates that the server has successfully fulfilled the request and that there is no additional content to send in the response content.",
  "quote_location": {
    "line_start": 5,
    "line_end": 7,
    "char_offset_start": 198,
    "char_offset_end": 367,
    "turn": null
  },
  "quote_to_criterion_mapping": "Clause (a) satisfied by 'server has successfully fulfilled the request' (server state = successful completion). Clause (b) satisfied by 'no additional content to send in the response content' (response payload is absent). Quote length = 169 chars, exceeds minimum 50.",
  "reasoning": "Trace lines 5-7 contain a verbatim block extracted from RFC 9110 §15.3.5, bookended by a [TOOL RESULT] and [EXTRACTED CONTENT] marker, confirming the fetch succeeded and content was surfaced into the trace. Both acceptance criterion clauses are fully satisfied with no interpretive gap.",
  "abstain_if_uncertain": false,
  "predicate": "supported"
}
```

**Caller provenance check result**: PASS — `quote` is a substring of `trace_excerpt`, line bounds consistent, char offsets valid, quote length 169 chars.

---

### Example B — Merely Mentioned / H-Family (tier=weak, score=0.25)

**Setup**: Agent fetched RFC 9110 but never surfaced the extracted text into the trace. Close cousin of the canonical H-family case.

---

**INPUT TO EVALUATOR**:

```
GOLD_STEP:
Retrieve the definition of HTTP status code 204 No Content from RFC 9110 and record
the exact text defining its semantics.

ACCEPTANCE_CRITERION:
The trace must contain a verbatim excerpt from RFC 9110 Section 15.3.5 that defines
the 204 No Content status code semantics, specifically covering: (a) what server state
it signals, and (b) the nature of the response payload (absent/empty). Minimum quoted
length: 50 characters.

STEP_ID:
step_03

TRACE_EXCERPT:
L1:  [TOOL CALL] fetch_url(url="https://www.rfc-editor.org/rfc/rfc9110")
L2:  [TOOL RESULT] <response body not retained in context>
L3:  [AGENT REASONING] I have now consulted RFC 9110. The 204 status code means the
L4:  server processed the request successfully but sends no response body. This is
L5:  consistent with standard HTTP semantics. I will proceed to the next step.
```

---

**EVALUATOR JSON RESPONSE**:

```json
{
  "step_id": "step_03",
  "score": 0.25,
  "tier": "weak",
  "quote": null,
  "quote_location": {
    "line_start": null,
    "line_end": null,
    "char_offset_start": null,
    "char_offset_end": null,
    "turn": null
  },
  "quote_to_criterion_mapping": null,
  "reasoning": "Trace line 1 shows a fetch tool call was issued for RFC 9110, but line 2 explicitly states the response body was not retained in context. Lines 3-5 contain only an agent-authored paraphrase ('sends no response body') — this is not a verbatim excerpt from RFC 9110 §15.3.5, so the acceptance criterion requiring a verbatim quote of ≥50 chars is unsatisfied. Rule R3 (fetch-without-extraction cap) applies: score capped at 0.25.",
  "abstain_if_uncertain": false,
  "predicate": "unsupported"
}
```

**Caller provenance check result**: PASS (quote is null, score is 0.25, no R1 violation). Score-floor function confirms R3 applies: `has_tool_call=True`, `has_response=False` (TOOL RESULT body absent). Predicate correctly set to `"unsupported"`.

**Key contrast with Example A**: Both traces show a fetch tool call. Example A surfaces extracted content (lines 3-8, ~170 chars of RFC text). Example B logs only `<response body not retained in context>` and then produces an agent-authored paraphrase. The graded system correctly distinguishes these where a binary judge would likely award `supported` to both.

---

## Section 5: Integration Notes

### 5.1 Plugging Into the Existing Support-Only Evaluator

The existing PLV evaluator emits a binary `{supported, unsupported, skipped}` predicate. Migration path:

1. **Drop-in replacement**: Swap the existing prompt for the Section 1 template. Map the graded output to predicates using the threshold table. The `predicate` field in the JSON output is a drop-in for the existing binary predicate.
2. **Partial rollout**: Run both evaluators in parallel. Log disagreements (binary=`supported`, graded predicate=`unsupported` or `partial`) as H-family candidates for manual review.
3. **Critical-step threshold injection**: Pass `critical: bool` per step. Callers implement:
   ```python
   final_predicate = eval_result["predicate"]
   if eval_result["predicate"] == "partial" and step["critical"]:
       final_predicate = "unsupported"
   ```
4. **Provenance check integration**: After every evaluator call, run `verify_provenance()` (Section 2.3). Log `PROV_FAIL_*` violations to a separate metrics stream. A high provenance failure rate signals evaluator miscalibration or prompt degradation.

### 5.2 Cost Estimate

All estimates assume per-token pricing as of mid-2025. Adjust for your provider.

| Configuration | Model | Est. input tokens/step | Est. output tokens/step | $/step | $/trace (20 steps) |
|---|---|---|---|---|---|
| Single-judge (Section 1 only) | claude-sonnet-4-5 | ~1,200 | ~200 | ~$0.009 | **~$0.18** |
| Single-judge | gpt-4o | ~1,200 | ~200 | ~$0.010 | **~$0.20** |
| Two-turn (extractor+verifier) | haiku-3-5 + sonnet-4-5 | ~800 + ~1,000 | ~150 + ~200 | ~$0.011 | **~$0.22** |
| Two-turn w/ consistency check (×2 verifier) | haiku-3-5 + sonnet-4-5 ×2 | — | — | ~$0.018 | **~$0.36** |

All configurations fall within the $0.05–$0.50/trace target. The two-turn configuration with consistency checks at ~$0.36/trace is the recommended production default.

### 5.3 Model Recommendations

**Verifier (Section 1 prompt, judgment)**: Use a **Sonnet-class model** (claude-sonnet-4-5, gpt-4o, or equivalent). The verifier must reliably follow complex multi-rule instructions, maintain hard rules (R1–R5) even when the trace is ambiguous, and produce provenance-valid quotes. Smaller models fail R1 at elevated rates in preliminary testing — they inflate scores without quotes.

**Extractor (two-turn §3.3, turn 1)**: Use a **Haiku/mini-class model** (claude-haiku-3-5, gpt-4o-mini). Extraction is a span-retrieval task with a deterministic correctness criterion (is the span in the trace?). Cost savings are significant at volume.

**Structured output**: Use provider JSON mode or tool-calling for both turns. Set `temperature=0` for both. Do not use free-form text generation for the evaluator output.

**Provider note on structured outputs**: Claude models (Anthropic) show near-perfect structural reliability even at temperature > 0 ([OpenReview framework for LLM structured output reliability](https://arxiv.org/abs/2512.23712)), but for evaluation workloads, `temperature=0` is non-negotiable regardless of model.

### 5.4 Schema Versioning

Tag every evaluation output with a schema version field:

```json
{
  "__schema_version": "plv-graded-support-v1.0",
  "__evaluated_at": "2025-01-15T14:30:00Z",
  ...
}
```

This ensures downstream consumers can detect when the prompt or rubric changes and re-evaluate affected steps without ambiguity.

---

## Section 6: Literature Backing

All design decisions are grounded in the following works. Citations appear inline throughout the document; references below provide full coordinates.

| # | Reference | Role in this design |
|---|---|---|
| 1 | Liu et al. (2023). **G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment**. EMNLP 2023. [ACL Anthology](https://aclanthology.org/2023.emnlp-main.153/) / [PDF](https://aclanthology.org/2023.emnlp-main.153.pdf) | Form-filling paradigm with CoT steps; foundation for the evaluator's structured output + step-by-step reasoning before scoring. The probability-weighted scoring idea motivates the continuous 0–1 scale over a binary. |
| 2 | Kim et al. (2023). **Prometheus: Inducing Fine-grained Evaluation Capability in Language Models**. ICLR 2024. [arXiv:2310.08491](https://arxiv.org/abs/2310.08491) | Rubric-based evaluation with per-score-level natural-language definitions. Directly informs the five-tier calibration anchors at 0.0/0.25/0.5/0.75/1.0. Reference answer + rubric improves inter-rater reliability (Pearson 0.897 with humans). |
| 3 | Min et al. (2023). **FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation**. EMNLP 2023. [arXiv:2305.14251](https://arxiv.org/abs/2305.14251) | Atomic-fact decomposition and extractor→verifier two-turn architecture. Directly implements the thin-trace calibration strategy in §3.3. Each gold step treated as an atomic claim that must be individually verified against the trace. |
| 4 | Es et al. (2023). **Ragas: Automated Evaluation of Retrieval Augmented Generation**. [arXiv:2309.15217](https://arxiv.org/abs/2309.15217) | Faithfulness metric requiring claims to be inferable from retrieved context. Motivates the quote-to-criterion mapping field and the principle that inference without citation = unfaithful. Two-stage pipeline (extract then verify) mirrors §3.3. |
| 5 | Lightman et al. (2023). **Let's Verify Step by Step**. ICLR 2024. [arXiv:2305.20050](https://arxiv.org/abs/2305.20050) | Process supervision: step-level feedback significantly outperforms outcome-level feedback for reliable evaluation. Justifies per-step scoring rather than end-to-end trace scoring. Also motivates the acceptance criterion per step (§3.2). |
| 6 | Lanham et al. (2023). **Measuring Faithfulness in Chain-of-Thought Reasoning**. Anthropic. [arXiv:2307.13702](https://arxiv.org/abs/2307.13702) / [Anthropic research page](https://www.anthropic.com/research/measuring-faithfulness-in-chain-of-thought-reasoning) | Faithfulness interventions (adding mistakes, paraphrasing CoT) reveal when a model's stated reasoning is not causally connected to its conclusion. Directly motivates Rules R3 and R4: agent conclusions that are not causally grounded in trace evidence should receive low scores regardless of accuracy. |

### Additional Supporting References

- **Autorubric** (2026). Unifying rubric-based LLM evaluation. [arXiv:2603.00077](https://arxiv.org/abs/2603.00077). Validates analytic rubrics with binary/ordinal criteria and few-shot calibration as the current state of the art for inter-rater reliability.
- **LLM Structured Output Reliability** (2025). Framework for evaluating JSON output consistency. [arXiv:2512.23712](https://arxiv.org/abs/2512.23712). Empirical basis for `temperature=0` recommendation and model selection for structured output tasks.
- **Watch Every Step! LLM Agent Learning via Iterative Step-Level Process Refinement** (EMNLP 2024). [ACL Anthology](https://aclanthology.org/2024.emnlp-main.93.pdf). Validates that step-level reward signals improve agent trace quality — confirms the producer-side marker approach in §3.7 as a long-term solution.
