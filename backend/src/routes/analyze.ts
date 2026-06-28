// ─────────────────────────────────────────────────────────────
// POST /api/analyze — SENTRI Pipeline (Phase 6: Gemini + RawInput)
//
// New request body:
//   { inputType, content, source?, filename? }
//
// Pipeline:
//   1. Build RawInput
//   2. Token estimate — if >= 8000: budget fallback
//   3. runCascade (Flash intake → optional Pro deep analysis)
//   4. Build internal InputTrigger for Hindsight
//   5. recallSimilar (ChromaDB)
//   6. matchPatterns
//   7. buildDecision
//   8. dispatchNotification? + storeIncident
//   9. Return response (content truncated to 500 chars)
//
// ?mode=baseline: returns mock classification, skips Gemini
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { TOKEN_BUDGET, runCascade } from "../cascade/cascadeRouter";
import { handleNovelAnomaly } from "../fallback/novelAnomalyHandler";
import { recallSimilar, storeIncident } from "../memory/memoryService";
import { matchPatterns } from "../memory/patternMatcher";
import { dispatchNotification } from "../notifications/notificationStubs";
import type {
  AgentDecision,
  GeminiClassification,
  DeepAnalysisResult,
  InputTrigger,
  MemoryArtifact,
  RawInput,
  RawInputType,
  SimilarIncident,
} from "../types/memory";

const router = Router();
let phase5FallbackIncidents: SimilarIncident[] = [];

const CONTENT_TRUNCATION_LIMIT = 500;

// ── Threat type → baseline mitigation map ────────────────────

const THREAT_MITIGATION_MAP: Record<string, string> = {
  traffic_spike: "RATE_LIMIT",
  failed_logins: "ACCOUNT_LOCKOUT",
  port_scan: "FIREWALL_RULE",
  data_exfiltration: "ALERT_SOC",
  internal_lateral_movement: "SEGMENT_NETWORK",
  malware: "ISOLATE_ENDPOINT",
  phishing: "QUARANTINE_EMAIL",
  ransomware: "ISOLATE_ENDPOINT",
  privilege_escalation: "REVOKE_CREDENTIALS",
  supply_chain: "ALERT_SOC",
  sql_injection: "WAF_BLOCK",
  xss: "WAF_BLOCK",
  rce: "ISOLATE_ENDPOINT",
  default: "LOG_AND_MONITOR",
};

// ── Severity string → numeric (for Hindsight/memory) ─────────

const SEVERITY_NUMERIC: Record<string, number> = {
  none: 0.1,
  low: 0.25,
  medium: 0.5,
  high: 0.8,
  critical: 0.97,
};

