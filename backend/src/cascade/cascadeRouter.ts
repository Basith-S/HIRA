// ─────────────────────────────────────────────────────────────
// CascadeRouter — Ollama Local SLM Routing Orchestrator
//
// Replaces CascadeFlow/Gemini with local Ollama models:
//   osava-smollm (SmolLM3-3B) — fast intake classification
//   sentri-analyzer   (mistral:7b) — deep forensic analysis
//
// Pipeline:
//   RawInput
//     → token estimate (ceil(content.length/4) + 180)
//     → if >= TOKEN_BUDGET: budget fallback immediately
//     → intakeClassifier (Ollama osava-smollm)
//     → if escalate: deepAnalyzer (Ollama sentri-analyzer)
//     → buildCascadeAudit
// ─────────────────────────────────────────────────────────────

import { classifyRawInput } from "../ollama/intakeClassifier";
import { deepAnalyze } from "../ollama/deepAnalyzer";
import type {
  RawInput,
  GeminiClassification,
  DeepAnalysisResult,
  SimilarIncident,
  CascadeAuditBlock,
} from "../types/memory";

// Bounded by the *classifier's* context window, since every input passes
// through it. SmolLM3-3B has max_position_embeddings 65536, so this is a real
// limit rather than a nominal one. Keep it below the Modelfile's num_ctx,
// which is 32768.
//
// Note this is also bounded by VRAM, not just by the model. SmolLM3 has GQA
// (4 KV heads of 16 across 36 layers, head_dim 128), so its KV cache costs
// ~0.07 MB per token — about 2.25 GB at 32k, against phi3-mini's 12 GB for
// the same window. That is what makes a 32k budget affordable here at all.
// On a smaller card, lower this and num_ctx together, or set
// OLLAMA_KV_CACHE_TYPE=q8_0 to halve the cache.
export const TOKEN_BUDGET = parseInt(process.env["TOKEN_BUDGET"] ?? "32000", 10);
const SYSTEM_PROMPT_OVERHEAD = 180;

/** Average mistral:7b inference time on mid-range hardware (ms). */
const ANALYZER_AVG_MS = 2200;

export interface CascadeRouterResult {
  classification: GeminiClassification;
  deepAnalysis: DeepAnalysisResult | null;
  cascadeAudit: CascadeAuditBlock;
  escalated: boolean;
  budgetExceeded: boolean;
  tokensUsed: number;
}

// ── Main entry point ──────────────────────────────────────────

export async function runCascade(
  input: RawInput,
  similarIncidents: SimilarIncident[] = []
): Promise<CascadeRouterResult> {
  const tokenEstimate =
    Math.ceil(input.content.length / 4) + SYSTEM_PROMPT_OVERHEAD;

  // ── Budget check ──────────────────────────────────────────
  if (tokenEstimate >= TOKEN_BUDGET) {
    console.log(
      `[CascadeRouter] Budget exceeded (${tokenEstimate} >= ${TOKEN_BUDGET}). ` +
        `Content length: ${input.content?.length}. ` +
        `Preview: "${input.content?.substring(0, 100)}..."`
    );
    return getBudgetFallback(input.inputType);
  }

  // ── Step 1: Classify via osava-smollm (SmolLM3-3B) ────
  console.log(
    `[CascadeRouter] Classifying ${input.inputId} via osava-smollm...`
  );
  const classifierStartMs = Date.now();
  const classification = await classifyRawInput(input);
  const classifierLatencyMs = Date.now() - classifierStartMs;

  // ── Step 2: Escalate if needed ────────────────────────────
  const shouldEscalate =
    classification.recommendedPath === "escalate" &&
    classification.isThreat;

  let deepAnalysis: DeepAnalysisResult | null = null;
  let analyzerLatencyMs = 0;
  let analyzerTokens = 0;

  if (shouldEscalate) {
    console.log(
      `[CascadeRouter] Escalating ${input.inputId} to sentri-analyzer (${classification.threatType}, ${classification.severity})...`
    );
    const analyzerStartMs = Date.now();
    deepAnalysis = await deepAnalyze(input, classification, similarIncidents);
    analyzerLatencyMs = Date.now() - analyzerStartMs;
  }

  // ── Step 3: Build audit trail ─────────────────────────────
  const totalLatencyMs = classifierLatencyMs + analyzerLatencyMs;
  const cascadeAudit = buildCascadeAudit(
    input,
    classification,
    shouldEscalate,
    tokenEstimate,
    classifierLatencyMs,
    analyzerLatencyMs,
    totalLatencyMs
  );

  return {
    classification,
    deepAnalysis,
    cascadeAudit,
    escalated: shouldEscalate,
    budgetExceeded: false,
    tokensUsed: tokenEstimate,
  };
}

