// ─────────────────────────────────────────────────────────────
// CascadeRouter — New Gemini-powered routing orchestrator
//
// Replaces the old complexity scorer + model router pipeline.
// Keeps CascadeAuditBlock shape identical for frontend compatibility.
//
// Pipeline:
//   RawInput
//     → token estimate (ceil(content.length/4) + 180)
//     → if >= 8000: budget fallback immediately
//     → intakeClassifier (Gemini Flash)
//     → if escalate: deepAnalyzer (Gemini Pro)
//     → buildCascadeAudit
// ─────────────────────────────────────────────────────────────

import { classifyRawInput } from "../gemini/intakeClassifier";
import { deepAnalyze } from "../gemini/deepAnalyzer";
import { FLASH_MODEL_NAME, PRO_MODEL_NAME } from "../gemini/geminiClient";
import type {
  RawInput,
  GeminiClassification,
  DeepAnalysisResult,
  SimilarIncident,
  CascadeAuditBlock,
} from "../types/memory";

export const TOKEN_BUDGET = 8000;
const SYSTEM_PROMPT_OVERHEAD = 180;
// Approx latency saving when using flash-only vs always-pro
const FLASH_ONLY_SAVING_PCT = 63;

export interface CascadeRouterResult {
  classification: GeminiClassification;
  deepAnalysis: DeepAnalysisResult | null;
  cascadeAudit: CascadeAuditBlock;
  /** Derived: true if deepAnalyzer ran */
  escalated: boolean;
  /** Derived: true if token budget was exceeded */
  budgetExceeded: boolean;
  tokensUsed: number;
}

/**
 * Run the full CascadeFlow pipeline for a RawInput.
 * similarIncidents is passed in from Hindsight (recalled before this call
 * only when doing a two-pass; normally this is called first then recall follows).
 */
export async function runCascade(
  input: RawInput,
  similarIncidents: SimilarIncident[] = []
): Promise<CascadeRouterResult> {
  const tokenEstimate =
    Math.ceil(input.content.length / 4) + SYSTEM_PROMPT_OVERHEAD;

  // ── Budget exceeded — skip Gemini entirely ──────────────────
  if (tokenEstimate >= TOKEN_BUDGET) {
    console.log(
      `[CascadeRouter] Token budget exceeded (${tokenEstimate} >= ${TOKEN_BUDGET}), using rule-based fallback`
    );

    const budgetClassification: GeminiClassification = {
      isThreat: false,
      confidence: 0,
      threatType: null,
      severity: "none",
      indicators: {},
      reasoning: "Token budget exhausted — rule-based memory lookup used.",
      recommendedPath: "fast",
    };

    const audit = buildAudit({
      inputType: input.inputType,
      isThreat: false,
      confidence: 0,
      severity: "none",
      modelPath: "none (rule-based fallback)",
      tokensUsed: TOKEN_BUDGET,
      decision: "Token budget exhausted — memory lookup used",
      latencySavingPct: 0,
      decisions: ["Token budget exhausted — rule-based memory lookup used"],
    });

    return {
      classification: budgetClassification,
      deepAnalysis: null,
      cascadeAudit: audit,
      escalated: false,
      budgetExceeded: true,
      tokensUsed: TOKEN_BUDGET,
    };
  }

  // ── Step 1: Intake classifier (Gemini Flash) ────────────────
  console.log(`[CascadeRouter] Running intake classifier on ${input.inputId}...`);
  const classification = await classifyRawInput(input);

  const shouldEscalate = classification.recommendedPath === "escalate";

  // ── Step 2: Deep analyzer (Gemini Pro) — escalation only ───
  let deepAnalysis: DeepAnalysisResult | null = null;
  let modelPath: string;
  let finalTokens = tokenEstimate;
  let latencySavingPct: number;

  if (shouldEscalate) {
    console.log(`[CascadeRouter] Escalating ${input.inputId} to deep analyzer...`);
    deepAnalysis = await deepAnalyze(input, classification, similarIncidents);
    modelPath = `${FLASH_MODEL_NAME} → ${PRO_MODEL_NAME} (escalated)`;
    finalTokens = tokenEstimate + 800; // pro adds ~800 extra tokens
    latencySavingPct = 0;
  } else {
    modelPath = FLASH_MODEL_NAME;
    latencySavingPct = FLASH_ONLY_SAVING_PCT;
  }

  // ── Step 3: Build audit block ───────────────────────────────
  const decisionText = buildDecisionText(classification, shouldEscalate);
  const decisions = buildDecisionList(classification, shouldEscalate);

  const audit = buildAudit({
    inputType: input.inputType,
    isThreat: classification.isThreat,
    confidence: classification.confidence,
    severity: classification.severity,
    modelPath,
    tokensUsed: finalTokens,
    decision: decisionText,
    latencySavingPct,
    decisions,
  });

  return {
    classification,
    deepAnalysis,
    cascadeAudit: audit,
    escalated: shouldEscalate,
    budgetExceeded: false,
    tokensUsed: finalTokens,
  };
}

// ── Audit builder ─────────────────────────────────────────────

interface AuditParams {
  inputType: string;
  isThreat: boolean;
  confidence: number;
  severity: string;
  modelPath: string;
  tokensUsed: number;
  decision: string;
  latencySavingPct: number;
  decisions: string[];
}

function buildAudit(params: AuditParams): CascadeAuditBlock {
  const {
    inputType, isThreat, confidence, severity,
    modelPath, tokensUsed, decision, latencySavingPct, decisions,
  } = params;

  const latencyStr =
    latencySavingPct > 0
      ? `~${latencySavingPct}% vs always-pro`
      : "none (pro model used)";

  const confidencePct = `${Math.round(confidence * 100)}%`;

  const formatted = [
    `[CascadeFlow Audit]`,
    `Input Type:      ${inputType}`,
    `Threat Detected: ${isThreat}`,
    `Confidence:      ${confidencePct}`,
    ...(isThreat ? [`Severity:        ${severity}`] : []),
    `Model Path:      ${modelPath}`,
    `Tokens Used:     ${tokensUsed} / ${TOKEN_BUDGET}`,
    `Decision:        ${decision}`,
    `Latency Saving:  ${latencyStr}`,
  ].join("\n");

  return {
    complexity: isThreat ? `${severity} threat` : "no threat",
    modelPath,
    tokensUsed: `${tokensUsed} / ${TOKEN_BUDGET}`,
    decisions,
    latencySavingPct,
    formatted,
  };
}

function buildDecisionText(
  classification: GeminiClassification,
  escalated: boolean
): string {
  if (!classification.isThreat) return "No threat indicators found";
  if (escalated) {
    return `Escalated — ${classification.severity} severity${
      classification.threatType ? ` + ${classification.threatType} detected` : ""
    }`;
  }
  return `Threat confirmed by flash model (${classification.severity})`;
}

function buildDecisionList(
  classification: GeminiClassification,
  escalated: boolean
): string[] {
  const decisions: string[] = [];
  decisions.push(`Intake classifier: isThreat=${classification.isThreat}, confidence=${Math.round(classification.confidence * 100)}%`);
  if (classification.threatType) {
    decisions.push(`Threat type: ${classification.threatType}`);
  }
  if (escalated) {
    decisions.push("Escalated to deep analyzer (Gemini Pro)");
  } else {
    decisions.push("Fast path — flash model sufficient");
  }
  return decisions;
}