// ── Main route ────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const {
    inputType,
    content,
    source,
    filename,
    // Legacy fields — still accepted for backwards compat with cliAgent
    session_id,
    trigger_type,
    payload,
  } = req.body as {
    inputType?: string;
    content?: string;
    source?: string;
    filename?: string;
    session_id?: string;
    trigger_type?: string;
    payload?: Record<string, unknown>;
  };

  // ── Backwards compat: wrap legacy body into RawInput ─────────
  let resolvedContent = content;
  let resolvedInputType: RawInputType = (inputType as RawInputType) ?? "unknown";
  let resolvedSource = source;
  let resolvedFilename = filename;

  if (!resolvedContent && trigger_type && payload) {
    // Legacy format: build a synthetic log string
    resolvedContent = `trigger_type: ${trigger_type}\n${JSON.stringify(payload, null, 2)}`;
    resolvedInputType = "log_lines";
    resolvedSource = resolvedSource ?? (payload["source"] as string) ?? "legacy-api";
  }

  if (!resolvedContent || typeof resolvedContent !== "string" || resolvedContent.trim() === "") {
    res.status(400).json({
      error: "Missing required field: content (non-empty string)",
    });
    return;
  }

  const rawInput: RawInput = {
    inputId: `RAW-${Date.now()}`,
    inputType: resolvedInputType,
    content: resolvedContent,
    filename: resolvedFilename,
    submittedAt: new Date().toISOString(),
    source: resolvedSource,
  };

  // ── Baseline mode — skip Gemini ───────────────────────────────
  if (req.query["mode"] === "baseline") {
    const mockClassification: GeminiClassification = {
      isThreat: true,
      confidence: 0.5,
      threatType: trigger_type ?? resolvedInputType,
      severity: "medium",
      indicators: {},
      reasoning: "Baseline mode — Gemini classification skipped.",
      recommendedPath: "fast",
    };

    const decision: AgentDecision = {
      mode: "BASELINE",
      recommendation:
        `[BASELINE] Generic rule-based analysis for '${rawInput.inputType}'. ` +
        `No CascadeFlow reasoning was applied.`,
      mitigationChain: ["LOG_AND_MONITOR"],
      patternDetected: false,
      patternId: null,
      patternLabel: null,
      confidence: null,
    };

    res.json({
      inputId: rawInput.inputId,
      rawInput: truncateRawInput(rawInput),
      classification: mockClassification,
      deepAnalysis: null,
      decision,
      similarIncidents: [],
      cascadeAudit: null,
      notificationId: null,
      // Legacy compat fields
      session_id,
      trigger_type: trigger_type ?? resolvedInputType,
      recommendation: decision.recommendation,
      used_memory: false,
      used_cascade: false,
      latencyMs: 1150,
      tokensUsed: 420,
      baselineMitigation: decision.recommendation,
      reflection: null,
      context: {
        pastIncidents: [],
        overridden: false,
        confidence: 0,
        cascadeAudit: null,
        modelPath: null,
        tokenBudget: TOKEN_BUDGET,
        tokensUsed: 420,
      },
    });
    return;
  }

  // ── Step 1: Recall similar incidents (Hindsight) ──────────────
  // Build a lightweight trigger for recall BEFORE cascade (so Pro has context)
  const earlyTrigger: InputTrigger = {
    trigger_type: resolvedInputType,
    source: resolvedSource ?? "unknown",
    severity: 0.5, // neutral until classified
    summary: `${resolvedInputType} from ${resolvedSource ?? "unknown"}`,
  };

  let similarIncidents: SimilarIncident[] = [];
  try {
    similarIncidents = await recallSimilar(earlyTrigger, 5);
    console.log(`[Hindsight] Found ${similarIncidents.length} similar past incidents`);
  } catch (err) {
    console.warn("[Hindsight] recall failed (non-fatal):", err);
    similarIncidents = recallFromPhase5Fallback(earlyTrigger);
  }

  if (phase5FallbackIncidents.length > 0) {
    similarIncidents = mergeSimilarIncidents(
      recallFromPhase5Fallback(earlyTrigger),
      similarIncidents
    );
  }

  // ── Step 2: CascadeFlow (Flash → optional Pro) ────────────────
  const cascadeResult = await runCascade(rawInput, similarIncidents);
  const { classification, deepAnalysis, cascadeAudit, budgetExceeded } = cascadeResult;

  // ── Step 3: Build internal InputTrigger from classification ───
  const severityNumeric = SEVERITY_NUMERIC[classification.severity] ?? 0.5;
  const internalTrigger: InputTrigger = {
    trigger_type: classification.threatType ?? resolvedInputType,
    source: resolvedSource ?? "unknown",
    severity: severityNumeric,
    summary:
      classification.reasoning.substring(0, 200) +
      (classification.threatType ? ` [${classification.threatType}]` : ""),
  };

  // ── Step 4: Pattern matching (Hindsight behavioral override) ──
  const patternResult = matchPatterns(internalTrigger, similarIncidents);
  const isComposite = patternResult.matched && Boolean(patternResult.recommendation);
  const matchConfidence = patternResult.confidence ?? 0;

  // ── Step 5: Novel anomaly check ───────────────────────────────
  const hasCloseMatch = similarIncidents.some((i) => i.distance < 0.5);
  const isNovel = !hasCloseMatch && !isComposite && classification.isThreat;

  if (isNovel && !budgetExceeded) {
    try {
      const novelResponse = await handleNovelAnomaly(rawInput, classification);
      rememberInPhase5Fallback(internalTrigger.trigger_type, novelResponse.message);

      res.json({
        inputId: rawInput.inputId,
        rawInput: truncateRawInput(rawInput),
        classification,
        deepAnalysis: null,
        decision: null,
        similarIncidents,
        cascadeAudit,
        notificationId: novelResponse.notificationId,
        // Legacy compat
        session_id,
        trigger_type: internalTrigger.trigger_type,
        recommendation: novelResponse.message,
        used_memory: false,
        used_cascade: true,
        reflection: null,
        context: {
          pastIncidents: similarIncidents,
          overridden: false,
          confidence: classification.confidence,
          cascadeAudit,
          modelPath: cascadeResult.escalated
            ? `${process.env["GEMINI_FLASH_MODEL"]} → ${process.env["GEMINI_PRO_MODEL"]}`
            : process.env["GEMINI_FLASH_MODEL"],
          tokenBudget: TOKEN_BUDGET,
          tokensUsed: cascadeResult.tokensUsed,
        },
      });
      return;
    } catch (err) {
      console.error("[NovelAnomaly] handler failed:", err);
    }
  }

  // ── Step 6: Build AgentDecision ───────────────────────────────
  const decision = buildDecision(
    classification,
    deepAnalysis,
    isComposite,
    matchConfidence,
    budgetExceeded
  );

  // ── Step 7: Notification ──────────────────────────────────────
  let notificationId: string | null = null;
  if (shouldNotify(classification, decision)) {
    try {
      const notification = await dispatchNotification(classification, decision);
      notificationId = notification.notificationId;
    } catch (err) {
      console.error("[Notification] dispatch failed (non-fatal):", err);
    }
  }

  // ── Step 8: Persist to memory ─────────────────────────────────
  await persistIncident(internalTrigger, classification, decision);
  rememberInPhase5Fallback(internalTrigger.trigger_type, decision.recommendation);

  // ── Step 9: Return response ───────────────────────────────────
  res.json({
    inputId: rawInput.inputId,
    rawInput: truncateRawInput(rawInput),
    classification,
    deepAnalysis,
    decision,
    similarIncidents,
    cascadeAudit,
    notificationId,
    // Legacy compat fields (kept for frontend + validation runner)
    session_id,
    trigger_type: internalTrigger.trigger_type,
    recommendation: decision.recommendation,
    used_memory: similarIncidents.length > 0,
    used_cascade: true,
    reflection: patternResult.recommendation ?? null,
    context: {
      pastIncidents: similarIncidents,
      overridden: isComposite,
      confidence: matchConfidence,
      cascadeAudit,
      modelPath: cascadeResult.escalated
        ? `${process.env["GEMINI_FLASH_MODEL"]} → ${process.env["GEMINI_PRO_MODEL"]}`
        : process.env["GEMINI_FLASH_MODEL"],
      tokenBudget: TOKEN_BUDGET,
      tokensUsed: cascadeResult.tokensUsed,
    },
  });
});

