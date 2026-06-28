// ─────────────────────────────────────────────────────────────
// Deep Analyzer — Gemini Pro
//
// Runs ONLY when CascadeFlow escalates (recommendedPath === "escalate"
// OR Hindsight finds a high-confidence composite pattern).
//
// Produces a full forensic analysis with attack chain, MITRE IDs,
// CVSS score, and tailored mitigations.
// ─────────────────────────────────────────────────────────────

import { generatePro, GeminiError, PRO_MODEL_NAME } from "./geminiClient";
import type {
  RawInput,
  GeminiClassification,
  DeepAnalysisResult,
  SimilarIncident,
} from "../types/memory";

// ── System prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are SENTRI's deep analysis engine. You receive raw security input, an initial classification from a fast model, and a list of structurally similar past incidents from vector memory.
Produce a thorough forensic analysis. Your output must be a JSON object only:
{
  "fullAnalysis": "4–8 sentence prose report written for a SOC analyst",
  "attackChain": ["ordered", "list", "of", "attacker", "TTPs"],
  "mitigationChain": ["ordered", "mitigation", "actions"],
  "cvssScore": number | null,
  "confidence": number (0.0–1.0),
  "relatedPatterns": ["MITRE ATT&CK IDs if applicable, e.g. T1059.001"]
}
Use the past incidents to identify if this is part of a known pattern.
Be specific about attacker intent. Name the tools or techniques you recognize.
Do not hedge. Do not use generic mitigations — tailor them to what you see.`;

// ── Safe fallback ─────────────────────────────────────────────

const DEEP_FALLBACK: DeepAnalysisResult = {
  fullAnalysis:
    "Deep analysis failed — escalate to human analyst.",
  attackChain: [],
  mitigationChain: ["ESCALATE_TO_HUMAN", "LOG_AND_MONITOR"],
  cvssScore: null,
  confidence: 0,
  relatedPatterns: [],
};

// ── JSON extraction helper (shared pattern) ───────────────────

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

function parseDeepResult(raw: string): DeepAnalysisResult {
  const parsed = JSON.parse(extractJson(raw));
  if (typeof parsed["fullAnalysis"] !== "string") throw new Error("fullAnalysis missing");
  return {
    fullAnalysis: parsed["fullAnalysis"],
    attackChain: Array.isArray(parsed["attackChain"]) ? parsed["attackChain"] : [],
    mitigationChain: Array.isArray(parsed["mitigationChain"])
      ? parsed["mitigationChain"]
      : ["LOG_AND_MONITOR"],
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
  const userPrompt = [
    `INITIAL CLASSIFICATION:`,
    JSON.stringify(classification, null, 2),
    ``,
    `SIMILAR PAST INCIDENTS:`,
    JSON.stringify(similarIncidents, null, 2),
    ``,
    `RAW INPUT:`,
    `Type: ${input.inputType}`,
    `Source: ${input.source ?? "unknown"}`,
    input.content,
  ].join("\n");

  let rawResponse: string;
  try {
    rawResponse = await generatePro(userPrompt, SYSTEM_PROMPT);
  } catch (err: unknown) {
    if (err instanceof GeminiError) {
      console.warn(`[DeepAnalyzer] ${PRO_MODEL_NAME} failed:`, err.message);
    } else {
      console.warn("[DeepAnalyzer] Unexpected error:", err);
    }
    return DEEP_FALLBACK;
  }

  try {
    return parseDeepResult(rawResponse);
  } catch (parseErr) {
    console.warn("[DeepAnalyzer] JSON parse failed, returning fallback:", parseErr);
    return DEEP_FALLBACK;
  }
}