// ── Audit trail builder ───────────────────────────────────────

function buildCascadeAudit(
  input: RawInput,
  classification: GeminiClassification,
  escalated: boolean,
  tokenEstimate: number,
  classifierLatencyMs: number,
  analyzerLatencyMs: number,
  totalLatencyMs: number
): CascadeAuditBlock {
  // Report against TOKEN_BUDGET — the limit this router actually enforces at
  // intake. Printing the model context window here put a different denominator
  // on the same numerator the UI shows next to it.
  const savingPct =
    !escalated && totalLatencyMs < ANALYZER_AVG_MS
      ? Math.round((1 - totalLatencyMs / ANALYZER_AVG_MS) * 100)
      : 0;

  let decision: string;
  let modelPath: string;
  let latencyDetail: string;

  if (!classification.isThreat) {
    decision = "No threat indicators found";
    modelPath = "osava-smollm (SmolLM3-3B)";
    latencyDetail = `${classifierLatencyMs}ms`;
  } else if (escalated) {
    decision = `Escalated — ${classification.severity} + ${classification.threatType}`;
    modelPath =
      "osava-smollm → sentri-analyzer (SmolLM3-3B → mistral:7b)";
    latencyDetail = `${classifierLatencyMs}ms classifier + ${analyzerLatencyMs}ms analyzer`;
  } else {
    decision = "Threat confirmed — fast path sufficient";
    modelPath = "osava-smollm (SmolLM3-3B)";
    latencyDetail = `${classifierLatencyMs}ms`;
  }

  const savingsStr =
    savingPct > 0 ? `~${savingPct}% faster` : "none (deep analysis required)";

  const decisions = [
    `Confidence: ${Math.round(classification.confidence * 100)}%`,
    decision,
  ];

  const formatted = [
    `[CascadeFlow Audit]`,
    `- Input Type:      ${input.inputType}`,
    `- Threat Detected: ${classification.isThreat}`,
    `- Confidence:      ${Math.round(classification.confidence * 100)}%`,
    `- Severity:        ${classification.severity}`,
    `- Model Path:      ${modelPath}`,
    `- Tokens Used:     ${tokenEstimate} / ${TOKEN_BUDGET}`,
    `- Inference Time:  ${latencyDetail}`,
    `- Decision:        ${decision}`,
    `- vs Always-Deep:  ${savingsStr}`,
  ].join("\n");

  return {
    complexity: classification.isThreat
      ? `${classification.severity} threat`
      : "no threat",
    modelPath,
    tokensUsed: `${tokenEstimate} / ${TOKEN_BUDGET}`,
    decisions,
    latencySavingPct: savingPct,
    formatted,
  };
}

// ── Budget fallback ───────────────────────────────────────────

function getBudgetFallback(inputType: string): CascadeRouterResult {
  const classification: GeminiClassification = {
    isThreat: false,
    confidence: 0,
    threatType: null,
    severity: "none",
    indicators: {},
    reasoning: "Token budget exhausted.",
    recommendedPath: "fast",
  };

  return {
    classification,
    deepAnalysis: null,
    cascadeAudit: {
      complexity: "none",
      modelPath: "none (rule-based)",
      tokensUsed: `${TOKEN_BUDGET} / ${TOKEN_BUDGET}`,
      decisions: ["Budget exhausted"],
      latencySavingPct: 0,
      formatted: "[CascadeFlow Audit]\nToken budget exhausted.",
    },
    escalated: false,
    budgetExceeded: true,
    tokensUsed: TOKEN_BUDGET,
  };
}