// ── Decision builder ──────────────────────────────────────────

function buildDecision(
  classification: GeminiClassification,
  deepAnalysis: DeepAnalysisResult | null,
  isComposite: boolean,
  matchConfidence: number,
  budgetExceeded: boolean
): AgentDecision {
  // Budget fallback
  if (budgetExceeded) {
    return {
      mode: "BUDGET_FALLBACK",
      recommendation: "[BUDGET_FALLBACK] Token budget exhausted — rule-based memory lookup used.",
      mitigationChain: ["LOG_AND_MONITOR", "ESCALATE_TO_HUMAN"],
      patternDetected: false,
      patternId: null,
      patternLabel: null,
      confidence: null,
    };
  }

  // Not a threat
  if (!classification.isThreat) {
    return {
      mode: "BASELINE",
      recommendation: `[CLEAN] ${classification.reasoning}`,
      mitigationChain: ["LOG_AND_MONITOR"],
      patternDetected: false,
      patternId: null,
      patternLabel: null,
      confidence: classification.confidence,
    };
  }

  // Composite override (Hindsight pattern match)
  if (isComposite) {
    const threatMitigation = getMitigations(classification.threatType);
    return {
      mode: "COMPOSITE_OVERRIDE",
      recommendation: `[COMPOSITE_OVERRIDE] ${classification.reasoning}`,
      mitigationChain: ["WAF_RULE", "ENFORCE_2FA", "ROTATE_TOKENS", ...threatMitigation],
      patternDetected: true,
      patternId: "COMPOSITE-PATTERN",
      patternLabel: "Cross-session composite attack pattern",
      confidence: matchConfidence,
      rationale: classification.reasoning,
    };
  }

  // Deep analysis (escalated)
  if (deepAnalysis) {
    return {
      mode: "DEEP_ANALYSIS",
      recommendation: deepAnalysis.fullAnalysis,
      mitigationChain: deepAnalysis.mitigationChain,
      patternDetected: false,
      patternId: null,
      patternLabel: null,
      confidence: deepAnalysis.confidence,
      attackChain: deepAnalysis.attackChain,
      cvssScore: deepAnalysis.cvssScore,
      relatedPatterns: deepAnalysis.relatedPatterns,
      rationale: deepAnalysis.fullAnalysis,
    };
  }

  // Fast path threat
  const mitigations = getMitigations(classification.threatType);
  return {
    mode: "BASELINE",
    recommendation: `[THREAT] ${classification.reasoning}`,
    mitigationChain: mitigations,
    patternDetected: false,
    patternId: null,
    patternLabel: null,
    confidence: classification.confidence,
    rationale: classification.reasoning,
  };
}

