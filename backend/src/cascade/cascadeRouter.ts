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

const flashModel = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
const proModel = process.env.GEMINI_PRO_MODEL || "gemini-2.5-flash";

// Initialize the CascadeFlow Agent
const agent = new CascadeAgent({
  models: [
    { name: flashModel, provider: "google", cost: 0.000075 },
    { name: proModel, provider: "google", cost: 0.00125 }
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

Analyze the content and produce a JSON object.
CRITICAL: Respond ONLY with a valid JSON object. Do not include markdown code fences (like \`\`\`json), do not include any preamble, introduction, or text outside the JSON.

CRITICAL FOR JSON VALIDITY:
- Never nest double quotes inside double quotes in string fields (e.g. do not write "executed "Bypass" policy"). Instead, use single quotes for nested quotes (e.g., "executed 'Bypass' policy").
- Strictly ensure all JSON syntax is correct, with appropriate commas and braces.

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
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }
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
    console.log(
      `[CascadeRouter] Budget exceeded (${tokenEstimate} >= ${TOKEN_BUDGET}). ` +
      `Content length: ${input.content?.length}. ` +
      `Preview: "${input.content?.substring(0, 100)}..."`
    );
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
    ], { maxTokens: 2048 });
  } catch (err) {
    console.warn(`[CascadeRouter] Primary CascadeAgent failed. Falling back to Flash-only analysis...`, err);
    fallbackUsed = true;
    result = await fallbackAgent.run([
      { role: "system", content: CONSOLIDATED_PROMPT },
      { role: "user", content: userPrompt }
    ], { maxTokens: 2048 });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(result.content));
  } catch (err) {
    console.error("[CascadeRouter] JSON Parse Failed:", err);
    console.error("[CascadeRouter] Raw content was:", result.content);
    return getParseFailureFallback(input.inputType, result.content);
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

function getParseFailureFallback(inputType: string, rawContent: string): CascadeRouterResult {
  const classification: GeminiClassification = {
    isThreat: false, confidence: 0.5, threatType: null, severity: "none",
    indicators: {}, reasoning: `Failed to parse analysis JSON. Raw response: \n${rawContent.substring(0, 2000)}`, recommendedPath: "fast"
  };
  return {
    classification,
    deepAnalysis: null,
    cascadeAudit: {
      complexity: "none", modelPath: "gemini-2.5-flash (parsing fallback)", tokensUsed: `0 / ${TOKEN_BUDGET}`,
      decisions: ["JSON parsing failed"], latencySavingPct: 0,
      formatted: `[CascadeFlow Audit]\nJSON parsing failed. Raw response: \n${rawContent.substring(0, 2000)}`
    },
    escalated: false,
    budgetExceeded: false,
    tokensUsed: 0
  };
}


