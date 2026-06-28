import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { buildAuditTrail } from "../cascade/auditTrail";
import { scoreComplexity, type ComplexityScore } from "../cascade/complexityScorer";
import {
  routeToModel,
  TOKEN_BUDGET,
  type ModelResponse,
  type RoutingDecision,
} from "../cascade/modelRouter";
import { handleNovelAnomaly } from "../fallback/novelAnomalyHandler";
import { recallSimilar, storeIncident } from "../memory/memoryService";
import { matchPatterns } from "../memory/patternMatcher";
import { dispatchNotification } from "../notifications/notificationStubs";
import type {
  AgentDecision,
  InputTrigger,
  MemoryArtifact,
  SimilarIncident,
} from "../types/memory";

const router = Router();
let phase5FallbackIncidents: SimilarIncident[] = [];

type AnalyzeBody = {
  session_id: string;
  trigger_type: string;
  payload: Record<string, unknown>;
};

router.post("/", async (req: Request, res: Response) => {
  const { session_id, trigger_type, payload } = req.body as AnalyzeBody;

  if (!session_id || !trigger_type || !payload) {
    res.status(400).json({
      error: "Missing required fields: session_id, trigger_type, payload",
    });
    return;
  }

  const severity =
    typeof payload["severity"] === "number" ? (payload["severity"] as number) : 0.5;
  const source =
    typeof payload["source"] === "string" ? (payload["source"] as string) : "unknown";

  const trigger: InputTrigger = {
    trigger_type,
    source,
    severity,
    summary:
      typeof payload["summary"] === "string" ? (payload["summary"] as string) : undefined,
  };

  const baselineRecommendation = buildBaselineRecommendation(session_id, trigger_type);

  if (req.query["mode"] === "baseline") {
    const decision: AgentDecision = {
      mode: "BASELINE",
      recommendation: baselineRecommendation,
      mitigationChain: mitigationChainFor(trigger_type, false),
      patternDetected: false,
      patternId: null,
      patternLabel: null,
      confidence: null,
    };

    res.json({
      session_id,
      trigger_type,
      recommendation: baselineRecommendation,
      used_memory: false,
      used_cascade: false,
      latencyMs: 1150,
      tokensUsed: 420,
      baselineMitigation: baselineRecommendation,
      trigger,
      decision,
      reflection: null,
      similarIncidents: [],
      cascadeAudit: null,
      notificationId: null,
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

  let similarIncidents: SimilarIncident[] = [];
  try {
    similarIncidents = await recallSimilar(trigger);
    console.log(`[Hindsight] Found ${similarIncidents.length} similar past incidents`);
  } catch (err) {
    console.warn("[Hindsight] recall failed (non-fatal):", err);
    similarIncidents = recallFromPhase5Fallback(trigger);
  }

  if (phase5FallbackIncidents.length > 0) {
    similarIncidents = mergeSimilarIncidents(
      recallFromPhase5Fallback(trigger),
      similarIncidents
    );
  }

  const patternResult = matchPatterns(trigger, similarIncidents);
  const isOverridden = patternResult.matched && Boolean(patternResult.recommendation);
  const matchConfidence = patternResult.confidence ?? 0;
  const hindsightRecommendation = isOverridden ? patternResult.recommendation ?? null : null;

  const triggerForScoring: Record<string, unknown> = {
    session_id,
    trigger_type,
    source,
    severity,
    ...payload,
    ...(hindsightRecommendation
      ? { hindsight_note: hindsightRecommendation.substring(0, 200) }
      : {}),
  };

  const complexity = scoreComplexity(
    triggerForScoring,
    matchConfidence,
    severity,
    similarIncidents.length
  );

  const hasCloseMemoryMatch = similarIncidents.some((incident) => incident.distance < 0.5);
  const isNovelAnomaly = !hasCloseMemoryMatch && !isOverridden;

  if (isNovelAnomaly && complexity.tokenEstimate < TOKEN_BUDGET) {
    const auditBlock = buildNovelAudit(complexity, similarIncidents.length);
    try {
      const novelResponse = await handleNovelAnomaly(trigger);
      rememberInPhase5Fallback(trigger_type, novelResponse.message);
      res.json({
        ...novelResponse,
        session_id,
        trigger_type,
        recommendation: novelResponse.message,
        used_memory: false,
        used_cascade: true,
        trigger,
        decision: null,
        reflection: null,
        similarIncidents,
        cascadeAudit: auditBlock,
        notificationId: novelResponse.notificationId,
        context: {
          pastIncidents: similarIncidents,
          overridden: false,
          confidence: 0,
          cascadeAudit: auditBlock,
          modelPath: "fast_path",
          tokenBudget: TOKEN_BUDGET,
          tokensUsed: parseTokenCount(auditBlock.tokensUsed),
        },
      });
      return;
    } catch (err) {
      console.error("[NovelAnomaly] fallback handling failed:", err);
      res.status(500).json({
        error: "Novel anomaly fallback failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  const modelResponse =
    complexity.tokenEstimate >= TOKEN_BUDGET
      ? buildBudgetFallbackResponse(complexity, baselineRecommendation, similarIncidents)
      : await routeToModel(
          complexity,
          hindsightRecommendation,
          baselineRecommendation,
          trigger_type,
          session_id
        );

  const decision = buildAgentDecision(
    trigger_type,
    modelResponse.recommendation,
    isOverridden,
    matchConfidence,
    modelResponse.routingDecision.path === "degraded_fallback"
  );

  const auditBlock = buildAuditTrail(
    complexity,
    modelResponse.routingDecision,
    modelResponse.tokensUsed,
    buildAuditDecisions(similarIncidents, isOverridden, matchConfidence, modelResponse)
  );

  let notificationId: string | null = null;
  if (shouldNotify(trigger, decision)) {
    try {
      const notification = await dispatchNotification(trigger, decision);
      notificationId = notification.notificationId;
    } catch (err) {
      console.error("[Notification] dispatch failed (non-fatal):", err);
    }
  }

  await persistResolvedIncident(trigger_type, modelResponse.recommendation);
  rememberInPhase5Fallback(trigger_type, modelResponse.recommendation);

  res.json({
    session_id,
    trigger_type,
    recommendation: modelResponse.recommendation,
    used_memory: similarIncidents.length > 0,
    used_cascade: true,
    trigger,
    decision,
    reflection: hindsightRecommendation,
    similarIncidents,
    cascadeAudit: auditBlock,
    notificationId,
    context: {
      pastIncidents: similarIncidents,
      overridden: isOverridden,
      confidence: matchConfidence,
      cascadeAudit: auditBlock,
      modelPath: modelResponse.routingDecision.path,
      tokenBudget: TOKEN_BUDGET,
      tokensUsed: modelResponse.tokensUsed,
    },
  });
});

function buildBaselineRecommendation(sessionId: string, triggerType: string): string {
  switch (triggerType) {
    case "traffic_spike":
      return (
        `[BASELINE] Traffic spike detected for session '${sessionId}'. ` +
        `Generic recommendation: enable rate-limiting on the affected ingress ` +
        `and monitor for 15 minutes. No CascadeFlow reasoning was applied.`
      );
    case "failed_logins":
      return (
        `[BASELINE] Failed login burst detected for session '${sessionId}'. ` +
        `Generic recommendation: temporarily lock the targeted accounts, enforce ` +
        `CAPTCHA on the login endpoint, and alert the SOC team. No CascadeFlow reasoning was applied.`
      );
    default:
      return (
        `[BASELINE] Unknown trigger type '${triggerType}' for session '${sessionId}'. ` +
        `Generic recommendation: forward to a human analyst for triage.`
      );
  }
}

function buildNovelAudit(complexity: ComplexityScore, memoryCount: number) {
  const routing: RoutingDecision =
    complexity.tokenEstimate >= TOKEN_BUDGET
      ? {
          path: "degraded_fallback",
          modelUsed: "none",
          reason: "Token budget exhausted before novel-anomaly reflection.",
          latencySavingPct: 0,
        }
      : {
          path: "fast_path",
          modelUsed: "llama-3-8b (simulated)",
          reason: "Novel anomaly stored without LLM reflection.",
          latencySavingPct: 63,
        };

  return buildAuditTrail(
    complexity,
    routing,
    complexity.tokenEstimate >= TOKEN_BUDGET ? TOKEN_BUDGET : complexity.tokenEstimate,
    [
      `Retrieved ${memoryCount} past incident(s) from memory`,
      "Novel anomaly fallback used",
      "Stored for future pattern learning",
    ]
  );
}

function buildBudgetFallbackResponse(
  complexity: ComplexityScore,
  baselineRecommendation: string,
  similarIncidents: SimilarIncident[]
): ModelResponse {
  const topIncident = similarIncidents[0] ?? null;
  const chain = mitigationChainFromIncident(topIncident);
  const routingDecision: RoutingDecision = {
    path: "degraded_fallback",
    modelUsed: "none",
    reason: "Token budget exhausted - rule-based memory lookup used",
    latencySavingPct: 0,
  };

  return {
    recommendation:
      `[BUDGET_FALLBACK] Token budget exceeded (${complexity.tokenEstimate} estimated tokens). ` +
      `Rule-based mitigation chain: ${chain.join(" -> ")}. ` +
      (topIncident
        ? `Top recalled incident: ${topIncident.metadata["incident_id"] ?? topIncident.id}.`
        : baselineRecommendation),
    tokensUsed: TOKEN_BUDGET,
    routingDecision,
  };
}

function buildAgentDecision(
  triggerType: string,
  recommendation: string,
  isOverridden: boolean,
  confidence: number,
  isBudgetFallback: boolean
): AgentDecision {
  if (isBudgetFallback) {
    return {
      mode: "BUDGET_FALLBACK",
      recommendation,
      mitigationChain: mitigationChainFor(triggerType, false),
      patternDetected: false,
      patternId: null,
      patternLabel: null,
      confidence: null,
    };
  }

  if (isOverridden) {
    return {
      mode: "COMPOSITE_OVERRIDE",
      recommendation,
      mitigationChain: mitigationChainFor(triggerType, true),
      patternDetected: true,
      patternId: "COMPOSITE-CREDENTIAL-TRAFFIC",
      patternLabel: "Credential Stuffing + Traffic Spike Composite",
      confidence,
    };
  }

  return {
    mode: "BASELINE",
    recommendation,
    mitigationChain: mitigationChainFor(triggerType, false),
    patternDetected: false,
    patternId: null,
    patternLabel: null,
    confidence: null,
  };
}

function mitigationChainFor(triggerType: string, isComposite: boolean): string[] {
  if (isComposite) return ["WAF_RULE", "ENFORCE_2FA", "ROTATE_TOKENS"];
  if (triggerType === "traffic_spike") return ["RATE_LIMIT", "MONITOR"];
  if (triggerType === "failed_logins") return ["LOCK_ACCOUNTS", "ENFORCE_CAPTCHA", "ALERT_SOC"];
  return ["INVESTIGATE", "NOTIFY_OWNER"];
}

function mitigationChainFromIncident(incident: SimilarIncident | null): string[] {
  if (!incident) return ["INVESTIGATE", "NOTIFY_OWNER"];
  const summary = (incident.metadata["summary"] ?? "").toLowerCase();
  if (summary.includes("2fa") || summary.includes("token")) {
    return ["WAF_RULE", "ENFORCE_2FA", "ROTATE_TOKENS"];
  }
  return mitigationChainFor(incident.metadata["trigger_type"] ?? "unknown", false);
}

function buildAuditDecisions(
  similarIncidents: SimilarIncident[],
  isOverridden: boolean,
  confidence: number,
  modelResponse: ModelResponse
): string[] {
  const decisions: string[] = [];
  if (similarIncidents.length > 0) {
    decisions.push(`Retrieved ${similarIncidents.length} past incident(s) from memory`);
  }
  if (isOverridden) {
    decisions.push(`Applied hindsight rule (confidence: ${(confidence * 100).toFixed(0)}%)`);
  }
  decisions.push(
    modelResponse.routingDecision.path === "fast_path"
      ? "Routed to fast model"
      : modelResponse.routingDecision.path === "escalation_path"
      ? "Escalated to full model"
      : "Token budget exhausted - rule-based memory lookup used"
  );
  if (modelResponse.routingDecision.path === "escalation_path" && isOverridden) {
    decisions.push("Recommended 2FA enforcement + credential rotation");
  }
  return decisions;
}

function shouldNotify(trigger: InputTrigger, decision: AgentDecision): boolean {
  if (decision.mode === "COMPOSITE_OVERRIDE" && trigger.severity >= 0.75) return true;
  if (decision.mode === "BASELINE" && trigger.severity >= 0.75) return true;
  return false;
}

async function persistResolvedIncident(
  triggerType: string,
  recommendation: string
): Promise<void> {
  const artifact: MemoryArtifact = {
    incident_id: uuidv4(),
    trigger_type: triggerType,
    vectors: [],
    mitigation_success: true,
    hindsight_note: recommendation,
    created_at: new Date().toISOString(),
  };

  try {
    await storeIncident(artifact);
  } catch (err) {
    console.error("[Hindsight] storeIncident failed (non-fatal):", err);
  }
}

function parseTokenCount(tokensUsed: string): number {
  const raw = Number(tokensUsed.split("/")[0]?.trim());
  return Number.isFinite(raw) ? raw : 0;
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
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3);
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
      summary: recommendation,
    },
  });
  phase5FallbackIncidents = phase5FallbackIncidents.slice(0, 20);
}

export function resetPhase5FallbackMemory(): void {
  phase5FallbackIncidents = [];
}

export default router;
