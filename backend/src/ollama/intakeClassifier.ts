// ─────────────────────────────────────────────────────────────
// Intake Classifier — Ollama (sentri-classifier / phi3:mini)
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
import { buildClassifierPrompt } from "./promptBuilder";
import type { RawInput, GeminiClassification } from "../types/memory";

// ── Safe fallback ─────────────────────────────────────────────

const SAFE_FALLBACK: GeminiClassification = {
  isThreat: false,
  confidence: 0,
  threatType: null,
  severity: "none",
  indicators: {},
  reasoning: "Classification failed — manual review required.",
  recommendedPath: "fast",
};

// ── Valid severity values ─────────────────────────────────────

const VALID_SEVERITIES = new Set(["none", "low", "medium", "high", "critical"]);

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

function parseClassification(raw: string): GeminiClassification {
  const parsed = JSON.parse(extractJson(raw));

  // Validate required fields
  if (typeof parsed["isThreat"] !== "boolean") throw new Error("isThreat missing or not boolean");
  if (typeof parsed["confidence"] !== "number") throw new Error("confidence missing or not number");
  if (parsed["confidence"] < 0 || parsed["confidence"] > 1) throw new Error("confidence out of range");
  if (typeof parsed["reasoning"] !== "string") throw new Error("reasoning missing");
  if (parsed["severity"] && !VALID_SEVERITIES.has(parsed["severity"])) {
    throw new Error(`Invalid severity: ${parsed["severity"]}`);
  }

  return {
    isThreat: parsed["isThreat"],
    confidence: parsed["confidence"],
    threatType: parsed["threatType"] ?? null,
    severity: parsed["severity"] ?? "none",
    indicators: parsed["indicators"] ?? {},
    reasoning: parsed["reasoning"],
    recommendedPath: parsed["recommendedPath"] === "escalate" ? "escalate" : "fast",
  };
}

// ── Public API ────────────────────────────────────────────────

export async function classifyRawInput(
  input: RawInput
): Promise<GeminiClassification> {
  const prompt = buildClassifierPrompt(input);

  // First attempt
  let rawResponse: string;
  try {
    const result = await runClassifier(prompt);
    rawResponse = result.text;
  } catch (err: unknown) {
    if (err instanceof OllamaTimeoutError) {
      console.warn(`[IntakeClassifier] sentri-classifier timed out`);
    } else if (err instanceof OllamaUnavailableError) {
      console.warn(`[IntakeClassifier] Ollama unavailable: ${(err as Error).message}`);
    } else {
      console.warn("[IntakeClassifier] Unexpected error:", err);
    }
    return SAFE_FALLBACK;
  }

  // First parse attempt
  try {
    const result = parseClassification(rawResponse);
    return applyConfidenceFloor(result);
  } catch (parseErr) {
    console.warn("[IntakeClassifier] JSON parse failed on first attempt, retrying...");
  }

  // Retry: re-call with explicit JSON instruction
  try {
    const retryPrompt = prompt + "\nYou must respond with ONLY a JSON object. No other text.";
    const retryResult = await runClassifier(retryPrompt);
    const result = parseClassification(retryResult.text);
    return applyConfidenceFloor(result);
  } catch (retryErr) {
    console.warn("[IntakeClassifier] Retry failed, returning safe fallback.");
    return SAFE_FALLBACK;
  }
}

/**
 * Confidence floor: prevent over-flagging.
 * If isThreat=true but confidence < 0.4, override to isThreat=false.
 */
function applyConfidenceFloor(result: GeminiClassification): GeminiClassification {
  if (result.isThreat && result.confidence < 0.4) {
    console.log(
      `[IntakeClassifier] Low confidence (${result.confidence.toFixed(2)}) — overriding isThreat to false`
    );
    return {
      ...result,
      isThreat: false,
      severity: "none",
      recommendedPath: "fast",
      reasoning: result.reasoning + " (confidence below threshold — flagged clean)",
    };
  }
  return result;
}
