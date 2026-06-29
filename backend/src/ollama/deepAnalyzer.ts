// ─────────────────────────────────────────────────────────────
// Deep Analyzer — Ollama (sentri-analyzer / mistral:7b)
//
// Replaces gemini/deepAnalyzer.ts. Same public API:
//   deepAnalyze(input, classification, similarIncidents) → DeepAnalysisResult
//
// Runs ONLY when CascadeFlow escalates (recommendedPath === "escalate"
// OR Hindsight finds a high-confidence composite pattern).
//
// mitigationChain items must be ≥10 chars. If shorter, Mistral
// returned category labels — re-map via THREAT_MITIGATION_MAP.
// ─────────────────────────────────────────────────────────────

import { runAnalyzer, OllamaTimeoutError, OllamaUnavailableError } from "./ollamaClient";
import { buildAnalyzerPrompt } from "./promptBuilder";
import type {
  RawInput,
  GeminiClassification,
  DeepAnalysisResult,
  SimilarIncident,
} from "../types/memory";

// ── Fallback mitigation map ───────────────────────────────────
// Used when Mistral returns short category labels instead of
// actionable mitigation strings.

const THREAT_MITIGATION_MAP: Record<string, string> = {
  BLOCK_NETWORK: "Block suspicious outbound connections at perimeter firewall",
  ISOLATE: "Isolate affected endpoint from network segment immediately",
  ALERT_SOC: "Alert SOC team and open P1 incident ticket",
  PATCH: "Apply relevant security patches to affected systems",
  ROTATE_CREDS: "Rotate all credentials accessible from affected host",
  LOG_AND_MONITOR: "Enable enhanced logging and monitor for 24 hours",
  QUARANTINE: "Quarantine affected files and prevent further execution",
  ESCALATE_TO_HUMAN: "Escalate to senior analyst for manual review",
};

// ── Safe fallback ─────────────────────────────────────────────

const DEEP_FALLBACK: DeepAnalysisResult = {
  fullAnalysis: "Deep analysis failed — escalate to human analyst.",
  attackChain: [],
  mitigationChain: ["ESCALATE_TO_HUMAN", "LOG_AND_MONITOR"],
  cvssScore: null,
  confidence: 0,
  relatedPatterns: [],
};

// ── JSON extraction helper ────────────────────────────────────

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }
  return raw;
}

/**
 * Ensure mitigation items are actionable strings (≥10 chars).
 * If Mistral returned short category labels, remap them.
 */
function normalizeMitigations(chain: string[]): string[] {
  return chain.map((item) => {
    if (item.length >= 10) return item;
    // Try to map short label to a concrete action
    const mapped = THREAT_MITIGATION_MAP[item.toUpperCase().replace(/\s+/g, "_")];
    return mapped ?? `${item} — implement appropriate countermeasure`;
  });
}

function parseDeepResult(raw: string): DeepAnalysisResult {
  const parsed = JSON.parse(extractJson(raw));

  if (typeof parsed["fullAnalysis"] !== "string") throw new Error("fullAnalysis missing");

  const rawMitigations = Array.isArray(parsed["mitigationChain"])
    ? parsed["mitigationChain"]
    : ["LOG_AND_MONITOR"];

  return {
    fullAnalysis: parsed["fullAnalysis"],
    attackChain: Array.isArray(parsed["attackChain"]) ? parsed["attackChain"] : [],
    mitigationChain: normalizeMitigations(rawMitigations),
    cvssScore:
      typeof parsed["cvssScore"] === "number" ? parsed["cvssScore"] : null,
    confidence:
      typeof parsed["confidence"] === "number" ? parsed["confidence"] : 0,
    relatedPatterns: Array.isArray(parsed["relatedPatterns"])
      ? parsed["relatedPatterns"]
      : [],
  };
}

// ── Public API ────────────────────────────────────────────────

export async function deepAnalyze(
  input: RawInput,
  classification: GeminiClassification,
  similarIncidents: SimilarIncident[]
): Promise<DeepAnalysisResult> {
  const prompt = buildAnalyzerPrompt(input, classification, similarIncidents);

  // First attempt
  let rawResponse: string;
  try {
    const result = await runAnalyzer(prompt);
    rawResponse = result.text;
  } catch (err: unknown) {
    if (err instanceof OllamaTimeoutError) {
      console.warn(`[DeepAnalyzer] sentri-analyzer timed out`);
    } else if (err instanceof OllamaUnavailableError) {
      console.warn(`[DeepAnalyzer] Ollama unavailable: ${(err as Error).message}`);
    } else {
      console.warn("[DeepAnalyzer] Unexpected error:", err);
    }
    return DEEP_FALLBACK;
  }

  // First parse attempt
  try {
    return parseDeepResult(rawResponse);
  } catch (parseErr) {
    console.warn("[DeepAnalyzer] JSON parse failed on first attempt, retrying...");
  }

  // Retry: re-call with explicit JSON instruction
  try {
    const retryPrompt = prompt + "\nYou must respond with ONLY a JSON object. No other text.";
    const retryResult = await runAnalyzer(retryPrompt);
    return parseDeepResult(retryResult.text);
  } catch (retryErr) {
    console.warn("[DeepAnalyzer] Retry failed, returning fallback.");
    return DEEP_FALLBACK;
  }
}