function getMitigations(threatType: string | null): string[] {
  if (!threatType) return [THREAT_MITIGATION_MAP["default"]!];
  const normalized = threatType.toLowerCase().replace(/\s+/g, "_");
  const match = THREAT_MITIGATION_MAP[normalized] ?? THREAT_MITIGATION_MAP["default"]!;
  return [match];
}

// ── Notification check ────────────────────────────────────────

function shouldNotify(
  classification: GeminiClassification,
  decision: AgentDecision
): boolean {
  if (!classification.isThreat) return false;
  if (decision.mode === "COMPOSITE_OVERRIDE") return true;
  if (decision.mode === "DEEP_ANALYSIS") return true;
  if (classification.severity === "critical" || classification.severity === "high") return true;
  return false;
}

// ── Persistence ───────────────────────────────────────────────

async function persistIncident(
  trigger: InputTrigger,
  classification: GeminiClassification,
  decision: AgentDecision
): Promise<void> {
  const artifact: MemoryArtifact = {
    incident_id: uuidv4(),
    trigger_type: trigger.trigger_type,
    vectors: [],
    mitigation_success: true,
    hindsight_note:
      `[${decision.mode}] ${classification.reasoning} ` +
      `Mitigation: ${decision.mitigationChain.join(", ")}`,
    created_at: new Date().toISOString(),
  };

  try {
    await storeIncident(artifact);
  } catch (err) {
    console.error("[Hindsight] storeIncident failed (non-fatal):", err);
  }
}

// ── Helpers ───────────────────────────────────────────────────

function truncateRawInput(
  input: RawInput
): RawInput & { content: string } {
  const truncated =
    input.content.length > CONTENT_TRUNCATION_LIMIT
      ? input.content.slice(0, CONTENT_TRUNCATION_LIMIT) + "... [truncated]"
      : input.content;
  return { ...input, content: truncated };
}

function recallFromPhase5Fallback(trigger: InputTrigger): SimilarIncident[] {
  return phase5FallbackIncidents
    .map((incident) => ({
      ...incident,
      distance: incident.metadata["trigger_type"] === trigger.trigger_type ? 0.25 : 0.75,
    }))
    .slice(0, 3);
}

function mergeSimilarIncidents(
  fallbackIncidents: SimilarIncident[],
  recalledIncidents: SimilarIncident[]
): SimilarIncident[] {
  const seen = new Set<string>();
  return [...fallbackIncidents, ...recalledIncidents]
    .filter((incident) => {
      const key = incident.metadata["incident_id"] ?? incident.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

function rememberInPhase5Fallback(triggerType: string, recommendation: string): void {
  phase5FallbackIncidents.unshift({
    id: uuidv4(),
    distance: 0.25,
    metadata: {
      incident_id: uuidv4(),
      trigger_type: triggerType,
      created_at: new Date().toISOString(),
      mitigation_success: "true",
      summary: recommendation.substring(0, 200),
    },
  });
  phase5FallbackIncidents = phase5FallbackIncidents.slice(0, 20);
}

export function resetPhase5FallbackMemory(): void {
  phase5FallbackIncidents = [];
}

export default router;
