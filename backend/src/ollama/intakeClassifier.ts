// ─────────────────────────────────────────────────────────────
// Intake Classifier — Ollama (osava-smollm / SmolLM3-3B)
//
// Replaces gemini/intakeClassifier.ts. Same public API:
//   classifyRawInput(input) → GeminiClassification
//
// Pipeline:
//   1. Build few-shot prompt via promptBuilder
//   2. Call runClassifier (Ollama)
//   3. Parse JSON, validate fields
//   4. On parse fail: retry once with JSON-only instruction
//   5. On total fail: safe fallback (isThreat: false)
// ─────────────────────────────────────────────────────────────

import { runClassifier, OllamaTimeoutError, OllamaUnavailableError } from "./ollamaClient";
import { buildTelemetryPrompt } from "./promptBuilder";
import {
  CONFIDENCE_FROM_SEVERITY,
  VALID_SEVERITIES,
  shouldEscalate,
} from "./contract";
import type { RawInput, GeminiClassification } from "../types/memory";

// ── Safe fallback ─────────────────────────────────────────────

// Fails OPEN, deliberately. This used to return isThreat:false / "fast", which
// meant an unparseable response was indistinguishable from a clean verdict and
// the event was silently dropped. One event in 138 of the held-out set
// (M004 — a cmd.exe copy-and-execute chain with an embedded JavaScript payload)
// produces malformed JSON, and it is malicious. An intake tier that cannot
// classify must hand the decision on, not answer "clean" on the model's behalf.
const SAFE_FALLBACK: GeminiClassification = {
  isThreat: true,
  confidence: 0.5,
  threatType: "unknown",
  severity: "medium",
  indicators: { classifier_error: "response could not be parsed" },
  reasoning: "Classifier returned no usable response — escalated for analysis rather than dismissed.",
  recommendedPath: "escalate",
};

// ── JSON extraction helper ────────────────────────────────────
// Handles cases where the SLM wraps response in markdown fences.

function extractJson(raw: string): string {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  // Try to find first { ... } block
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }
  return raw;
}

// osava-smollm does not emit `confidence`. R7 removed it from the classifier
// contract on the grounds that a model's self-reported confidence is not a
// calibrated probability. The real replacement is the routing margin -- the gap
// between the top two class probabilities -- but `ollama run` generates text and
// does not expose log-probs, so the margin is not recoverable at this tier.
//
// What is returned below is therefore DERIVED FROM SEVERITY, not reported by the
// model. It exists so downstream display and notification code keeps working.
// Do not treat it as a measured probability.
function parseClassification(raw: string): GeminiClassification {
  const parsed = JSON.parse(extractJson(raw));

  if (typeof parsed["isThreat"] !== "boolean") throw new Error("isThreat missing or not boolean");
  if (typeof parsed["reasoning"] !== "string") throw new Error("reasoning missing");
  if (parsed["severity"] && !VALID_SEVERITIES.has(parsed["severity"])) {
    throw new Error(`Invalid severity: ${parsed["severity"]}`);
  }

  const severity: string = parsed["severity"] ?? "none";
  const threatType: string | null = parsed["threatType"] ?? null;

  // A model that still sends confidence (phi3:mini did) is honoured; otherwise
  // the severity-derived value is used.
  const confidence =
    typeof parsed["confidence"] === "number" &&
    parsed["confidence"] >= 0 && parsed["confidence"] <= 1
      ? parsed["confidence"]
      : (CONFIDENCE_FROM_SEVERITY[severity] ?? 0.5);

  const escalate = shouldEscalate(severity, threatType);

  return {
    isThreat: parsed["isThreat"],
    confidence,
    threatType,
    severity: severity as GeminiClassification["severity"],
    indicators: parsed["indicators"] ?? {},
    reasoning: parsed["reasoning"],
    recommendedPath:
      parsed["recommendedPath"] === "escalate" || escalate ? "escalate" : "fast",
  };
}

// ── Public API ────────────────────────────────────────────────

export async function classifyRawInput(
  input: RawInput
): Promise<GeminiClassification> {
  // osava-smollm only understands Windows telemetry in the R1 contract. On
  // anything else it returns severity "none" -- it answers "clean" rather than
  // declining -- so an unsupported input must never reach it. Escalating is
  // the safe direction; the deep-analysis tier is a generalist.
  const prompt = buildTelemetryPrompt(input);
  if (prompt === null) {
    console.warn(
      `[IntakeClassifier] ${input.inputId} (${input.inputType}) is outside the ` +
        `classifier's trained contract — escalating instead of classifying.`
    );
    return {
      ...SAFE_FALLBACK,
      indicators: { unsupported_input_type: input.inputType },
      reasoning:
        `Input type "${input.inputType}" is outside the intake classifier's ` +
        `trained domain (Windows Sysmon telemetry). Escalated for deep analysis.`,
    };
  }

  // First attempt
  let rawResponse: string;
  try {
    const result = await runClassifier(prompt);
    rawResponse = result.text;
  } catch (err: unknown) {
    if (err instanceof OllamaTimeoutError) {
      console.warn(`[IntakeClassifier] osava-smollm timed out`);
    } else if (err instanceof OllamaUnavailableError) {
      console.warn(`[IntakeClassifier] Ollama unavailable: ${(err as Error).message}`);
    } else {
      console.warn("[IntakeClassifier] Unexpected error:", err);
    }
    return SAFE_FALLBACK;
  }

  // First parse attempt
  try {
    return parseClassification(rawResponse);
  } catch (parseErr) {
    console.warn("[IntakeClassifier] JSON parse failed on first attempt, retrying...");
  }

  // Retry: re-call with explicit JSON instruction
  try {
    const retryPrompt = prompt + "\nYou must respond with ONLY a JSON object. No other text.";
    const retryResult = await runClassifier(retryPrompt);
    return parseClassification(retryResult.text);
  } catch (retryErr) {
    console.warn("[IntakeClassifier] Retry failed, returning safe fallback.");
    return SAFE_FALLBACK;
  }
}

// applyConfidenceFloor() was removed here.
//
// It rewrote isThreat:true -> false whenever confidence < 0.4, which is the
// under-calling behaviour M1 and R7 exist to eliminate: a model that flags a
// threat had its verdict silently reversed by a threshold. With confidence now
// derived from severity it would have zeroed every `medium` classification too.
// Routing belongs in recommendedPath, which is computed from severity above.
