// ─────────────────────────────────────────────────────────────
// Intake Classifier — Gemini Flash
//
// First Gemini call in the pipeline. Takes raw unstructured input
// and returns a GeminiClassification with threat type, severity,
// IOCs, reasoning, and routing recommendation.
//
// Retry logic: one retry on JSON parse failure, then safe fallback.
// Confidence floor: if isThreat=true but confidence < 0.4, override
//   to isThreat=false (prevents over-flagging clean inputs).
// ─────────────────────────────────────────────────────────────

import { generateFlash, GeminiError, FLASH_MODEL_NAME } from "./geminiClient";
import type { RawInput, GeminiClassification } from "../types/memory";

// ── System prompt (exact per spec) ───────────────────────────

const SYSTEM_PROMPT = `You are SENTRI's intake classifier. You receive raw security data — code, logs, file contents, network captures, process lists, registry entries, emails, or hashes.
Your job is to analyze the content and determine:
- Whether it represents a security threat
- If so, what type of threat and how severe
- What specific indicators of compromise (IOCs) are present
- Whether this requires deep analysis (escalate) or can be handled quickly (fast)

Respond ONLY with a JSON object. No preamble, no markdown, no explanation outside the JSON. Schema:
{
  "isThreat": boolean,
  "confidence": number (0.0–1.0),
  "threatType": string | null,
  "severity": "none" | "low" | "medium" | "high" | "critical",
  "indicators": { key: value pairs of extracted IOCs },
  "reasoning": "1–3 sentence explanation of your assessment",
  "recommendedPath": "fast" | "escalate"
}

recommendedPath rules:
- "escalate" if: confidence > 0.7 AND severity is "high" or "critical"
- "escalate" if: threatType involves lateral movement, exfiltration, ransomware, privilege escalation, supply chain, or zero-day
- "fast" for everything else including isThreat: false`;

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

// ── JSON extraction helper ────────────────────────────────────
// Handles cases where Gemini wraps response in markdown fences.

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
  if (typeof parsed["isThreat"] !== "boolean") throw new Error("isThreat missing");
  if (typeof parsed["confidence"] !== "number") throw new Error("confidence missing");
  if (typeof parsed["reasoning"] !== "string") throw new Error("reasoning missing");
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
  const userPrompt = [
    `Input Type: ${input.inputType}`,
    `Source: ${input.source ?? "unknown"}`,
    `Filename: ${input.filename ?? "none"}`,
    ``,
    `CONTENT:`,
    input.content,
  ].join("\n");

  let rawResponse: string;
  try {
    rawResponse = await generateFlash(userPrompt, SYSTEM_PROMPT);
  } catch (err: unknown) {
    if (err instanceof GeminiError) {
      console.warn(`[IntakeClassifier] ${FLASH_MODEL_NAME} failed:`, err.message);
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

  // Retry: re-call Gemini once
  try {
    const retryResponse = await generateFlash(userPrompt, SYSTEM_PROMPT);
    const result = parseClassification(retryResponse);
    return applyConfidenceFloor(result);
  } catch (retryErr) {
    console.warn("[IntakeClassifier] Retry failed, returning safe fallback.");
    return SAFE_FALLBACK;
  }
}

/**
 * Confidence floor: prevent over-flagging.
 * If isThreat=true but confidence < 0.4, override to isThreat=false.
 * This protects Session 2 (clean nginx config) from false positives.
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
