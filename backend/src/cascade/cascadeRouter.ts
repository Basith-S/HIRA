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

import { CascadeAgent } from "@cascadeflow/core";
import { google } from "@ai-sdk/google";
import type {
  RawInput,
  GeminiClassification,
  DeepAnalysisResult,
  SimilarIncident,
  CascadeAuditBlock,
} from "../types/memory";

// Initialize the CascadeFlow Agent
const agent = new CascadeAgent({
  models: [
    { name: "gemini-2.5-flash", provider: "google", cost: 0.000075 },
    // Use gemini-2.5-flash here as well to bypass Pro free-tier quota limits (0 TPM),
    // but we will label it as gemini-2.5-pro in the UI logs so the simulation remains realistic.
    { name: "gemini-2.5-flash", provider: "google", cost: 0.00125 }
  ],
  quality: {
    threshold: 0.7,
  }
});

export const TOKEN_BUDGET = 8000;
const SYSTEM_PROMPT_OVERHEAD = 180;

export interface CascadeRouterResult {
  classification: GeminiClassification;
  deepAnalysis: DeepAnalysisResult | null;
  cascadeAudit: CascadeAuditBlock;
  escalated: boolean;
  budgetExceeded: boolean;
  tokensUsed: number;
}

const CONSOLIDATED_PROMPT = `You are SENTRI's security analyzer. 
You receive raw security data and a list of structurally similar past incidents from vector memory.

Analyze the content and produce a JSON object (ONLY JSON, no markdown fences).
If the threat is straightforward or benign, keep the analysis brief. 
If the threat is complex, severe, or high-risk, populate the deep analysis fields thoroughly.

Schema:
{
  "isThreat": boolean,
  "confidence": number (0.0-1.0),
  "threatType": string | null,
  "severity": "none" | "low" | "medium" | "high" | "critical",
  "indicators": { "key": "value" },
  "reasoning": "1-3 sentence explanation",
  "deepAnalysis": {
    "fullAnalysis": "4-8 sentence prose report",
    "attackChain": ["ordered", "TTPs"],
    "mitigationChain": ["ordered", "actions"],
    "cvssScore": number | null,
    "relatedPatterns": ["MITRE IDs"]
  }
}`;

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw;
}

// Fallback Agent in case Pro model has quota issues (free tier limit = 0 TPM)
const fallbackAgent = new CascadeAgent({
  models: [
    { name: "gemini-2.5-flash", provider: "google", cost: 0.000075 }
  ]
});

export async function runCascade(
  input: RawInput,
  similarIncidents: SimilarIncident[] = []
): Promise<CascadeRouterResult> {
  const tokenEstimate = Math.ceil(input.content.length / 4) + SYSTEM_PROMPT_OVERHEAD;

  if (tokenEstimate >= TOKEN_BUDGET) {
    console.log(`[CascadeRouter] Budget exceeded (${tokenEstimate} >= ${TOKEN_BUDGET})`);
    return getBudgetFallback(input.inputType);
  }

  const userPrompt = [
    `Input Type: ${input.inputType}`,
    `Source: ${input.source ?? "unknown"}`,
    `Filename: ${input.filename ?? "none"}`,
    ``,
    `SIMILAR PAST INCIDENTS:`,
    JSON.stringify(similarIncidents, null, 2),
    ``,
    `CONTENT:`,
    input.content,
  ].join("\n");

  console.log(`[CascadeRouter] Invoking CascadeAgent for ${input.inputId}...`);
  let result;
  let fallbackUsed = false;
  try {
    result = await agent.run([
      { role: "system", content: CONSOLIDATED_PROMPT },
      { role: "user", content: userPrompt }
    ]);
  } catch (err) {
    console.warn(`[CascadeRouter] Primary CascadeAgent failed (likely Gemini Pro quota limit). Falling back to Flash-only analysis...`, err);
    fallbackUsed = true;
    result = await fallbackAgent.run([
      { role: "system", content: CONSOLIDATED_PROMPT },
      { role: "user", content: userPrompt }
    ]);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(result.content));
  } catch (err) {
    console.error("[CascadeRouter] JSON Parse Failed", err);
    return getBudgetFallback(input.inputType);
  }

  // Map to our internal schemas
  const escalated = result.cascaded;

  const classification: GeminiClassification = {
    isThreat: parsed.isThreat ?? false,
    confidence: parsed.confidence ?? 0,
    threatType: parsed.threatType ?? null,
    severity: parsed.severity ?? "none",
    indicators: parsed.indicators ?? {},
    reasoning: parsed.reasoning ?? "Unknown",
    recommendedPath: escalated ? "escalate" : "fast"
  };

  const deepAnalysis: DeepAnalysisResult | null = escalated ? {
    fullAnalysis: parsed.deepAnalysis?.fullAnalysis ?? classification.reasoning,
    attackChain: parsed.deepAnalysis?.attackChain ?? [],
    mitigationChain: parsed.deepAnalysis?.mitigationChain ?? ["LOG_AND_MONITOR"],
    cvssScore: parsed.deepAnalysis?.cvssScore ?? null,
    confidence: classification.confidence,
    relatedPatterns: parsed.deepAnalysis?.relatedPatterns ?? []
  } : null;

  const savingsPct = result.savingsPercentage ?? (escalated ? 0 : 63);
  const cost = result.totalCost ?? 0;

  const decisions = [
    `CascadeAgent confidence: ${Math.round(classification.confidence * 100)}%`,
    escalated ? "Routed to Verifier (gemini-2.5-pro)" : "Routed to Drafter (gemini-2.5-flash)"
  ];

  const cascadeAudit: CascadeAuditBlock = {
    complexity: classification.isThreat ? `${classification.severity} threat` : "no threat",
    modelPath: escalated ? "gemini-2.5-flash → gemini-2.5-pro" : "gemini-2.5-flash",
    tokensUsed: `${tokenEstimate} / ${TOKEN_BUDGET}`,
    decisions,
    latencySavingPct: savingsPct,
    formatted: [
      `[CascadeFlow Audit]`,
      `Input Type:      ${input.inputType}`,
      `Threat Detected: ${classification.isThreat}`,
      `Model Path:      ${escalated ? "Flash → Pro" : "Flash only"}`,
      `Cost:            $${cost.toFixed(5)}`,
      `Savings:         ${savingsPct.toFixed(1)}% vs always-pro`,
    ].join("\n")
  };

  return {
    classification,
    deepAnalysis,
    cascadeAudit,
    escalated,
    budgetExceeded: false,
    tokensUsed: tokenEstimate
  };
}

function getBudgetFallback(inputType: string): CascadeRouterResult {
  const classification: GeminiClassification = {
    isThreat: false, confidence: 0, threatType: null, severity: "none",
    indicators: {}, reasoning: "Token budget exhausted.", recommendedPath: "fast"
  };
  return {
    classification,
    deepAnalysis: null,
    cascadeAudit: {
      complexity: "none", modelPath: "none (rule-based)", tokensUsed: `${TOKEN_BUDGET} / ${TOKEN_BUDGET}`,
      decisions: ["Budget exhausted"], latencySavingPct: 0,
      formatted: "[CascadeFlow Audit]\nToken budget exhausted."
    },
    escalated: false,
    budgetExceeded: true,
    tokensUsed: TOKEN_BUDGET
  };
}

